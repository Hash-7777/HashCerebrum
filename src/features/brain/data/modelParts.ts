import type { RegionId } from '@config/agents';
import { regionById } from './regions';

export const BRAIN_MODEL = {
  path: '/models/brain/science-museum-human-brain.glb',
  title: 'Model of a human brain',
  source: 'Science Museum Group / Sketchfab',
  license: 'CC0-1.0',
  sourceUrl: 'https://sketchfab.com/3d-models/model-of-a-human-brain-fc7ae7b989f94c80a50152e71f44e47c',
} as const;

export interface BrainModelPart {
  id: string;
  nodeName: string;
  label: string;
  regionIds: RegionId[];
  note: string;
}

export const BRAIN_MODEL_PARTS: BrainModelPart[] = [
  {
    id: 'posterior-left',
    nodeName: 'Object_2',
    label: 'Posterior left cortex',
    regionIds: ['occipital'],
    note: 'Visible posterior cortical chunk mapped to visual processing.',
  },
  {
    id: 'superior-left',
    nodeName: 'Object_3',
    label: 'Superior left cortex',
    regionIds: ['parietal', 'thalamus'],
    note: 'Broad superior region; thalamus is assigned here because the source GLB has no named internal thalamic mesh.',
  },
  {
    id: 'anterior-left',
    nodeName: 'Object_4',
    label: 'Anterior left cortex',
    regionIds: ['frontal'],
    note: 'Anterior cortical surface mapped to planning and executive function.',
  },
  {
    id: 'lateral-left',
    nodeName: 'Object_5',
    label: 'Lateral temporal cortex',
    regionIds: ['temporal', 'hippocampus'],
    note: 'Temporal-facing visible chunk; hippocampus is approximated to this region for v1.',
  },
  {
    id: 'inferior-left',
    nodeName: 'Object_6',
    label: 'Inferior temporal base',
    regionIds: ['amygdala', 'basal_ganglia'],
    note: 'Inferior visible chunk used for hidden limbic/deep structures that are not separately named in the GLB.',
  },
  {
    id: 'posterior-right',
    nodeName: 'Object_7',
    label: 'Posterior right cortex',
    regionIds: ['cerebellum'],
    note: 'Posterior/inferior chunk used for cerebellar activity in the first working mode.',
  },
  {
    id: 'anterior-right',
    nodeName: 'Object_8',
    label: 'Anterior right cortex',
    regionIds: ['frontal', 'parietal'],
    note: 'Right-side visible cortical chunk shared by planning and integration signals.',
  },
  {
    id: 'central-base',
    nodeName: 'Object_9',
    label: 'Central base',
    regionIds: ['brainstem'],
    note: 'Base chunk mapped to autonomic/cardiorespiratory signalling.',
  },
];

export const PARTS_BY_NODE = new Map(BRAIN_MODEL_PARTS.map((part) => [part.nodeName, part]));

export const partForRegion = (regionId: RegionId): BrainModelPart | undefined =>
  BRAIN_MODEL_PARTS.find((part) => part.regionIds.includes(regionId));

export const primaryRegionForPart = (part: BrainModelPart): RegionId => part.regionIds[0]!;

export const partColor = (part: BrainModelPart): string =>
  regionById(primaryRegionForPart(part)).emissive;

export const labelForRegionPart = (regionId: RegionId): string => {
  const part = partForRegion(regionId);
  return part ? part.label : regionById(regionId).label;
};
