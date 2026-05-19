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
import { runAgenticEvidencePass } from '@agents/research/ResearchOrchestrator';
import { bus } from '@core/bus/EventBus';
import {
  resolveDefaultModel,
  streamWithModelChain,
  type FailoverProgress,
} from '@core/llm/ProviderRegistry';
import { DEFAULT_MODEL } from '@core/llm/modelCatalog';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';
import { useResearchRunStore } from '@core/store/researchRunStore';
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
import {
  fallbackAnswer,
  isResearchQuery,
  labelForModel,
  shortLabelForModel,
  summarizeEvidence,
  TOPIC_THROTTLE_MS,
} from './researchPipeline';
import { useLitRegions } from './useLitRegions';

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
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'system',
      content:
        'Ask normally for chat, or ask a biomedical research question to run source agents that fetch guarded evidence, store the run, and synthesize from the stored records.',
    },
  ]);
  const [sourceStatuses, setSourceStatuses] = useState<SourceStatus[]>(INITIAL_SOURCES);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const regions = useLitRegions();
  const getResearchRun = useResearchRunStore((s) => s.getRun);
  const storeSummary = useResearchRunStore((s) => s.storeSummary);
  const failResearchRun = useResearchRunStore((s) => s.failRun);
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

    const { runId, evidence: nextEvidence } = await runAgenticEvidencePass({
      query: cleanQuery,
      sources: INITIAL_SOURCES,
      onSourceUpdate: updateSource,
    });
    setEvidence(nextEvidence);

    const storedRun = getResearchRun(runId);
    const storedEvidence = storedRun?.evidence ?? nextEvidence;
    const evidenceContext = summarizeEvidence(storedEvidence);
    const prompt = [
      `Research question: ${cleanQuery}`,
      `Stored research run: ${runId}`,
      '',
      'Stored evidence records:',
      evidenceContext,
      '',
      'Write a concise research answer from the stored evidence only. Use bracket citations like [S1] and include uncertainty when records are weak or absent.',
    ].join('\n');

    const failoverNotes: string[] = [];
    const onProgress = (progress: FailoverProgress) => {
      const note = `Failover ${progress.attempt}: ${shortLabelForModel(progress.from)} → ${progress.to.shortLabel}`;
      failoverNotes.push(note);
      bus.emit('agent:activity', {
        agentId: 'synthesizer',
        phase: 'tool_call',
        detail: note,
      });
    };

    // Pre-create the assistant bubble so tokens stream into it as they
    // arrive. We update its content via setMessages on every token.
    bus.emit('agent:activity', { agentId: 'synthesizer', phase: 'start', detail: `summarize stored run ${runId}` });
    bus.emit('region:light', {
      region: 'parietal',
      source: 'agent',
      agentId: 'synthesizer',
      intensity: 0.8,
      ttlMs: 9000,
    });
    const assistantId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        modelLabel: modelLabel,
        isStreaming: true,
      },
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
        bus.emit('region:light', {
          region: hit.region,
          source: 'topic',
          intensity: hit.confidence * 0.55,
          ttlMs: 9000,
        });
      }
    };

    try {
      const response = await streamWithModelChain(
        selectedModel,
        {
          temperature: 0.2,
          maxTokens: 1400,
          messages: [
            {
              role: 'system',
              content:
                'You are HashCerebrum Brain Research. Use only the provided source records for factual claims. Do not provide personal medical advice. Cite claims with [S#].',
            },
            { role: 'user', content: prompt },
          ],
        },
        {
          onToken: (delta) => {
            streamedContent += delta;
            setMessages((current) =>
              current.map((m) => (m.id === assistantId ? { ...m, content: streamedContent } : m)),
            );
            flushTopicHits(streamedContent);
          },
        },
        onProgress,
      );
      // Final pass — classify the complete answer in case the throttle
      // missed a term that only appeared at the end.
      flushTopicHits(response.content || streamedContent);

      const finalContent = response.content || streamedContent || summarizeEvidence(nextEvidence);
      storeSummary(runId, finalContent, response.modelUsed);
      setMessages((current) =>
        current.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: finalContent,
                citations: nextEvidence.slice(0, 12),
                modelLabel: labelForModel(response.modelUsed),
                isStreaming: false,
                ...(failoverNotes.length > 0 ? { failoverNote: failoverNotes[failoverNotes.length - 1] } : {}),
              }
            : m,
        ),
      );
      bus.emit('agent:activity', { agentId: 'synthesizer', phase: 'done', detail: labelForModel(response.modelUsed) });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const fallback = streamedContent || fallbackAnswer(cleanQuery, nextEvidence, detail);
      storeSummary(runId, fallback);
      failResearchRun(runId, detail);
      setMessages((current) =>
        current.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: fallback,
                citations: nextEvidence.slice(0, 12),
                error: detail,
                isStreaming: false,
              }
            : m,
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
