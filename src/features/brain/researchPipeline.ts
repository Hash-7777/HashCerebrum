import { labelForModelValue, shortLabelForModelValue } from '@core/store/modelCatalogStore';
import { classify } from '@core/topic/MeshClassifier';
import type { EvidenceItem } from '@platform/index';

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
  if (new Set(['hi', 'hello', 'hey', 'yo', 'test', 'thanks', 'thank you']).has(compact)) return false;
  if (classify(value).length > 0) return true;
  return /\b(pubmed|europe pmc|openalex|clinical trial|trial|openfda|rxnorm|mesh|citation|systematic review|meta analysis|biomarker|diagnos[ei]s|treatment|therapy|drug|dose|adverse|safety|disease|syndrome|cancer|tumou?r|infection|vaccine|clinical|patient|cohort|case control|randomi[sz]ed|placebo|fda|medicine|medical|biomedical|neuro|brain)\b/i.test(
    compact,
  );
}

export function labelForModel(modelValue: string): string {
  return labelForModelValue(modelValue);
}

export function shortLabelForModel(modelValue: string): string {
  return shortLabelForModelValue(modelValue);
}
