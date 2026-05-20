// Brain workspace — chat-first research surface that runs an agentic
// pipeline: source agents fetch guarded evidence, the run store persists
// the evidence, then the synthesizer drafts from the stored run with
// automatic failover when a cloud provider is rate-limited or 5xxs.
//
// The mode is intentionally split into small components (Composer,
// Transcript, BrainCanvas, SourceRunner, EvidenceList, BrainLegend,
// SettingsPanel) so a crash in one stays contained by FeatureBoundary
// instead of taking the workspace down.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { RegionId } from '@config/agents';
import { bus } from '@core/bus/EventBus';
import { resolveDefaultModel, streamWithModelChain } from '@core/llm/ProviderRegistry';
import { DEFAULT_MODEL } from '@core/llm/modelCatalog';
import { useChatHistoryStore } from '@core/store/chatHistoryStore';
import { useProjectStore } from '@core/store/projectStore';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';
import { useResearchRunStore } from '@core/store/researchRunStore';
import { useRagStore, type NewRagChunk } from '@core/store/ragStore';
import { classify } from '@core/topic/MeshClassifier';
import type { EvidenceItem } from '@platform/index';
import { FeatureBoundary } from '@ui/errors/FeatureBoundary';
import { Icon } from '@ui/icons';

import { BrainCanvas } from './components/BrainCanvas';
import { BrainLegend } from './components/BrainLegend';
import { Composer, type ChatRouteMode } from './components/Composer';
import { EvidenceList } from './components/EvidenceList';
import { SettingsPanel } from './components/SettingsPanel';
import { INITIAL_SOURCES, SourceRunner, type SourceStatus } from './components/SourceRunner';
import { Transcript, type ChatMessage } from './components/Transcript';
import { BRAIN_MODEL, partForRegion } from './data/modelParts';
import { regionById } from './data/regions';
import { SOURCE_DEFS } from './data/sources';
import { runResearchAgent } from './researchAgent';
import {
  isResearchQuery,
  labelForModel,
  shortLabelForModel,
  summarizeEvidence,
  TOPIC_THROTTLE_MS,
} from './researchPipeline';
import { useLitRegions } from './useLitRegions';

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'system',
  content:
    'Ask normally for chat, or ask a biomedical research question to run source agents that fetch guarded evidence, store the run, and synthesize from the stored records.',
};

