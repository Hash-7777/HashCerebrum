// Shared types for the boss-swarm research engine: the boss decomposes a
// question, topic specialists research their angle in parallel, and the
// boss synthesizes one cited answer.

import type { AgentId } from '@config/agents';
import type { EvidenceItem } from '@platform/index';
import type { LlmMessage } from '@core/llm/types';
import type { Manuscript } from './manuscript';
import type { UploadedDatasetSummary } from './publicationTypes';
import type { GeneAssociation } from './genetics/associationConfidence';

export interface SpecialistTask {
  agentId: AgentId;
  subQuery: string;
}

export interface SpecialistResult {
  agentId: AgentId;
  label: string;
  subQuery: string;
  findings: string;
  evidence: EvidenceItem[];
  toolCalls: number;
  error?: string;
  /** The model this specialist ran on, so section drafting can be distributed
   *  across the specialists' providers instead of hammering one boss model. */
  model?: string;
}

export type BossPhase = 'routing' | 'delegating' | 'synthesizing' | 'answering';

export interface SwarmCallbacks {
  onBossPhase: (phase: BossPhase) => void;
  onSpecialistStart: (agentId: AgentId, subQuery: string) => void;
  onSpecialistDone: (agentId: AgentId, recordCount: number) => void;
  onSpecialistError: (agentId: AgentId, message: string) => void;
  onToolCall: (agentId: AgentId, toolName: string) => void;
  onToolResult: (agentId: AgentId, toolName: string, count: number) => void;
  onAnswerToken: (delta: string) => void;
  // Progress for a section-by-section manuscript draft (paper requests).
  onManuscriptSection?: (heading: string) => void;
}

export interface SwarmResult {
  kind: 'chat' | 'research' | 'drafting';
  answer: string;
  evidence: EvidenceItem[];
  specialists: SpecialistResult[];
  modelUsed: string;
  // Present for full-paper requests — the structured manuscript the PDF
  // export renders deterministically.
  manuscript?: Manuscript;
  // Present for a Genetics-mode result — the app-computed association-confidence
  // score per gene, rendered as a graded card.
  associations?: GeneAssociation[];
}

export interface SwarmOptions {
  question: string;
  // Prior conversation turns (user/assistant only, no system message).
  conversation: LlmMessage[];
  // Optional long-chat memory. When present, the boss model calls run on an
  // assembled context (rolling summary + semantically-recalled earlier turns +
  // recent window) instead of only the recent turns, so a long chat keeps its
  // context without resending the whole transcript. `recall` returns earlier
  // turns of THIS chat relevant to the query (from the isolated conversation
  // store, never the paper RAG). Absent = today's recent-window behaviour.
  contextMemory?: {
    summary?: string | undefined;
    recall?: ((query: string) => Promise<LlmMessage[]>) | undefined;
  };
  // Optional user-uploaded CSV/TSV summary for original-data manuscripts.
  dataset?: UploadedDatasetSummary | null;
  // Resolves the LLM model each agent runs on.
  modelFor: (agentId: AgentId) => string;
  callbacks: SwarmCallbacks;
  // Abort signal to cancel in-flight LLM streams when the component unmounts.
  signal?: AbortSignal;
  // Brain Mini: a lighter run — fewer specialists, a reduced manuscript section
  // set, smaller token budgets, and no rate-limit pausing — for free / small
  // local models.
  mini?: boolean;
  // Drug-Interactions focus: route to a single drug-interaction specialist that
  // writes a focused interaction report instead of the general research team.
  drugFocus?: boolean;
  // Genetics focus: route to the gene-expert specialist that returns a
  // gene-variant ↔ disease correlation report with an association-confidence
  // score, after clarifying the query if a gene or disease is missing.
  geneticsFocus?: boolean;
  // If provided, the paper pipeline pauses after claim extraction so the user
  // can curate claims before drafting begins.
  onClaimLedger?: (ledger: import('./publicationTypes').ClaimLedgerEntry[]) => Promise<import('./publicationTypes').ClaimLedgerEntry[]>;
  // Called when a background paper draft completes. The SwarmResult will have
  // kind 'research' and a manuscript. Only used when the pipeline runs async.
  onPaperDraftComplete?: (result: SwarmResult) => void;
}
