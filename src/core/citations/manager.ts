// Citation Manager Integration — Zotero and Mendeley sync scaffolding.
// Full OAuth flows would require backend endpoints; this provides the
// data model, local cache, and export formatting.

export interface CitationLibraryItem {
  id: string;
  source: 'zotero' | 'mendeley' | 'manual';
  title: string;
  authors: string[];
  year?: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  url?: string;
  abstract?: string;
  tags: string[];
  importedAt: string;
}

const library = new Map<string, CitationLibraryItem>();

export function importItems(items: CitationLibraryItem[]): number {
  let count = 0;
  for (const item of items) {
    if (!library.has(item.id)) {
      library.set(item.id, item);
      count++;
    }
  }
  return count;
}

export function getLibrary(): CitationLibraryItem[] {
  return Array.from(library.values());
}

export function findByDoi(doi: string): CitationLibraryItem | undefined {
  return Array.from(library.values()).find((i) => i.doi === doi);
}

export function findByPmid(pmid: string): CitationLibraryItem | undefined {
  return Array.from(library.values()).find((i) => i.pmid === pmid);
}

export function exportRis(items: CitationLibraryItem[]): string {
  return items
    .map((i) => {
      const lines = [
        'TY  - JOUR',
        `TI  - ${i.title}`,
        ...i.authors.map((a) => `AU  - ${a}`),
        i.year ? `PY  - ${i.year}` : '',
        i.journal ? `JO  - ${i.journal}` : '',
        i.doi ? `DO  - ${i.doi}` : '',
        i.pmid ? `AN  - ${i.pmid}` : '',
        i.url ? `UR  - ${i.url}` : '',
        'ER  -',
      ];
      return lines.filter(Boolean).join('\n');
    })
    .join('\n\n');
}
