import type { PaperTypeDef, PaperTypeId } from './types';

export const PAPER_TYPES: PaperTypeDef[] = [
  {
    id: 'systematic_review',
    label: 'Systematic review + meta-analysis',
    description:
      'A structured synthesis of all available evidence on a focused question, with pooled effect estimates where appropriate.',
    requiresDataStep: true,
    sectionBlueprint: [
      'Abstract',
      'Introduction',
      'Methods',
      'Results',
      'Discussion',
      'Limitations',
      'Conclusion',
      'References',
    ],
  },
  {
    id: 'narrative_review',
    label: 'Narrative / literature review',
    description:
      'A broad, contextual overview of the literature without formal pooling. Suitable for emerging or heterogeneous topics.',
    requiresDataStep: false,
    sectionBlueprint: [
      'Abstract',
      'Introduction',
      'Methods',
      'Results',
      'Discussion',
      'Conclusion',
      'References',
    ],
  },
  {
    id: 'original_research',
    label: 'Original research (IMRaD)',
    description:
      'A primary-study report following Introduction, Methods, Results, and Discussion. Use when you have your own dataset.',
    requiresDataStep: true,
    sectionBlueprint: [
      'Abstract',
      'Introduction',
      'Methods',
      'Results',
      'Discussion',
      'Conclusion',
      'References',
    ],
  },
  {
    id: 'scoping_review',
    label: 'Scoping review',
    description:
      'A mapping of concepts, evidence types, and gaps across a broad field. No pooled statistics.',
    requiresDataStep: false,
    sectionBlueprint: [
      'Abstract',
      'Introduction',
      'Methods',
      'Results',
      'Discussion',
      'Conclusion',
      'References',
    ],
  },
  {
    id: 'case_report',
    label: 'Case report',
    description: 'A detailed report of a single case or small series, including presentation, management, and outcomes.',
    requiresDataStep: false,
    sectionBlueprint: [
      'Abstract',
      'Introduction',
      'Case Presentation',
      'Discussion',
      'Conclusion',
      'References',
    ],
  },
];

export function paperTypeById(id: PaperTypeId): PaperTypeDef | undefined {
  return PAPER_TYPES.find((t) => t.id === id);
}
