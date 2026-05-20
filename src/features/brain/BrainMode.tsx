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
import { agentById, type AgentId, type RegionId } from '@config/agents';
import { bus } from '@core/bus/EventBus';
import { streamWithModelChain } from '@core/llm/ProviderRegistry';
import type { LlmMessage } from '@core/llm/types';
import { agentModelFor } from '@core/store/agentModelStore';
import { useChatHistoryStore } from '@core/store/chatHistoryStore';
import { useProjectStore } from '@core/store/projectStore';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';
import { useResearchRunStore } from '@core/store/researchRunStore';
import { useRagStore, type NewRagChunk } from '@core/store/ragStore';
import { classify } from '@core/topic/MeshClassifier';
import type { EvidenceItem } from '@platform/index';
import { FeatureBoundary } from '@ui/errors/FeatureBoundary';

import { BrainCanvas } from './components/BrainCanvas';
import { BrainLegend } from './components/BrainLegend';
import { Composer } from './components/Composer';
import { EvidenceList } from './components/EvidenceList';
import { SettingsPanel } from './components/SettingsPanel';
import { INITIAL_SOURCES, SourceRunner, type SourceStatus } from './components/SourceRunner';
import { Transcript, type ChatMessage } from './components/Transcript';
import { BRAIN_MODEL } from './data/modelParts';
import { SOURCE_DEFS } from './data/sources';
import { labelForModel, summarizeEvidence, TOPIC_THROTTLE_MS } from './researchPipeline';
import { runSwarm } from './swarm/runSwarm';
import type { BossPhase, SwarmCallbacks } from './swarm/types';
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const modelGroups = useModelCatalogStore((s) => s.groups);
  const availableModels = useMemo(() => modelGroups.flatMap((group) => group.models), [modelGroups]);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const activeChatId = useChatHistoryStore((s) => s.activeChatId);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const [sourceStatuses, setSourceStatuses] = useState<SourceStatus[]>(INITIAL_SOURCES);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const regions = useLitRegions();
  const canSubmit = query.trim().length > 0;
  // Placeholder label for a pending bubble — the boss model. The final
  // bubble is relabelled with the model that actually answered.
  const modelLabel = useMemo(() => labelForModel(agentModelFor('boss')), [modelGroups]);

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

  const toConversation = (turns: ChatMessage[]): LlmMessage[] =>
    turns.flatMap<LlmMessage>((message) => {
      if (message.role === 'user') return [{ role: 'user', content: message.content }];
      if (message.role === 'assistant' && !message.critiqueOf && message.content.trim()) {
        return [{ role: 'assistant', content: message.content }];
      }
      return [];
    });

  const runTurn = async (cleanQuery: string, baseMessages: ChatMessage[], appendUser: boolean) => {
    if (!cleanQuery || isRunning) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: cleanQuery };
    const nextMessages = appendUser ? [...baseMessages, userMessage] : baseMessages;
    const conversation = toConversation(appendUser ? baseMessages : baseMessages.slice(0, -1));

    setQuery('');
    setEditingMessageId(null);
    setSourceStatuses(INITIAL_SOURCES.map((source) => ({ ...source, state: 'idle', count: 0 })));
    setEvidence([]);
    setMessages(nextMessages);

    if (availableModels.length === 0) {
      setMessages([
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'No connected model is available yet. Connect Ollama or save a provider key in Settings, then refresh models.',
        },
      ]);
      return;
    }

    setIsRunning(true);
    const runs = useResearchRunStore.getState();
    const assistantId = crypto.randomUUID();
    setMessages([
      ...nextMessages,
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
        bus.emit('region:light', { region: hit.region, source: 'topic', intensity: hit.confidence * 0.55, ttlMs: 4500 });
      }
    };

    const sourceForTool = (toolName: string) => SOURCE_DEFS.find((def) => def.tool === toolName);
    const sourceCounts = new Map<SourceStatus['id'], number>();
    let activeRunId: string | null = null;
    const ensureResearchRun = () => {
      if (!activeRunId) activeRunId = runs.startRun(cleanQuery, []).id;
      return activeRunId;
    };

    const lightAgent = (agentId: AgentId, intensity = 0.78) => {
      const agent = agentById(agentId);
      bus.emit('region:light', {
        region: agent.regionBinding,
        source: 'agent',
        agentId,
        intensity,
        ttlMs: 4000,
      });
    };

    const bossDetail: Record<BossPhase, string> = {
      routing: 'routing message',
      delegating: 'delegating to specialists',
      synthesizing: 'synthesizing specialist findings',
      answering: 'normal chat',
    };

    const callbacks: SwarmCallbacks = {
      onBossPhase: (phase) => {
        if (phase === 'delegating' || phase === 'synthesizing') ensureResearchRun();
        bus.emit('agent:activity', {
          agentId: 'boss',
          phase: phase === 'routing' || phase === 'answering' ? 'start' : 'tool_call',
          detail: bossDetail[phase],
        });
        lightAgent('boss', phase === 'synthesizing' ? 0.86 : 0.72);
      },
      onSpecialistStart: (agentId, subQuery) => {
        ensureResearchRun();
        bus.emit('agent:activity', { agentId, phase: 'start', detail: subQuery });
        lightAgent(agentId);
      },
      onSpecialistDone: (agentId, recordCount) => {
        bus.emit('agent:activity', { agentId, phase: 'done', detail: `${recordCount} records` });
      },
      onSpecialistError: (agentId, message) => {
        bus.emit('agent:activity', { agentId, phase: 'error', detail: message });
      },
      onToolCall: (agentId, toolName) => {
        const def = sourceForTool(toolName);
        if (def) {
          updateSource(def.id, { state: 'running', detail: 'fetching' });
          bus.emit('region:light', { region: def.region, source: 'agent', agentId, intensity: 0.78, ttlMs: 4000 });
        }
        bus.emit('agent:activity', { agentId, phase: 'tool_call', detail: def?.label ?? toolName });
      },
      onToolResult: (agentId, toolName, count) => {
        const def = sourceForTool(toolName);
        if (def) {
          const total = (sourceCounts.get(def.id) ?? 0) + count;
          sourceCounts.set(def.id, total);
          updateSource(def.id, {
            state: 'done',
            count: total,
            detail: `${total} record${total === 1 ? '' : 's'}`,
          });
        }
        bus.emit('agent:activity', {
          agentId,
          phase: 'tool_result',
          detail: `${def?.label ?? toolName}: ${count}`,
        });
      },
      onAnswerToken: (delta) => {
        streamedContent += delta;
        setMessages((current) => current.map((m) => (m.id === assistantId ? { ...m, content: streamedContent } : m)));
        flushTopicHits(streamedContent);
      },
    };

    try {
      const result = await runSwarm({
        question: cleanQuery,
        conversation,
        modelFor: agentModelFor,
        callbacks,
      });

      flushTopicHits(result.answer || streamedContent);
      const finalContent =
        result.answer ||
        streamedContent ||
        (result.kind === 'research' ? summarizeEvidence(result.evidence) : 'No response returned by the selected model.');

      if (result.kind === 'research') {
        const runId = ensureResearchRun();
        setEvidence(result.evidence);
        runs.storeEvidence(runId, result.evidence);
        runs.storeSummary(runId, finalContent, result.modelUsed);

        // Save this run into the active project's RAG memory: each retrieved
        // record plus the synthesized answer become searchable chunks so a
        // later question can draw on what this project already found.
        if (activeProjectId) {
          const evidenceChunks: NewRagChunk[] = result.evidence.map((item) => ({
            kind: 'evidence',
            title: item.title,
            text: [item.title, item.snippet ?? ''].filter(Boolean).join(' — '),
            source: item.source,
            runId,
            query: cleanQuery,
            ...(item.url ? { url: item.url } : {}),
          }));
          const answerChunk: NewRagChunk = {
            kind: 'answer',
            title: cleanQuery,
            text: finalContent,
            source: 'answer',
            runId,
            query: cleanQuery,
          };
          useRagStore.getState().addChunks(activeProjectId, [...evidenceChunks, answerChunk]);
        }
      }
      setMessages((current) =>
        current.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: finalContent,
                modelLabel: labelForModel(result.modelUsed),
                isStreaming: false,
                ...(result.kind === 'research' ? { citations: result.evidence.slice(0, 12) } : {}),
              }
            : m,
        ),
      );
      bus.emit('agent:activity', {
        agentId: 'boss',
        phase: 'done',
        detail: `${result.kind} · ${labelForModel(result.modelUsed)}`,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const fallback = streamedContent || `HashCerebrum could not complete the request: ${detail}`;
      if (activeRunId) runs.failRun(activeRunId, detail);
      setMessages((current) =>
        current.map((m) =>
          m.id === assistantId ? { ...m, content: fallback, error: detail, isStreaming: false } : m,
        ),
      );
      bus.emit('agent:activity', { agentId: 'boss', phase: 'error', detail });
    } finally {
      setIsRunning(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery || isRunning) return;

    if (editingMessageId) {
      const editIndex = messages.findIndex((message) => message.id === editingMessageId && message.role === 'user');
      await runTurn(cleanQuery, editIndex >= 0 ? messages.slice(0, editIndex) : messages, true);
      return;
    }

    await runTurn(cleanQuery, messages, true);
  };

  const editMessage = (messageId: string) => {
    if (isRunning) return;
    const target = messages.find((message) => message.id === messageId && message.role === 'user');
    if (!target) return;
    setEditingMessageId(messageId);
    setQuery(target.content);
  };

  const regenerateMessage = (messageId: string) => {
    if (isRunning) return;
    const assistantIndex = messages.findIndex((message) => message.id === messageId && message.role === 'assistant');
    if (assistantIndex <= 0) return;
    const userIndex = messages
      .slice(0, assistantIndex)
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(({ message }) => message.role === 'user')?.index;
    if (userIndex === undefined) return;
    const userMessage = messages[userIndex];
    if (!userMessage) return;
    void runTurn(userMessage.content, messages.slice(0, userIndex + 1), false);
  };

  const critiquedRef = useRef(new Set<string>());

  const runCritique = async (messageId: string) => {
    const target = messages.find((m) => m.id === messageId);
    if (!target || critiquedRef.current.has(messageId)) return;
    critiquedRef.current.add(messageId);

    bus.emit('agent:activity', { agentId: 'boss', phase: 'start', detail: 'on-demand critique' });
    bus.emit('region:light', { region: 'amygdala', source: 'agent', agentId: 'boss', intensity: 0.85, ttlMs: 4500 });

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
        agentModelFor('boss'),
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
      bus.emit('agent:activity', { agentId: 'boss', phase: 'done' });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessages((current) =>
        current.map((m) =>
          m.id === critiqueId
            ? { ...m, content: buffer || `Critic unavailable: ${detail}`, isStreaming: false, error: detail }
            : m,
        ),
      );
      bus.emit('agent:activity', { agentId: 'boss', phase: 'error', detail });
    }
  };

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
          <h1>The Main Brain</h1>
        </header>

        <FeatureBoundary name="Transcript">
          <Transcript
            messages={messages}
            modelLabel={modelLabel}
            isRunning={isRunning}
            onCritique={runCritique}
            onRegenerate={regenerateMessage}
            onEdit={editMessage}
          />
        </FeatureBoundary>

        <FeatureBoundary name="Composer">
          <Composer
            query={query}
            setQuery={setQuery}
            isRunning={isRunning}
            canSubmit={canSubmit}
            editing={!!editingMessageId}
            onCancelEdit={() => {
              setEditingMessageId(null);
              setQuery('');
            }}
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
              <p className="brain-credit-line">
                {BRAIN_MODEL.source} · {BRAIN_MODEL.license}
              </p>
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
            <SettingsPanel onClose={() => setSettingsOpen(false)} />
          </FeatureBoundary>
        </div>
      )}
    </div>
  );
}
