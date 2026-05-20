import { labelForModelValue } from '@core/store/modelCatalogStore';
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

export function labelForModel(modelValue: string): string {
  return labelForModelValue(modelValue);
}
