import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ModeId } from '@config/modes';

type ModeComponent = LazyExoticComponent<ComponentType>;

const MODE_COMPONENTS: Record<ModeId, ModeComponent> = {
  brain: lazy(() => import('@features/brain')),
  memory: lazy(() => import('@features/memory')),
  peer_review: lazy(() => import('@features/peer_review')),
  drug_interactions: lazy(() => import('@features/brain/DrugInteractionsMode')),
  genetics: lazy(() => import('@features/brain/GeneticsMode')),
};

export function getModeComponent(mode: ModeId): ModeComponent {
  return MODE_COMPONENTS[mode];
}
