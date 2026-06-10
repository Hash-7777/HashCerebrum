export type PaperTypeId =
  | 'systematic_review'
  | 'narrative_review'
  | 'original_research'
  | 'scoping_review'
  | 'case_report';

export interface EffectRow {
  label: string;
  measure: 'HR' | 'OR' | 'RR';
  point: number;
  ciLow: number;
  ciHigh: number;
  sampleSize?: number | undefined;
}

export interface PaperJobSpec {
  title: string;
  question: string;
  paperType: PaperTypeId;
  pico: {
    population: string;
    intervention: string;
    comparator: string;
    outcomes: string[];
  };
  effectData: EffectRow[];
  citationStyle: 'vancouver' | 'apa' | 'mla' | 'chicago';
  options: {
    mini: boolean;
    outlineFirst: boolean;
  };
}

export interface PaperTypeDef {
  id: PaperTypeId;
  label: string;
  description: string;
  requiresDataStep: boolean;
  sectionBlueprint: string[];
}
