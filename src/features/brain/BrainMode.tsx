// Brain workspace — the boss-swarm research surface. The boss routes each
// message, delegates research to topic specialists, and synthesizes one
// cited answer; failover covers a rate-limited or dead-credit provider.
//
// The mode is split into small components (Composer, Transcript,
// BrainCanvas, AgentPanel, SettingsPanel) so a crash in one stays
// contained by FeatureBoundary instead of taking the workspace down.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AgentId, RegionId } from '@config/agents';
import { bus } from '@core/bus/EventBus';
import { streamWithModelChain } from '@core/llm/ProviderRegistry';
import type { LlmMessage } from '@core/llm/types';
import { agentModelFor } from '@core/store/agentModelStore';
import { useBrainModesStore } from '@core/store/brainModesStore';
import { useChatHistoryStore } from '@core/store/chatHistoryStore';
import { useProjectStore } from '@core/store/projectStore';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';
import { useResearchRunStore } from '@core/store/researchRunStore';
import { useRagStore, type NewRagChunk } from '@core/store/ragStore';
import { classifyEvidenceStrength } from '@core/rag';
import { useToastStore } from '@core/store/toastStore';
import { classify } from '@core/topic/MeshClassifier';
import type { EvidenceItem } from '@platform/index';
import { FeatureBoundary } from '@ui/errors/FeatureBoundary';

import { AgentPanel, initialAgentStatuses, type AgentStatus } from './components/AgentPanel';
import { citedEvidenceFor, memoryTopicLabel } from './memoryTopic';
import { isMetaOrAppQuestion } from './swarm/paper';
import { isConfidentInteractionReport } from './swarm/boss';
import { BrainCanvas } from './components/BrainCanvas';
import { Composer } from './components/Composer';
import { DrugInteractionPanel } from './components/DrugInteractionPanel';
import { Transcript, type ChatMessage } from './components/Transcript';
import { BRAIN_MODEL } from './data/modelParts';
import { SOURCE_DEFS } from './data/sources';
import { labelForModel, summarizeEvidence, TOPIC_THROTTLE_MS } from './researchPipeline';
import { runSwarm } from './swarm/runSwarm';
import { buildPaperOutline } from './swarm/paperPipeline';
import { summarizeDatasetText, summarizeDatasetXlsx } from './swarm/statistics';
import type { BossPhase, SwarmCallbacks } from './swarm/types';
import type { UploadedDatasetSummary } from './swarm/publicationTypes';

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'system',
  content:
    'Ask the boss anything. It routes plain questions to a quick chat reply, and research questions to a swarm of medical specialists that fetch guarded evidence and answer with citations.',
};

