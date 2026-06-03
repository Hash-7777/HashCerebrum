// Export preferences, persisted locally.
//   - citationStyle: which scholarly style the reference list is rendered in
//     (Vancouver | APA | Harvard). Vancouver is the default and matches the
//     long-standing output exactly; switching styles only changes the reference
//     line text, never the in-body numbering or which records are cited.

import { create } from 'zustand';
import type { CitationStyle } from '@features/brain/export/citationStyles';

const STYLE_KEY = 'hc.export.citationStyle.v1';

function loadStyle(): CitationStyle {
  try {
    const v = window.localStorage.getItem(STYLE_KEY);
    return v === 'apa' || v === 'harvard' || v === 'vancouver' ? v : 'vancouver';
  } catch {
    return 'vancouver';
  }
}

function saveStyle(value: CitationStyle): void {
  try {
    window.localStorage.setItem(STYLE_KEY, value);
  } catch {
    /* storage may be unavailable; the in-memory value still works */
  }
}

interface ExportSettingsStore {
  citationStyle: CitationStyle;
  setCitationStyle: (value: CitationStyle) => void;
}

export const useExportSettingsStore = create<ExportSettingsStore>((set) => ({
  citationStyle: loadStyle(),
  setCitationStyle: (value) => {
    saveStyle(value);
    set({ citationStyle: value });
  },
}));

/** Non-reactive read for export helpers that run outside React. */
export function currentCitationStyle(): CitationStyle {
  return useExportSettingsStore.getState().citationStyle;
}
