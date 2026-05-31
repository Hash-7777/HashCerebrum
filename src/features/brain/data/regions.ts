import type { RegionId } from '@config/agents';

export interface RegionMeta {
  id: RegionId;
  label: string;
  meshName: string;
  emissive: string;
  description: string;
  anchor: [number, number, number];
}

// Each region glows in its own vivid hue, picked as a distinct
// categorical palette so several lit regions read as separate colours
// rather than merging into one wash.
export const REGIONS: RegionMeta[] = [
  {
    id: 'frontal',
    label: 'Frontal lobe',
    meshName: 'Frontal_Lobe',
    emissive: '#4f8cff', // sky blue
    description: 'Executive function, planning',
    anchor: [0.18, 0.7, 0.92],
  },
  {
    id: 'parietal',
    label: 'Parietal lobe',
    meshName: 'Parietal_Lobe',
    emissive: '#3ddc84', // green
    description: 'Sensory integration, attention',
    anchor: [0.08, 1.02, 0.04],
  },
  {
    id: 'temporal',
    label: 'Temporal lobe',
    meshName: 'Temporal_Lobe',
    emissive: '#ff9636', // orange
    description: 'Auditory & language processing',
    anchor: [0.84, 0.0, 0.26],
  },
  {
    id: 'occipital',
    label: 'Occipital lobe',
    meshName: 'Occipital_Lobe',
    emissive: '#c77dff', // orchid
    description: 'Visual processing',
    anchor: [0.12, 0.52, -0.92],
  },
  {
    id: 'cerebellum',
    label: 'Cerebellum',
    meshName: 'Cerebellum',
    emissive: '#ff5fa8', // pink
    description: 'Motor coordination',
    anchor: [0.28, -0.5, -0.68],
  },
  {
    id: 'brainstem',
    label: 'Brainstem',
    meshName: 'Brainstem',
    emissive: '#ffc63d', // amber
    description: 'Autonomic & cardiorespiratory control',
    anchor: [0, -0.92, -0.18],
  },
  {
    id: 'hippocampus',
    label: 'Hippocampus',
    meshName: 'Hippocampus',
    emissive: '#22d3ee', // cyan
    description: 'Memory & recall',
    anchor: [-0.5, -0.2, 0.16],
  },
  {
    id: 'amygdala',
    label: 'Amygdala',
    meshName: 'Amygdala',
    emissive: '#ff5a5a', // red
    description: 'Threat & salience processing',
    anchor: [-0.62, -0.22, 0.45],
  },
  {
    id: 'thalamus',
    label: 'Thalamus',
    meshName: 'Thalamus',
    emissive: '#b9f24a', // lime
    description: 'Central sensory relay',
    anchor: [0, 0.05, 0.1],
  },
  {
    id: 'basal_ganglia',
    label: 'Basal ganglia',
    meshName: 'Basal_Ganglia',
    emissive: '#6d5cff', // indigo
    description: 'Movement & reward signalling',
    anchor: [0.48, -0.03, 0.22],
  },
];

export const regionById = (id: RegionId): RegionMeta =>
  REGIONS.find((region) => region.id === id) ?? REGIONS[0]!;
