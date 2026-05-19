import type { RegionId } from '@config/agents';

export interface RegionMeta {
  id: RegionId;
  label: string;
  meshName: string;
  emissive: string;
  description: string;
  anchor: [number, number, number];
}

export const REGIONS: RegionMeta[] = [
  {
    id: 'frontal',
    label: 'Frontal lobe',
    meshName: 'Frontal_Lobe',
    emissive: '#5b8def',
    description: 'Executive function, planning',
    anchor: [0.18, 0.7, 0.92],
  },
  {
    id: 'parietal',
    label: 'Parietal lobe',
    meshName: 'Parietal_Lobe',
    emissive: '#7ed3b2',
    description: 'Integration, attention',
    anchor: [0.08, 1.02, 0.04],
  },
  {
    id: 'temporal',
    label: 'Temporal lobe',
    meshName: 'Temporal_Lobe',
    emissive: '#f0a868',
    description: 'Auditory, language, pathology context',
    anchor: [0.84, 0.0, 0.26],
  },
  {
    id: 'occipital',
    label: 'Occipital lobe',
    meshName: 'Occipital_Lobe',
    emissive: '#c7a3ff',
    description: 'Visual processing, imaging',
    anchor: [0.12, 0.52, -0.92],
  },
  {
    id: 'cerebellum',
    label: 'Cerebellum',
    meshName: 'Cerebellum',
    emissive: '#e87a90',
    description: 'Motor coordination',
    anchor: [0.28, -0.5, -0.68],
  },
  {
    id: 'brainstem',
    label: 'Brainstem',
    meshName: 'Brainstem',
    emissive: '#d4b85a',
    description: 'Cardiorespiratory, autonomic',
    anchor: [0, -0.92, -0.18],
  },
  {
    id: 'hippocampus',
    label: 'Hippocampus',
    meshName: 'Hippocampus',
    emissive: '#62c8d6',
    description: 'Memory, recall — Librarian binding',
    anchor: [-0.5, -0.2, 0.16],
  },
  {
    id: 'amygdala',
    label: 'Amygdala',
    meshName: 'Amygdala',
    emissive: '#ff6b6b',
    description: 'Skepticism, threat — Critic binding',
    anchor: [-0.62, -0.22, 0.45],
  },
  {
    id: 'thalamus',
    label: 'Thalamus',
    meshName: 'Thalamus',
    emissive: '#ffffff',
    description: 'Central relay — agent orchestration',
    anchor: [0, 0.05, 0.1],
  },
  {
    id: 'basal_ganglia',
    label: 'Basal ganglia',
    meshName: 'Basal_Ganglia',
    emissive: '#a78bfa',
    description: 'Neurochemistry — Pharmacologist binding',
    anchor: [0.48, -0.03, 0.22],
  },
];

export const regionById = (id: RegionId): RegionMeta =>
  REGIONS.find((region) => region.id === id) ?? REGIONS[0]!;
