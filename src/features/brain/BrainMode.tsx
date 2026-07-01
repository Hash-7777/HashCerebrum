// Brain workspace — the boss-swarm research surface. The boss routes each
// message, delegates research to topic specialists, and synthesizes one
// cited answer; failover covers a rate-limited or dead-credit provider.
//
// The mode is split into small components (Composer, Transcript,
// BrainCanvas, AgentPanel, SettingsPanel) so a crash in one stays
// contained by FeatureBoundary instead of taking the workspace down.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AgentId, RegionId } from '@config/agents';
import { bus } from '@core/bus/EventBus';
import { streamWithModelChain } from '@core/llm/ProviderRegistry';
import type { LlmMessage } from '@core/llm/types';
import { agentModelFor } from '@core/store/agentModelStore';
import { useBrainModesStore } from '@core/store/brainModesStore';
import { notify } from '@platform/notify';
import { useChatHistoryStore } from '@core/store/chatHistoryStore';
import { useProjectStore } from '@core/store/projectStore';
import { exportChatMarkdown, exportChatPdf } from './export/messageExport';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';
import { useResearchRunStore } from '@core/store/researchRunStore';
import { useRagStore, type NewRagChunk } from '@core/store/ragStore';
import { classifyEvidenceStrength } from '@core/rag';
import { useToastStore } from '@core/store/toastStore';
import { classify } from '@core/topic/MeshClassifier';
import type { EvidenceItem } from '@platform/index';
import { FeatureBoundary } from '@ui/errors/FeatureBoundary';

import { AgentPanel, initialAgentStatuses, type AgentStatus } from './components/AgentPanel';
import { BrainCanvas2D } from './components/BrainCanvas2D';
import { citedEvidenceFor, memoryTopicLabel } from './memoryTopic';
import { isMetaOrAppQuestion } from './swarm/paper';
import { isConfidentGeneReport, isConfidentInteractionReport } from './swarm/boss';
import { useLowEndDevice } from '@ui/hooks/useLowEndDevice';
// Lazy so the heavy three.js / WebGL bundle and the 3D brain model load ONLY
// when the canvas is actually rendered — never in Lite mode or on weak hardware.
const BrainCanvas = lazy(() =>
  import('./components/BrainCanvas').then((m) => ({ default: m.BrainCanvas })),
);
import { Composer } from './components/Composer';
import { DrugInteractionPanel } from './components/DrugInteractionPanel';
import { GeneticsPanel } from './components/GeneticsPanel';
import { ClaimLedgerPanel } from './components/ClaimLedgerPanel';
import type { ClaimLedgerEntry } from './swarm/publicationTypes';
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