// `drugFocus` is set by the Drug-Interactions mode/tab, which reuses this same
// chat experience but routes every question to the dedicated interaction report.
export function BrainMode({ drugFocus = false }: { drugFocus?: boolean } = {}) {
  const [selectedRegion, setSelectedRegion] = useState<RegionId | null>(null);
  const [hoveredRegion, setHoveredRegion] = useState<RegionId | null>(null);
  const modelGroups = useModelCatalogStore((s) => s.groups);
  const availableModels = useMemo(() => modelGroups.flatMap((group) => group.models), [modelGroups]);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [dataset, setDataset] = useState<UploadedDatasetSummary | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const activeChatId = useChatHistoryStore((s) => s.activeChatId);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const [agentStatuses, setAgentStatuses] = useState<AgentStatus[]>(initialAgentStatuses);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const canSubmit = query.trim().length > 0;
  // Placeholder label for a pending bubble — the boss model. The final
  // bubble is relabelled with the model that actually answered.
  const modelLabel = useMemo(() => labelForModel(agentModelFor('boss')), [modelGroups]);
  const isMounted = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      isMounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const attachDataset = async (file: File) => {
    try {
      const isExcel = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');
      const summary = isExcel
        ? await summarizeDatasetXlsx(file.name, await file.arrayBuffer())
        : await summarizeDatasetText(file.name, await file.text());
      setDataset(summary);
      useToastStore.getState().show(`Dataset attached: ${summary.rows} rows`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      useToastStore.getState().show(`Dataset rejected: ${detail}`, 'error');
    }
  };

  // Clicking the same region twice clears the selection. Stable identity so
  // the memoised BrainCanvas does not bail out of memoisation on every render.
  const toggleRegion = useCallback((region: RegionId | null) => {
    setSelectedRegion((current) => (current === region ? null : region));
  }, []);

  const updateAgentStatus = (agentId: AgentId, update: Partial<AgentStatus>) => {
    setAgentStatuses((current) =>
      current.map((status) => (status.agentId === agentId ? { ...status, ...update } : status)),
    );
  };

  const lightRegion = (
    region: RegionId,
    source: 'agent' | 'topic',
    intensity: number,
    ttlMs: number,
    agentId?: AgentId,
  ) => {
    bus.emit('region:light', {
      region,
      source,
      intensity,
      ttlMs,
      ...(agentId ? { agentId } : {}),
    });
  };

  // Load a transcript when one is opened from the left rail. activeChatId
  // only becomes non-null after an explicit rail action or the first
  // saved turn, so this never clobbers an in-progress conversation.
  // Brain and Drug-Interactions are separate histories. Both instances stay
  // mounted, so each only loads the active chat when it belongs to ITS mode.
  const chatMode = drugFocus ? 'drug_interactions' : 'brain';
  useEffect(() => {
    if (!activeChatId) return;
    const chat = useChatHistoryStore.getState().chats.find((c) => c.id === activeChatId);
    if (!chat || (chat.mode ?? 'brain') !== chatMode) return;
    setMessages(chat.messages.length > 0 ? chat.messages : [WELCOME_MESSAGE]);
  }, [activeChatId, chatMode]);

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
    useChatHistoryStore.getState().saveActive(messages, chatMode);
  }, [isRunning, messages, chatMode]);

  const toConversation = (turns: ChatMessage[]): LlmMessage[] =>
    turns.flatMap<LlmMessage>((message) => {
      if (message.role === 'user') return [{ role: 'user', content: message.content }];
      if (message.role === 'assistant' && !message.critiqueOf && message.content.trim()) {
        return [{ role: 'assistant', content: message.content }];
      }
      return [];
    });

  const runTurn = async (
    cleanQuery: string,
    baseMessages: ChatMessage[],
    appendUser: boolean,
    forceDraft = false,
  ) => {
    if (!cleanQuery || isRunning) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: cleanQuery };
    const nextMessages = appendUser ? [...baseMessages, userMessage] : baseMessages;
    const conversation = toConversation(appendUser ? baseMessages : baseMessages.slice(0, -1));

    setQuery('');
    setEditingMessageId(null);
    setAgentStatuses(initialAgentStatuses());
    setEvidence([]);
    setMessages(nextMessages);

    // Outline-first: propose the paper's structure (deterministic, no tokens)
    // and stop — the user approves with "Draft full paper", which re-enters
    // runTurn with forceDraft so the real pipeline runs.
    if (!forceDraft && !drugFocus && useBrainModesStore.getState().outlineFirst) {
      const outline = buildPaperOutline(cleanQuery, useBrainModesStore.getState().mini);
      const body = [
        '## Proposed paper outline',
        '',
        `**${outline.title}**`,
        '',
        ...outline.sections.map((s, i) => `${i + 1}. **${s.heading}** — ${s.intent}`),
        '',
        '_Review the structure above, then click **Draft full paper** to generate it — or refine your request and resubmit._',
      ].join('\n');
      setMessages([
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: body,
          modelLabel,
          outlineProposal: { query: cleanQuery },
        },
      ]);
      return;
    }

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
    abortRef.current?.abort();
    abortRef.current = new AbortController();
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
        lightRegion(hit.region, 'topic', Math.max(0.35, Math.min(0.9, hit.confidence * 0.85)), 1450);
      }
    };

    const sourceForTool = (toolName: string) => SOURCE_DEFS.find((def) => def.tool === toolName);
    let activeRunId: string | null = null;
    const ensureResearchRun = () => {
      if (!activeRunId) activeRunId = runs.startRun(cleanQuery, []).id;
      return activeRunId;
    };

    const bossDetail: Record<BossPhase, string> = {
      routing: 'routing message',
      delegating: 'delegating to specialists',
      synthesizing: 'synthesizing specialist findings',
      answering: 'normal chat',
    };

    const callbacks: SwarmCallbacks = {
      onBossPhase: (phase) => {
        if (!isMounted.current) return;
        if (phase === 'delegating' || phase === 'synthesizing') ensureResearchRun();
        updateAgentStatus('boss', { state: 'running', detail: bossDetail[phase] });
        bus.emit('agent:activity', {
          agentId: 'boss',
          phase: phase === 'routing' || phase === 'answering' ? 'start' : 'tool_call',
          detail: bossDetail[phase],
          light: {
            intensity: phase === 'answering' ? 0.55 : 0.82,
            ttlMs: phase === 'routing' ? 1100 : 2100,
          },
        });
      },
      onSpecialistStart: (agentId, subQuery) => {
        if (!isMounted.current) return;
        ensureResearchRun();
        updateAgentStatus(agentId, { state: 'running', detail: subQuery });
        bus.emit('agent:activity', {
          agentId,
          phase: 'start',
          detail: subQuery,
          light: { intensity: 0.86, ttlMs: 2400 },
        });
      },
      onSpecialistDone: (agentId, recordCount) => {
        if (!isMounted.current) return;
        updateAgentStatus(agentId, {
          state: 'done',
          detail: `${recordCount} record${recordCount === 1 ? '' : 's'}`,
        });
        bus.emit('agent:activity', {
          agentId,
          phase: 'done',
          detail: `${recordCount} records`,
          light: { intensity: recordCount > 0 ? 0.72 : 0.38, ttlMs: recordCount > 0 ? 1700 : 900 },
        });
      },
      onSpecialistError: (agentId, message) => {
        if (!isMounted.current) return;
        updateAgentStatus(agentId, { state: 'error', detail: message });
        bus.emit('agent:activity', {
          agentId,
          phase: 'error',
          detail: message,
          light: { intensity: 0.42, ttlMs: 1200 },
        });
      },
      onToolCall: (agentId, toolName) => {
        if (!isMounted.current) return;
        const def = sourceForTool(toolName);
        if (def) lightRegion(def.region, 'topic', 0.55, 1250);
        bus.emit('agent:activity', {
          agentId,
          phase: 'tool_call',
          detail: def?.label ?? toolName,
          light: { intensity: 0.68, ttlMs: 1600 },
        });
      },
      onToolResult: (agentId, toolName, count) => {
        if (!isMounted.current) return;
        const def = sourceForTool(toolName);
        if (def && count > 0) lightRegion(def.region, 'topic', Math.min(0.88, 0.42 + count / 30), 1550);
        bus.emit('agent:activity', {
          agentId,
          phase: 'tool_result',
          detail: `${def?.label ?? toolName}: ${count}`,
          light: { intensity: count > 0 ? 0.76 : 0.36, ttlMs: count > 0 ? 1700 : 850 },
        });
      },
      onAnswerToken: (delta) => {
        if (!isMounted.current) return;
        streamedContent += delta;
        setMessages((current) => current.map((m) => (m.id === assistantId ? { ...m, content: streamedContent } : m)));
        flushTopicHits(streamedContent);
      },
      onManuscriptSection: (heading) => {
        if (!isMounted.current) return;
        // A paper is compiled through automatic source, extraction, claim,
        // draft, QA, and export-gate stages (no token stream).
        const pipelineStages = new Set(['Searching', 'Extracting', 'Building claims', 'Drafting', 'QA repair', 'Export ready', 'blocked']);
        const isPipelineStage = pipelineStages.has(heading);
        const label = isPipelineStage ? `Paper pipeline - ${heading}` : `Drafting manuscript - ${heading}`;
        updateAgentStatus('boss', { state: heading === 'blocked' ? 'error' : 'running', detail: label });
        bus.emit('agent:activity', {
          agentId: 'boss',
          phase: 'token',
          detail: label,
          light: { intensity: 0.88, ttlMs: 2300 },
        });
        setMessages((current) =>
          current.map((m) =>
            m.id === assistantId ? { ...m, content: `${label}...` } : m,
          ),
        );
      },
    };

    try {
      const result = await runSwarm({
        question: cleanQuery,
        conversation,
        dataset,
        modelFor: agentModelFor,
        callbacks,
        signal: abortRef.current?.signal,
        mini: useBrainModesStore.getState().mini,
        drugFocus,
      });

      flushTopicHits(result.answer || streamedContent);
      const finalContent =
        result.answer ||
        streamedContent ||
        (result.kind === 'research' ? summarizeEvidence(result.evidence) : 'No response returned by the selected model.');

      if (!isMounted.current) return;
      if (result.kind === 'research') {
        const runId = ensureResearchRun();
        setEvidence(result.evidence);
        runs.storeEvidence(runId, result.evidence);
        runs.storeSummary(runId, finalContent, result.modelUsed);

        // Save this run into the active project's memory — but only as a
        // valuable, subject-organised finding, not a dump of everything:
        //   • skip meta / app-introspection turns,
        //   • keep only the evidence the answer actually cited (drop the
        //     off-topic retrieval that was never used, and skip turns that
        //     cited nothing — refusals / no-evidence answers),
        //   • file it under a clean subject topic, not the raw query string.
        const memoryTopic = memoryTopicLabel(cleanQuery);
        const citableForMemory = citedEvidenceFor(finalContent, result.evidence);
        // The Drug-Interactions mode contributes to the shared memory ONLY when
        // it reached a confident verdict (so the app is fed sure answers, not
        // "insufficient evidence" reports), and tags its findings so its own
        // retrieval stays isolated to this trusted domain.
        const diTag = drugFocus ? 'drug_interactions' : undefined;
        const diConfident = !drugFocus || isConfidentInteractionReport(finalContent);
        if (
          activeProjectId &&
          memoryTopic &&
          citableForMemory.length > 0 &&
          !isMetaOrAppQuestion(cleanQuery) &&
          diConfident
        ) {
          const evidenceChunks: NewRagChunk[] = citableForMemory.map((item) => {
            const strength = classifyEvidenceStrength(
              [item.title, item.snippet ?? ''].join(' '),
              item.source,
            );
            return {
              kind: 'evidence',
              title: item.title,
              text: [item.title, item.snippet ?? ''].filter(Boolean).join(' — '),
              source: item.source,
              runId,
              query: memoryTopic,
              // Carry the medical metadata forward so memory ranks by evidence
              // strength + recency (search/ranking.ts), not just text overlap.
              ...(item.url ? { url: item.url } : {}),
              ...(item.year != null ? { year: item.year } : {}),
              ...(item.identifiers?.pmid ? { pmid: item.identifiers.pmid } : {}),
              ...(item.identifiers?.doi ? { doi: item.identifiers.doi } : {}),
              ...(item.authors?.length ? { authors: item.authors.slice(0, 8) } : {}),
              ...(strength ? { evidenceStrength: strength } : {}),
              ...(diTag ? { tag: diTag } : {}),
            };
          });
          const answerChunk: NewRagChunk = {
            kind: 'answer',
            title: memoryTopic,
            text: finalContent,
            source: 'answer',
            runId,
            query: memoryTopic,
            ...(diTag ? { tag: diTag } : {}),
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
                ...(result.kind === 'research' ? { citations: result.evidence.slice(0, 60) } : {}),
                ...(result.manuscript ? { manuscript: result.manuscript } : {}),
              }
            : m,
        ),
      );
      updateAgentStatus('boss', {
        state: 'done',
        detail: result.kind === 'research' ? 'synthesis complete' : 'reply complete',
      });
      bus.emit('agent:activity', {
        agentId: 'boss',
        phase: 'done',
        detail: `${result.kind} · ${labelForModel(result.modelUsed)}`,
        light: { intensity: result.kind === 'research' ? 0.74 : 0.52, ttlMs: 1800 },
      });
    } catch (error) {
      if (!isMounted.current) return;
      const detail = error instanceof Error ? error.message : String(error);
      const fallback = streamedContent || `HashCerebrum could not complete the request: ${detail}`;
      if (activeRunId) runs.failRun(activeRunId, detail);
      updateAgentStatus('boss', { state: 'error', detail });
      setMessages((current) =>
        current.map((m) =>
          m.id === assistantId ? { ...m, content: fallback, error: detail, isStreaming: false } : m,
        ),
      );
      bus.emit('agent:activity', {
        agentId: 'boss',
        phase: 'error',
        detail,
        light: { intensity: 0.46, ttlMs: 1200 },
      });
    } finally {
      if (isMounted.current) setIsRunning(false);
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

  // Approve an outline proposal: run the real pipeline for the stored query.
  const draftFromOutline = (query: string) => {
    if (isRunning) return;
    void runTurn(query, messages, false, true);
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
    lightRegion('amygdala', 'topic', 0.86, 2200);

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
            lightRegion('amygdala', 'topic', 0.48, 900);
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
      lightRegion('amygdala', 'topic', 0.62, 1500);
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
      lightRegion('amygdala', 'topic', 0.42, 1100);
    }
  };

  return (
    <div className={`mode brain-mode brain-workspace${drugFocus ? ' brain-mode--drug' : ''}`}>
      <section className="research-chat" aria-label="Brain research chat">
        <header className="chat-header">
          <div className="chat-header-row">
            <h1 className="cerebrum-title"><em>The</em> Cerebrum</h1>
            <div className="chat-meta">
              <span className="chat-meta-line">
                <span>{messages.filter((m) => m.role !== 'system').length} TURNS</span>
                {isRunning && <><span className="dot-sep">·</span><span>RUNNING</span></>}
              </span>
              {evidence.length > 0 && (
                <span className="chat-meta-evidence">
                  <b>{evidence.length}</b> EVIDENCE
                </span>
              )}
            </div>
          </div>
          <div className="lede">
            <span className="tip">Tip</span>
            <span>Set a large model as the Boss in Settings for the best results.</span>
          </div>
        </header>

        <FeatureBoundary name="Transcript">
          <Transcript
            messages={messages}
            modelLabel={modelLabel}
            isRunning={isRunning}
            onCritique={runCritique}
            onRegenerate={regenerateMessage}
            onEdit={editMessage}
            onDraftOutline={draftFromOutline}
            onPromptSelect={(prompt) => { if (!isRunning) setQuery(prompt); }}
            drugFocus={drugFocus}
          />
        </FeatureBoundary>

        <FeatureBoundary name="Composer">
          <Composer
            query={query}
            setQuery={setQuery}
            isRunning={isRunning}
            canSubmit={canSubmit}
            editing={!!editingMessageId}
            datasetLabel={dataset?.filename ?? null}
            datasetDetail={dataset ? `${dataset.rows} rows · ${dataset.columns.length} columns` : null}
            onDatasetFile={(file) => void attachDataset(file)}
            onClearDataset={() => setDataset(null)}
            onCancelEdit={() => {
              setEditingMessageId(null);
              setQuery('');
            }}
            onSubmit={submit}
            onOpenSettings={() => window.dispatchEvent(new CustomEvent('hc:open-settings'))}
            {...(drugFocus
              ? { placeholder: 'Ask about a drug interaction — e.g. “warfarin and grapefruit”. Get a cited interaction report.' }
              : {})}
          />
        </FeatureBoundary>
      </section>

      <section className={`brain-side${drugFocus ? ' brain-side--solo' : ''}`}>
        {drugFocus ? (
          // Specialised layout for Drug-Interactions: no 3D brain and no agent
          // swarm panel — just the interaction-grade key beside the report.
          <FeatureBoundary name="Drug interaction panel">
            <DrugInteractionPanel />
          </FeatureBoundary>
        ) : (
          <>
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
              <FeatureBoundary name="Agents">
                <AgentPanel statuses={agentStatuses} />
              </FeatureBoundary>
            </div>
          </>
        )}
      </section>

    </div>
  );
}
