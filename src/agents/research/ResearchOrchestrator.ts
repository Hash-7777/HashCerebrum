import type { AgentId, RegionId } from '@config/agents';
import { AGENTS } from '@config/agents';
import { bus } from '@core/bus/EventBus';
import { useResearchRunStore, type ResearchAgentStep } from '@core/store/researchRunStore';
import { tools } from '@core/tools/ToolRegistry';
import type { EvidenceItem, MedicalSourceResult } from '@platform/index';

export interface ResearchSourcePlan {
  id: EvidenceItem['source'];
  label: string;
  tool: string;
  agentId: AgentId;
  region: RegionId;
}

export interface ResearchSourceUpdate {
  state?: 'idle' | 'running' | 'done' | 'error';
  count?: number;
  detail?: string;
}

export interface AgenticEvidenceResult {
  runId: string;
  evidence: EvidenceItem[];
}

const AGENT_LABEL = Object.fromEntries(AGENTS.map((agent) => [agent.id, agent.label])) as Record<AgentId, string>;

function sourceArgs(source: ResearchSourcePlan, query: string) {
  if (source.id === 'openfda') return { endpoint: 'drug/event', query, maxResults: 5 };
  if (source.id === 'rxnorm') return { drug: query };
  return { query, maxResults: 5 };
}

function dedupeEvidence(items: EvidenceItem[]) {
  const seen = new Set<string>();
  return items.filter((item, index) => {
    const key = item.url || item.identifiers.pmid || item.identifiers.doi || item.provenanceHash || `${item.source}-${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupByAgent(sources: ResearchSourcePlan[]) {
  const grouped = new Map<AgentId, ResearchSourcePlan[]>();
  for (const source of sources) {
    grouped.set(source.agentId, [...(grouped.get(source.agentId) ?? []), source]);
  }
  return Array.from(grouped.entries());
}

function initialSteps(sources: ResearchSourcePlan[]): ResearchAgentStep[] {
  return groupByAgent(sources).map(([agentId, agentSources]) => ({
    agentId,
    status: 'idle',
    sourceIds: agentSources.map((source) => source.id),
    recordCount: 0,
  }));
}

async function runSourceAgent({
  runId,
  agentId,
  agentSources,
  query,
  onSourceUpdate,
}: {
  runId: string;
  agentId: AgentId;
  agentSources: ResearchSourcePlan[];
  query: string;
  onSourceUpdate: (sourceId: EvidenceItem['source'], update: ResearchSourceUpdate) => void;
}) {
  const store = useResearchRunStore.getState();
  const region = agentSources[0]?.region ?? 'thalamus';
  const label = AGENT_LABEL[agentId];
  const startedAt = new Date().toISOString();

  store.updateStep(runId, agentId, { status: 'running', startedAt, detail: `${label} fetching` });
  bus.emit('agent:activity', { agentId, phase: 'start', detail: 'agentic fetch' });
  bus.emit('region:light', { region, source: 'agent', agentId, intensity: 0.78, ttlMs: 12_000 });

  const evidence: EvidenceItem[] = [];
  let failures = 0;

  for (const source of agentSources) {
    const tool = tools.get(source.tool);
    if (!tool) {
      failures += 1;
      onSourceUpdate(source.id, { state: 'error', count: 0, detail: `Tool not registered: ${source.tool}` });
      continue;
    }

    onSourceUpdate(source.id, { state: 'running', count: 0, detail: label });
    bus.emit('agent:activity', { agentId, phase: 'tool_call', detail: source.label });
    bus.emit('region:light', { region: source.region, source: 'agent', agentId, intensity: 0.75, ttlMs: 9000 });

    try {
      const result = (await tool.execute(sourceArgs(source, query))) as MedicalSourceResult;
      evidence.push(...result.results);
      onSourceUpdate(source.id, { state: 'done', count: result.results.length, detail: `${result.results.length} records` });
      bus.emit('agent:activity', { agentId, phase: 'tool_result', detail: `${source.label}: ${result.results.length}` });
    } catch (error) {
      failures += 1;
      const detail = error instanceof Error ? error.message : String(error);
      onSourceUpdate(source.id, { state: 'error', count: 0, detail });
      bus.emit('agent:activity', { agentId, phase: 'error', detail: source.label });
    }
  }

  const status = failures === agentSources.length ? 'error' : 'done';
  const detail = failures > 0 ? `${evidence.length} records, ${failures} source errors` : `${evidence.length} records stored`;
  store.updateStep(runId, agentId, {
    status,
    completedAt: new Date().toISOString(),
    recordCount: evidence.length,
    detail,
  });
  bus.emit('agent:activity', { agentId, phase: status === 'done' ? 'done' : 'error', detail });
  return evidence;
}

export async function runAgenticEvidencePass({
  query,
  sources,
  onSourceUpdate,
}: {
  query: string;
  sources: ResearchSourcePlan[];
  onSourceUpdate: (sourceId: EvidenceItem['source'], update: ResearchSourceUpdate) => void;
}): Promise<AgenticEvidenceResult> {
  const store = useResearchRunStore.getState();
  const run = store.startRun(query, initialSteps(sources));

  const agentResults = await Promise.all(
    groupByAgent(sources).map(([agentId, agentSources]) =>
      runSourceAgent({ runId: run.id, agentId, agentSources, query, onSourceUpdate }),
    ),
  );
  const evidence = dedupeEvidence(agentResults.flat());
  store.storeEvidence(run.id, evidence);

  bus.emit('agent:activity', { agentId: 'citation', phase: 'tool_result', detail: `stored ${evidence.length} records` });
  bus.emit('region:light', { region: 'occipital', source: 'agent', agentId: 'citation', intensity: 0.72, ttlMs: 9000 });

  return { runId: run.id, evidence };
}