export function BrainMode() {
  const [selectedRegion, setSelectedRegion] = useState<RegionId | null>(null);
  const [hoveredRegion, setHoveredRegion] = useState<RegionId | null>(null);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [routeMode, setRouteMode] = useState<ChatRouteMode>('auto');
  const modelGroups = useModelCatalogStore((s) => s.groups);
  const availableModels = useMemo(() => modelGroups.flatMap((group) => group.models), [modelGroups]);

  // Resolve default model on mount — Ollama-first if a local model is
  // loaded, else first cloud key, else fall back to catalog default.
  useEffect(() => {
    let cancelled = false;
    void resolveDefaultModel().then((value) => {
      if (!cancelled) setSelectedModel(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (availableModels.length === 0) return;
    if (!availableModels.some((model) => model.value === selectedModel)) {
      setSelectedModel(availableModels[0]!.value);
    }
  }, [availableModels, selectedModel]);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const activeChatId = useChatHistoryStore((s) => s.activeChatId);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const [sourceStatuses, setSourceStatuses] = useState<SourceStatus[]>(INITIAL_SOURCES);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const regions = useLitRegions();
  const canSubmit = query.trim().length > 0;
  const modelLabel = useMemo(() => labelForModel(selectedModel), [selectedModel]);

  // Clicking the same region twice clears the selection.
  const toggleRegion = (region: RegionId | null) => {
    setSelectedRegion((current) => (current === region ? null : region));
  };

  // Cmd+, / Ctrl+, opens settings — matches HashCortx muscle memory.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        setSettingsOpen((open) => !open);
      } else if (event.key === 'Escape' && settingsOpen) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen]);

  const updateSource = (id: SourceStatus['id'], update: Partial<SourceStatus>) => {
    setSourceStatuses((current) => current.map((source) => (source.id === id ? { ...source, ...update } : source)));
  };

  // Load a transcript when one is opened from the left rail. activeChatId
  // only becomes non-null after an explicit rail action or the first
  // saved turn, so this never clobbers an in-progress conversation.
  useEffect(() => {
    if (!activeChatId) return;
    const chat = useChatHistoryStore.getState().chats.find((c) => c.id === activeChatId);
    if (chat) setMessages(chat.messages.length > 0 ? chat.messages : [WELCOME_MESSAGE]);
  }, [activeChatId]);

  // Switching projects starts a fresh transcript so a chat is never saved
  // into the wrong project. The snapshot effect below skips welcome-only
  // transcripts, so this never persists a stray empty chat.
  useEffect(() => {
    setMessages([WELCOME_MESSAGE]);
    useChatHistoryStore.setState({ activeChatId: null });
  }, [activeProjectId]);

  // Snapshot the conversation into chat history once a turn settles.
  useEffect(() => {
    if (isRunning) return;
    if (!messages.some((m) => m.role === 'user')) return;
    useChatHistoryStore.getState().saveActive(messages);
  }, [isRunning, messages]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery || isRunning) return;

    setQuery('');
    setSourceStatuses(INITIAL_SOURCES.map((source) => ({ ...source, state: 'idle', count: 0 })));
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', content: cleanQuery }]);

    const shouldRunResearch = routeMode === 'research' || (routeMode === 'auto' && isResearchQuery(cleanQuery));

    if (!shouldRunResearch) {
      if (!availableModels.some((model) => model.value === selectedModel)) {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'No connected model is available yet. Connect Ollama or save a provider key in Settings, then refresh models.',
          },
        ]);
        return;
      }

      setIsRunning(true);
      bus.emit('agent:activity', { agentId: 'synthesizer', phase: 'start', detail: 'normal chat' });
      const assistantId = crypto.randomUUID();
      setMessages((current) => [
        ...current,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          modelLabel,
          isStreaming: true,
        },
      ]);
      let buffer = '';
      try {
        const response = await streamWithModelChain(
          selectedModel,
          {
            temperature: 0.45,
            maxTokens: 1100,
            messages: [
              {
                role: 'system',
                content:
                  'You are HashCerebrum, a concise desktop assistant. Chat normally. If the user asks for biomedical evidence, say research mode can fetch guarded sources; do not invent citations.',
              },
              { role: 'user', content: cleanQuery },
            ],
          },
          {
            onToken: (delta) => {
              buffer += delta;
              setMessages((current) =>
                current.map((m) => (m.id === assistantId ? { ...m, content: buffer } : m)),
              );
            },
          },
          (progress) => {
            bus.emit('agent:activity', {
              agentId: 'synthesizer',
              phase: 'tool_call',
              detail: `Failover ${progress.attempt}: ${shortLabelForModel(progress.from)} → ${progress.to.shortLabel}`,
            });
          },
        );
        setMessages((current) =>
          current.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: response.content || buffer,
                  modelLabel: labelForModel(response.modelUsed),
                  isStreaming: false,
                }
              : m,
          ),
        );
        bus.emit('agent:activity', { agentId: 'synthesizer', phase: 'done', detail: labelForModel(response.modelUsed) });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setMessages((current) =>
          current.map((m) =>
            m.id === assistantId
              ? { ...m, content: buffer || `Chat unavailable: ${detail}`, isStreaming: false, error: detail }
              : m,
          ),
        );
        bus.emit('agent:activity', { agentId: 'synthesizer', phase: 'error', detail });
      } finally {
        setIsRunning(false);
      }
      return;
    }

    setIsRunning(true);
    bus.emit('agent:activity', { agentId: 'librarian', phase: 'start', detail: 'agentic research' });

    const runs = useResearchRunStore.getState();
    const run = runs.startRun(cleanQuery, []);
    const assistantId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { id: assistantId, role: 'assistant', content: '', modelLabel, isStreaming: true },
    ]);

    let streamedContent = '';
    let lastTopicAt = 0;
    const seenTerms = new Set<string>();
    const flushTopicHits = (text: string) => {
      const now = Date.now();
      if (now - lastTopicAt < TOPIC_THROTTLE_MS) return;
      lastTopicAt = now;
      for (const hit of classify(text)) {
        if (seenTerms.has(hit.term)) continue;
        seenTerms.add(hit.term);
        bus.emit('topic:detected', hit);
        bus.emit('region:light', { region: hit.region, source: 'topic', intensity: hit.confidence * 0.55, ttlMs: 9000 });
      }
    };

    const sourceForTool = (toolName: string) => SOURCE_DEFS.find((def) => def.tool === toolName);

    try {
      const result = await runResearchAgent(cleanQuery, selectedModel, {
        onToolCall: (toolName) => {
          const def = sourceForTool(toolName);
          if (!def) return;
          updateSource(def.id, { state: 'running', count: 0, detail: 'fetching' });
          bus.emit('agent:activity', { agentId: def.agentId, phase: 'tool_call', detail: def.label });
          bus.emit('region:light', { region: def.region, source: 'agent', agentId: def.agentId, intensity: 0.78, ttlMs: 10_000 });
        },
        onToolResult: (toolName, count) => {
          const def = sourceForTool(toolName);
          if (!def) return;
          updateSource(def.id, { state: 'done', count, detail: `${count} record${count === 1 ? '' : 's'}` });
          bus.emit('agent:activity', { agentId: def.agentId, phase: 'tool_result', detail: `${def.label}: ${count}` });
        },
        onToolError: (toolName, message) => {
          const def = sourceForTool(toolName);
          if (!def) return;
          updateSource(def.id, { state: 'error', count: 0, detail: message });
          bus.emit('agent:activity', { agentId: def.agentId, phase: 'error', detail: def.label });
        },
        onPhase: (phase) => {
          if (phase !== 'answering') return;
          bus.emit('agent:activity', { agentId: 'synthesizer', phase: 'start', detail: 'synthesize' });
          bus.emit('region:light', { region: 'parietal', source: 'agent', agentId: 'synthesizer', intensity: 0.8, ttlMs: 9000 });
        },
        onAnswerToken: (delta) => {
          streamedContent += delta;
          setMessages((current) => current.map((m) => (m.id === assistantId ? { ...m, content: streamedContent } : m)));
          flushTopicHits(streamedContent);
        },
      });

      flushTopicHits(result.answer || streamedContent);
      setEvidence(result.evidence);
      runs.storeEvidence(run.id, result.evidence);
      const finalContent = result.answer || streamedContent || summarizeEvidence(result.evidence);
      runs.storeSummary(run.id, finalContent, result.modelUsed);

      // Save this run into the active project's RAG memory: each retrieved
      // record plus the synthesized answer become searchable chunks so a
      // later question can draw on what this project already found.
      if (activeProjectId) {
        const evidenceChunks: NewRagChunk[] = result.evidence.map((item) => ({
          kind: 'evidence',
          title: item.title,
          text: [item.title, item.snippet ?? ''].filter(Boolean).join(' — '),
          source: item.source,
          runId: run.id,
          query: cleanQuery,
          ...(item.url ? { url: item.url } : {}),
        }));
        const answerChunk: NewRagChunk = {
          kind: 'answer',
          title: cleanQuery,
          text: finalContent,
          source: 'answer',
          runId: run.id,
          query: cleanQuery,
        };
        useRagStore.getState().addChunks(activeProjectId, [...evidenceChunks, answerChunk]);
      }
      setMessages((current) =>
        current.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: finalContent,
                citations: result.evidence.slice(0, 12),
                modelLabel: labelForModel(result.modelUsed),
                isStreaming: false,
              }
            : m,
        ),
      );
      bus.emit('agent:activity', { agentId: 'synthesizer', phase: 'done', detail: labelForModel(result.modelUsed) });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const fallback = streamedContent || `Research could not complete: ${detail}`;
      runs.failRun(run.id, detail);
      setMessages((current) =>
        current.map((m) =>
          m.id === assistantId ? { ...m, content: fallback, error: detail, isStreaming: false } : m,
        ),
      );
      bus.emit('agent:activity', { agentId: 'synthesizer', phase: 'error', detail });
    } finally {
      setIsRunning(false);
    }
  };

  const critiquedRef = useRef(new Set<string>());

  const runCritique = async (messageId: string) => {
    const target = messages.find((m) => m.id === messageId);
    if (!target || critiquedRef.current.has(messageId)) return;
    critiquedRef.current.add(messageId);

    bus.emit('agent:activity', { agentId: 'critic', phase: 'start', detail: 'on-demand critique' });
    bus.emit('region:light', { region: 'amygdala', source: 'agent', agentId: 'critic', intensity: 0.85, ttlMs: 9000 });

    const critiqueId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      {
        id: critiqueId,
        role: 'assistant',
        content: '',
        modelLabel: 'Critic',
        critiqueOf: messageId,
        isStreaming: true,
      },
    ]);

    let buffer = '';
    try {
      const response = await streamWithModelChain(
        selectedModel,
        {
          temperature: 0.15,
          maxTokens: 800,
          messages: [
            {
              role: 'system',
              content:
                'You are the HashCerebrum Critic. Review the assistant reply below for evidence-hierarchy rigor, citation-claim alignment, and potential hallucination. Be specific: name the claim, name the supporting [S#], flag the gap. Do not rewrite the answer.',
            },
            {
              role: 'user',
              content: `Assistant reply to critique:\n\n${target.content}`,
            },
          ],
        },
        {
          onToken: (delta) => {
            buffer += delta;
            setMessages((current) =>
              current.map((m) => (m.id === critiqueId ? { ...m, content: buffer } : m)),
            );
          },
        },
      );
      setMessages((current) =>
        current.map((m) =>
          m.id === critiqueId
            ? { ...m, content: response.content || buffer, isStreaming: false }
            : m,
        ),
      );
      bus.emit('agent:activity', { agentId: 'critic', phase: 'done' });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessages((current) =>
        current.map((m) =>
          m.id === critiqueId
            ? { ...m, content: buffer || `Critic unavailable: ${detail}`, isStreaming: false, error: detail }
            : m,
        ),
      );
      bus.emit('agent:activity', { agentId: 'critic', phase: 'error', detail });
    }
  };

  const selectedPart = selectedRegion ? partForRegion(selectedRegion) : null;
  const focusEvidence = selectedRegion
    ? evidence.filter((item) => {
        const match = sourceStatuses.find((s) => s.id === item.source);
        return match?.region === selectedRegion;
      })
    : evidence;

  return (
    <div className="mode brain-mode brain-workspace">
      <section className="research-chat" aria-label="Brain research chat">
        <header className="workspace-toolbar">
          <p className="eyebrow">
            <Icon name="brain" size={10} /> Brain Research
          </p>
          <h1>Chat-first workspace</h1>
        </header>

        <FeatureBoundary name="Transcript">
          <Transcript messages={messages} modelLabel={modelLabel} isRunning={isRunning} onCritique={runCritique} />
        </FeatureBoundary>

        <FeatureBoundary name="Composer">
          <Composer
            query={query}
            setQuery={setQuery}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            isRunning={isRunning}
            canSubmit={canSubmit}
            routeMode={routeMode}
            setRouteMode={setRouteMode}
            onSubmit={submit}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </FeatureBoundary>
      </section>

      <section className="brain-side">
        <FeatureBoundary name="Brain canvas" resetKey={BRAIN_MODEL.path}>
          <div className="brain-model-panel">
            <div className="brain-stage">
              <BrainCanvas
                selectedRegion={selectedRegion}
                hoveredRegion={hoveredRegion}
                onSelectRegion={toggleRegion}
                onHoverRegion={setHoveredRegion}
              />
              <section className="brain-hero">
                <p className="eyebrow">
                  <Icon name="brain" size={10} /> Mesh-linked atlas
                </p>
                <h2>{selectedPart ? selectedPart.label : 'Click a region to focus'}</h2>
                <p className="model-line">
                  {selectedPart
                    ? `Linked to ${selectedPart.regionIds.map((region) => regionById(region).label).join(', ')}.`
                    : 'Hover for region info. Selecting a region filters evidence cards.'}
                </p>
                <p className="brain-credit">
                  {BRAIN_MODEL.source} · {BRAIN_MODEL.license}
                </p>
              </section>
            </div>
          </div>
        </FeatureBoundary>

        <div className="source-panel">
          <FeatureBoundary name="Sources">
            <SourceRunner statuses={sourceStatuses} evidenceCount={evidence.length} onSelectRegion={toggleRegion} />
          </FeatureBoundary>
          <FeatureBoundary name="Region legend">
            <BrainLegend regions={regions} selectedRegion={selectedRegion} onSelectRegion={toggleRegion} />
          </FeatureBoundary>
          <FeatureBoundary name="Evidence">
            <EvidenceList items={focusEvidence} />
          </FeatureBoundary>
        </div>
      </section>

      {settingsOpen && (
        <div
          className="settings-popover-layer"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <FeatureBoundary name="Settings">
            <SettingsPanel
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              onClose={() => setSettingsOpen(false)}
            />
          </FeatureBoundary>
        </div>
      )}
    </div>
  );
}
