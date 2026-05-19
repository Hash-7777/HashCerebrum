import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ModeId } from '@config/modes';

type ModeComponent = LazyExoticComponent<ComponentType>;

const MODE_COMPONENTS: Record<ModeId, ModeComponent> = {
  brain: lazy(() => import('@features/brain')),
  resources: lazy(() => import('@features/resources')),
};

export function getModeComponent(mode: ModeId): ModeComponent {
  return MODE_COMPONENTS[mode];
}
