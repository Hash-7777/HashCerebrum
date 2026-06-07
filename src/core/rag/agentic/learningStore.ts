/**
 * Learning Store — persistent belief states, consensus timelines, knowledge
 * graphs, source reliability, episodic memory, learning queues, and semantic
 * drift records. Stored separately from the chunk store so the two can evolve
 * independently.
 */

import { create } from 'zustand';
import { platform } from '@platform/index';
import type {
  BeliefState,
  ConsensusTimeline,
  KnowledgeGraphNode,
  KnowledgeGraphEdge,
  SourceReliability,
  ResearchEpisode,
  LearningQueueItem,
  SemanticDriftRecord,
} from './types';

const LEARNING_KEY = 'hc.learning.v1';

interface LearningStoreState {
  beliefs: BeliefState[];
  timelines: ConsensusTimeline[];
  graphNodes: KnowledgeGraphNode[];
  graphEdges: KnowledgeGraphEdge[];
  sourceReliability: Record<string, SourceReliability>;
  episodes: ResearchEpisode[];
  learningQueue: LearningQueueItem[];
  driftRecords: SemanticDriftRecord[];
  hydrated: boolean;
}

interface LearningStore extends LearningStoreState {
  hydrate: () => Promise<void>;
  // Beliefs
  setBeliefs: (beliefs: BeliefState[]) => void;
  beliefsForChunk: (chunkId: string) => BeliefState[];
  topBeliefs: (limit?: number) => BeliefState[];
  // Timelines
  setTimelines: (timelines: ConsensusTimeline[]) => void;
  timelineForTopic: (topicKey: string) => ConsensusTimeline | undefined;
  // Graph
  setGraph: (nodes: KnowledgeGraphNode[], edges: KnowledgeGraphEdge[]) => void;
  nodesForChunk: (chunkId: string) => KnowledgeGraphNode[];
  edgesForChunk: (chunkId: string) => KnowledgeGraphEdge[];
  // Source reliability
  setSourceReliability: (map: Record<string, SourceReliability>) => void;
  reliabilityScore: (source: string) => number;
  // Episodes
  addEpisode: (episode: ResearchEpisode) => void;
  similarEpisodes: (query: string, limit?: number) => ResearchEpisode[];
  // Learning queue
  setLearningQueue: (queue: LearningQueueItem[]) => void;
  topPendingGaps: (projectId: string, limit?: number) => LearningQueueItem[];
  // Drift
  setDriftRecords: (records: SemanticDriftRecord[]) => void;
}

interface PersistShape {
  beliefs: BeliefState[];
  timelines: ConsensusTimeline[];
  graphNodes: KnowledgeGraphNode[];
  graphEdges: KnowledgeGraphEdge[];
  sourceReliability: Record<string, SourceReliability>;
  episodes: ResearchEpisode[];
  learningQueue: LearningQueueItem[];
  driftRecords: SemanticDriftRecord[];
}

async function loadPersisted(): Promise<PersistShape> {
  try {
    const data = await platform().storage.get<PersistShape>(LEARNING_KEY);
    if (data) return data;
  } catch {
    /* fall through */
  }
  return {
    beliefs: [],
    timelines: [],
    graphNodes: [],
    graphEdges: [],
    sourceReliability: {},
    episodes: [],
    learningQueue: [],
    driftRecords: [],
  };
}

function persist(state: LearningStoreState): void {
  void platform()
    .storage.set<PersistShape>(LEARNING_KEY, {
      beliefs: state.beliefs,
      timelines: state.timelines,
      graphNodes: state.graphNodes,
      graphEdges: state.graphEdges,
      sourceReliability: state.sourceReliability,
      episodes: state.episodes,
      learningQueue: state.learningQueue,
      driftRecords: state.driftRecords,
    })
    .catch((err: unknown) => console.error('[learningStore] persist failed:', err));
}

export const useLearningStore = create<LearningStore>((set, get) => ({
  beliefs: [],
  timelines: [],
  graphNodes: [],
  graphEdges: [],
  sourceReliability: {},
  episodes: [],
  learningQueue: [],
  driftRecords: [],
  hydrated: false,

  hydrate: async () => {
    const loaded = await loadPersisted();
    set({ ...loaded, hydrated: true });
  },

  setBeliefs: (beliefs) => {
    set({ beliefs });
    persist(get());
  },
  beliefsForChunk: (chunkId) =>
    get().beliefs.filter((b) => b.supportingChunks.includes(chunkId) || b.conflictingChunks.includes(chunkId)),
  topBeliefs: (limit = 20) =>
    [...get().beliefs]
      .sort((a, b) => b.beliefScore - a.beliefScore || b.revisionCount - a.revisionCount)
      .slice(0, limit),

  setTimelines: (timelines) => {
    set({ timelines });
    persist(get());
  },
  timelineForTopic: (topicKey) => get().timelines.find((t) => t.topicKey === topicKey),

  setGraph: (graphNodes, graphEdges) => {
    set({ graphNodes, graphEdges });
    persist(get());
  },
  nodesForChunk: (chunkId) => get().graphNodes.filter((n) => n.supportingChunks.includes(chunkId)),
  edgesForChunk: (chunkId) => get().graphEdges.filter((e) => e.supportingChunks.includes(chunkId)),

  setSourceReliability: (sourceReliability) => {
    set({ sourceReliability });
    persist(get());
  },
  reliabilityScore: (source) => get().sourceReliability[source]?.score ?? 0.5,

  addEpisode: (episode) => {
    set((state) => ({ episodes: [episode, ...state.episodes].slice(0, 500) }));
    persist(get());
  },
  similarEpisodes: (query, limit = 3) => {
    const terms = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
    if (terms.length === 0) return [];
    return get()
      .episodes.map((ep) => {
        const epTerms = new Set(ep.query.toLowerCase().split(/\s+/));
        const shared = terms.filter((t) => epTerms.has(t)).length;
        const overlap = shared / Math.max(terms.length, epTerms.size);
        return { ep, score: overlap };
      })
      .filter((s) => s.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.ep);
  },

  setLearningQueue: (learningQueue) => {
    set({ learningQueue });
    persist(get());
  },
  topPendingGaps: (projectId, limit = 5) =>
    get()
      .learningQueue.filter((q) => q.projectId === projectId && q.status === 'pending')
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit),

  setDriftRecords: (driftRecords) => {
    set({ driftRecords });
    persist(get());
  },
}));