// `drugFocus` / `geneticsFocus` are set by the Drug-Interactions and Genetics
// modes, which reuse this same chat experience but route every question to a
// dedicated report (interaction grading / gene-variant correlation).
export function BrainMode({
  drugFocus = false,
  geneticsFocus = false,
}: { drugFocus?: boolean; geneticsFocus?: boolean } = {}) {
  // Both reuse the solo (no 3D brain, no swarm panel) layout and a single
  // specialist pipeline.
  const soloFocus = drugFocus || geneticsFocus;
  // Lite mode: skip the 3D brain entirely (no three.js, no GLB, no GPU) and show
  // the 2D agent panel instead. Auto-enabled on weak hardware; user-overridable.
  const autoLowEnd = useLowEndDevice();
  const litePref = useBrainModesStore((s) => s.lite);
  const lite = litePref === 'on' || (litePref === 'auto' && autoLowEnd);
  const [selectedRegion, setSelectedRegion] = useState<RegionId | null>(null);
  const [hoveredRegion, setHoveredRegion] = useState<RegionId | null>(null);
  const modelGroups = useModelCatalogStore((s) => s.groups);
  const availableModels = useMemo(() => modelGroups.flatMap((group) => group.models), [modelGroups]);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [dataset, setDataset] = useState<UploadedDatasetSummary | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const activeChatId = useChatHistoryStore((s) => s.activeChatId);
  const activeChat = useMemo(
    () => useChatHistoryStore.getState().chats.find((c) => c.id === activeChatId),
    [activeChatId],
  );
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeProject = useProjectStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const clearActive = useChatHistoryStore((s) => s.clearActive);
  const exportTitle = activeChat?.title || 'The Brain';
  const [agentStatuses, setAgentStatuses] = useState<AgentStatus[]>(initialAgentStatuses);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [claimLedgerOpen, setClaimLedgerOpen] = useState(false);
  const [pendingClaims, setPendingClaims] = useState<ClaimLedgerEntry[] | null>(null);
  const claimLedgerResolve = useRef<((ledger: ClaimLedgerEntry[]) => void) | null>(null);
  const claimLedgerReject = useRef<(() => void) | null>(null);
  const [draftProgress, setDraftProgress] = useState<string | null>(null);
  const draftingAssistantId = useRef<string | null>(null);
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

  const stopRun = () => {
    abortRef.current?.abort();
    if (isMounted.current) {
      setIsRunning(false);
      setDraftProgress(null);
      setMessages((current) => {
        const last = current[current.length - 1];
        if (last && last.role === 'assistant' && last.isStreaming) {
          return [
            ...current.slice(0, -1),
            { ...last, content: 'Run stopped by user.', isStreaming: false },
          ];
        }
        return current;
      });
    }
  };

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
  const chatMode = drugFocus ? 'drug_interactions' : geneticsFocus ? 'genetics' : 'brain';
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
    if (!forceDraft && !soloFocus && useBrainModesStore.getState().outlineFirst) {
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
    const traceEntries: import('@core/store/chatHistoryStore').TurnTraceEntry[] = [];
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
        traceEntries.push({ agent: 'boss', phase, detail: bossDetail[phase] });
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
        traceEntries.push({ agent: agentId, phase: 'start', detail: subQuery });
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
        const detail = `${recordCount} record${recordCount === 1 ? '' : 's'}`;
        traceEntries.push({ agent: agentId, phase: 'done', detail });
        bus.emit('agent:activity', {
          agentId,
          phase: 'done',
          detail,
          light: { intensity: recordCount > 0 ? 0.72 : 0.38, ttlMs: recordCount > 0 ? 1700 : 900 },
        });
      },
      onSpecialistError: (agentId, message) => {
        if (!isMounted.current) return;
        updateAgentStatus(agentId, { state: 'error', detail: message });
        traceEntries.push({ agent: agentId, phase: 'error', detail: message });
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
        const detail = def?.label ?? toolName;
        traceEntries.push({ agent: agentId, phase: 'tool_call', detail });
        bus.emit('agent:activity', {
          agentId,
          phase: 'tool_call',
          detail,
          light: { intensity: 0.68, ttlMs: 1600 },
        });
      },
      onToolResult: (agentId, toolName, count) => {
        if (!isMounted.current) return;
        const def = sourceForTool(toolName);
        if (def && count > 0) lightRegion(def.region, 'topic', Math.min(0.88, 0.42 + count / 30), 1550);
        const detail = `${def?.label ?? toolName}: ${count}`;
        traceEntries.push({ agent: agentId, phase: 'tool_result', detail });
        bus.emit('agent:activity', {
          agentId,
          phase: 'tool_result',
          detail,
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
        traceEntries.push({ agent: 'boss', phase: 'manuscript', detail: label });
        bus.emit('agent:activity', {
          agentId: 'boss',
          phase: 'token',
          detail: label,
          light: { intensity: 0.88, ttlMs: 2300 },
        });
        setDraftProgress(label);
        setMessages((current) =>
          current.map((m) =>
            m.id === assistantId ? { ...m, content: `${label}...` } : m,
          ),
        );
      },
    };

    const handlePaperDraftComplete = (result: import('./swarm/types').SwarmResult) => {
      if (!isMounted.current) return;
      const draftId = draftingAssistantId.current;
      if (!draftId) return;
      const content = result.answer || 'Drafting completed.';
      setDraftProgress(null);
      setEvidence(result.evidence);
      setMessages((current) =>
        current.map((m) =>
          m.id === draftId
            ? {
                ...m,
                content,
                modelLabel: labelForModel(result.modelUsed),
                isStreaming: false,
                trace: traceEntries,
                ...(result.kind === 'research' ? { citations: result.evidence.slice(0, 60) } : {}),
                ...(result.manuscript ? { manuscript: result.manuscript } : {}),
              }
            : m,
        ),
      );
      if (result.manuscript) {
        void notify('Manuscript complete', 'Your research paper is ready for review and export.');
      }
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
      // Save memory (same logic as the synchronous path)
      if (result.kind === 'research' && activeProjectId) {
        const runId = ensureResearchRun();
        runs.storeEvidence(runId, result.evidence);
        runs.storeSummary(runId, content, result.modelUsed);
        const memoryTopic = memoryTopicLabel(cleanQuery);
        const citableForMemory = citedEvidenceFor(content, result.evidence);
        if (memoryTopic && citableForMemory.length > 0 && !isMetaOrAppQuestion(cleanQuery)) {
          const evidenceChunks: NewRagChunk[] = citableForMemory.map((item) => {
            const strength = classifyEvidenceStrength([item.title, item.snippet ?? ''].join(' '), item.source);
            return {
              kind: 'evidence',
              title: item.title,
              text: [item.title, item.snippet ?? ''].filter(Boolean).join(' — '),
              source: item.source,
              runId,
              query: memoryTopic,
              ...(item.url ? { url: item.url } : {}),
              ...(item.year != null ? { year: item.year } : {}),
              ...(item.identifiers?.pmid ? { pmid: item.identifiers.pmid } : {}),
              ...(item.identifiers?.doi ? { doi: item.identifiers.doi } : {}),
              ...(item.authors?.length ? { authors: item.authors.slice(0, 8) } : {}),
              ...(strength ? { evidenceStrength: strength } : {}),
            };
          });
          const answerChunk: NewRagChunk = {
            kind: 'answer',
            title: memoryTopic,
            text: content,
            source: 'answer',
            runId,
            query: memoryTopic,
          };
          useRagStore.getState().addChunks(activeProjectId, [...evidenceChunks, answerChunk]);
        }
      }
      setIsRunning(false);
    };

    try {
      draftingAssistantId.current = assistantId;
      const result = await runSwarm({
        question: cleanQuery,
        conversation,
        dataset,
        modelFor: agentModelFor,
        callbacks,
        signal: abortRef.current?.signal,
        mini: useBrainModesStore.getState().mini,
        drugFocus,
        geneticsFocus,
        onClaimLedger: (ledger) =>
          new Promise((resolve, reject) => {
            claimLedgerResolve.current = resolve;
            claimLedgerReject.current = reject;
            setPendingClaims(ledger);
            setClaimLedgerOpen(true);
          }),
        onPaperDraftComplete: handlePaperDraftComplete,
      });

      // If the pipeline is drafting in the background, keep the UI alive
      // and do NOT run the synchronous completion logic below.
      if (result.kind === 'drafting') {
        if (!isMounted.current) return;
        setMessages((current) =>
          current.map((m) =>
            m.id === assistantId
              ? { ...m, content: result.answer, isStreaming: false }
              : m,
          ),
        );
        return;
      }

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
        // Tag findings to the mode's domain so its retrieval stays isolated,
        // and only feed shared memory on a confident result (drug interactions:
        // a clear verdict; genetics: a non-insufficient association band).
        const memoryTag = drugFocus ? 'drug_interactions' : geneticsFocus ? 'genetics' : undefined;
        const soloConfident = drugFocus
          ? isConfidentInteractionReport(finalContent)
          : geneticsFocus
            ? isConfidentGeneReport(finalContent)
            : true;
        if (
          activeProjectId &&
          memoryTopic &&
          citableForMemory.length > 0 &&
          !isMetaOrAppQuestion(cleanQuery) &&
          soloConfident
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
              ...(memoryTag ? { tag: memoryTag } : {}),
            };
          });
          const answerChunk: NewRagChunk = {
            kind: 'answer',
            title: memoryTopic,
            text: finalContent,
            source: 'answer',
            runId,
            query: memoryTopic,
            ...(memoryTag ? { tag: memoryTag } : {}),
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
                trace: traceEntries,
                ...(result.kind === 'research' ? { citations: result.evidence.slice(0, 60) } : {}),
                ...(result.manuscript ? { manuscript: result.manuscript } : {}),
              }
            : m,
        ),
      );
      if (result.manuscript) {
        void notify('Manuscript complete', 'Your research paper is ready for review and export.');
      }
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
          m.id === assistantId ? { ...m, content: fallback, error: detail, isStreaming: false, trace: traceEntries } : m,
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
            if (!isMounted.current) return;
            buffer += delta;
            setMessages((current) =>
              current.map((m) => (m.id === critiqueId ? { ...m, content: buffer } : m)),
            );
            lightRegion('amygdala', 'topic', 0.48, 900);
          },
          signal: abortRef.current?.signal,
        },
      );
      if (!isMounted.current) return;
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
      if (!isMounted.current) return;
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
    <div className={`mode brain-mode brain-workspace${drugFocus ? ' brain-mode--drug' : ''}${geneticsFocus ? ' brain-mode--genetics' : ''}`}>
      <section className="research-chat" aria-label="Brain research chat">
        <header className="chat-header">
          <div className="chat-header-row">
            <h1 className="brain-title"><em>The</em> Brain</h1>
            <div className="chat-meta">
              <span className="chat-meta-line">
                <span>{messages.filter((m) => m.role !== 'system').length} TURNS</span>
                {isRunning && <><span className="dot-sep">·</span><span>RUNNING</span></>}
                {draftProgress && <><span className="dot-sep">·</span><span className="draft-progress">{draftProgress}</span></>}
              </span>
              <span className="chat-export-actions">
                {messages.filter((m) => m.role !== 'system').length > 0 ? (
                  // Working state: compact export actions only. The onboarding tip
                  // is dropped here so the long prose + buttons no longer share one
                  // nowrap line that overflowed and clipped the header.
                  <>
                    <button type="button" onClick={() => exportChatMarkdown(messages, { title: exportTitle, mode: chatMode, project: activeProject?.name, messageCount: messages.filter((m) => m.role !== 'system').length })}>Export MD</button>
                    <button type="button" onClick={() => void exportChatPdf(messages, { title: exportTitle, mode: chatMode, project: activeProject?.name, messageCount: messages.filter((m) => m.role !== 'system').length })}>Export PDF</button>
                    <button
                      type="button"
                      className="chat-clear-btn"
                      onClick={() => {
                        clearActive();
                        setMessages([WELCOME_MESSAGE]);
                        setDataset(null);
                        setEvidence([]);
                      }}
                      title="Clear workspace"
                    >
                      Clear
                    </button>
                  </>
                ) : null}
              </span>
              {evidence.length > 0 && (
                <span className="chat-meta-evidence">
                  <b>{evidence.length}</b> EVIDENCE
                </span>
              )}
            </div>
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
            geneticsFocus={geneticsFocus}
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
            onStop={stopRun}
            onOpenSettings={() => window.dispatchEvent(new CustomEvent('hc:open-settings'))}
            {...(drugFocus
              ? { placeholder: 'Ask about a drug interaction — e.g. “warfarin and grapefruit”. Get a cited interaction report.' }
              : {})}
            {...(geneticsFocus
              ? { placeholder: 'Name a gene variant and a disease — e.g. “MICA TT genotype and cardiovascular complications”.' }
              : {})}
          />
        </FeatureBoundary>
      </section>

      <section className={`brain-side${soloFocus || lite ? ' brain-side--solo' : ''}`}>
        {drugFocus ? (
          // Specialised layout for Drug-Interactions: no 3D brain and no agent
          // swarm panel — just the interaction-grade key beside the report.
          <FeatureBoundary name="Drug interaction panel">
            <DrugInteractionPanel />
          </FeatureBoundary>
        ) : geneticsFocus ? (
          // Specialised layout for Genetics: no 3D brain — the confidence-band
          // key beside the correlation report.
          <FeatureBoundary name="Genetics panel">
            <GeneticsPanel />
          </FeatureBoundary>
        ) : lite ? (
          // Lite mode: no WebGL / 3D — a 2D SVG brain carries the same
          // region/agent activity as the 3D scene, above the agent panel, so
          // weak or no-GPU hardware runs full-speed with no loss of any feature.
          <>
            <FeatureBoundary name="Brain (2D)">
              <div className="brain-model-panel">
                <BrainCanvas2D statuses={agentStatuses} />
              </div>
            </FeatureBoundary>
            <FeatureBoundary name="Agents">
              <AgentPanel statuses={agentStatuses} />
            </FeatureBoundary>
          </>
        ) : (
          <>
            <FeatureBoundary name="Brain canvas" resetKey={BRAIN_MODEL.path}>
              <div className="brain-model-panel">
                <div className="brain-stage">
                  <Suspense
                    fallback={
                      <div className="brain-empty" role="status">
                        <p className="brain-empty-title">Loading 3D brain…</p>
                      </div>
                    }
                  >
                    <BrainCanvas
                      selectedRegion={selectedRegion}
                      hoveredRegion={hoveredRegion}
                      onSelectRegion={toggleRegion}
                      onHoverRegion={setHoveredRegion}
                    />
                  </Suspense>
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

      {claimLedgerOpen && pendingClaims && (
        <div className="claim-ledger-overlay">
          <ClaimLedgerPanel
            ledger={pendingClaims}
            onSubmit={(ledger) => {
              setClaimLedgerOpen(false);
              setPendingClaims(null);
              claimLedgerResolve.current?.(ledger);
              claimLedgerResolve.current = null;
              claimLedgerReject.current = null;
            }}
            onCancel={() => {
              setClaimLedgerOpen(false);
              setPendingClaims(null);
              claimLedgerReject.current?.();
              claimLedgerResolve.current = null;
              claimLedgerReject.current = null;
            }}
          />
        </div>
      )}

    </div>
  );
}
