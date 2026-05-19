import type { AgentId } from '@config/agents';
import { AGENTS } from '@config/agents';
import { MODEL_GROUPS } from '@core/llm/modelCatalog';
import type { EvidenceItem } from '@platform/index';
import type { SourceStatus } from './components/SourceRunner';

export const SOURCE_AGENT_LABEL = Object.fromEntries(AGENTS.map((agent) => [agent.id, agent.label])) as Record<
  AgentId,
  string
>;

export const TOPIC_THROTTLE_MS = 400;

export function summarizeEvidence(items: EvidenceItem[]) {
  if (items.length === 0) {
    return 'No source records returned. Try a narrower biomedical query or run inside the Tauri app for live guarded fetching.';
  }
  return items
    .slice(0, 8)
    .map((item, index) => {
      const year = item.year ? ` (${item.year})` : '';
      const snippet = item.snippet ? ` ${item.snippet}` : '';
      return `[S${index + 1}] ${item.source.toUpperCase()}${year}: ${item.title}.${snippet}`;
    })
    .join('\n');
}

export function fallbackAnswer(query: string, evidence: EvidenceItem[], reason: string) {
  return [
    `Source records are ready for "${query}", but the model could not draft the synthesis: ${reason}`,
    '',
    'Evidence snapshot:',
    summarizeEvidence(evidence),
    '',
    'Use this as source triage, not medical advice. Pick an available Ollama model or add a provider key in Settings.',
  ].join('\n');
}

export function isResearchQuery(value: string) {
  const compact = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (compact.length < 3) return false;
  return !new Set(['hi', 'hello', 'hey', 'yo', 'test', 'thanks', 'thank you']).has(compact);
}

export function sourceArgs(source: SourceStatus, query: string) {
  if (source.id === 'openfda') return { endpoint: 'drug/event', query, maxResults: 5 };
  if (source.id === 'rxnorm') return { drug: query };
  return { query, maxResults: 5 };
}

export function dedupeEvidence(items: EvidenceItem[]) {
  const seen = new Set<string>();
  return items.filter((item, index) => {
    const key = item.url || item.identifiers.pmid || item.identifiers.doi || item.provenanceHash || `${item.source}-${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function labelForModel(modelValue: string): string {
  for (const group of MODEL_GROUPS) {
    const option = group.models.find((model) => model.value === modelValue);
    if (option) return option.label;
  }
  return modelValue;
}

export function shortLabelForModel(modelValue: string): string {
  for (const group of MODEL_GROUPS) {
    const option = group.models.find((model) => model.value === modelValue);
    if (option) return option.shortLabel;
  }
  return modelValue;
}
