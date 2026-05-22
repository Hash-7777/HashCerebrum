// Active mode registry. Start with Brain only; add later modes here one
// at a time. TypeScript rejects more than MAX_MODES entries.

import { MAX_MODES } from './constants';

export interface ModeDef {
  id: string;
  label: string;
  shortcut: string; // keyboard hint
  description: string;
}

type AtMost<T extends readonly unknown[], N extends number, A extends readonly unknown[] = []> =
  A['length'] extends N
    ? T extends readonly [] ? T : never
    : T extends readonly [unknown, ...infer Rest]
      ? AtMost<Rest, N, [...A, unknown]>
      : T;

const defineModes = <const T extends readonly ModeDef[]>(
  modes: T &
    (T extends readonly [] ? never : unknown) &
    (AtMost<T, typeof MAX_MODES> extends never ? never : unknown),
) => modes;

export const MODES = defineModes([
  {
    id: 'brain',
    label: 'Brain',
    shortcut: '⌘1',
    description: '3D anatomical brain — regions light per active agent + topic',
  },
  {
    id: 'resources',
    label: 'Resources',
    shortcut: '⌘2',
    description: 'Saved papers, collections, tags, notes, export',
  },
  {
    id: 'memory',
    label: 'Memory',
    shortcut: '⌘3',
    description: "The active project's saved research memory — evidence and answers",
  },
  {
    id: 'review',
    label: 'Review',
    shortcut: '⌘4',
    description: 'Structured quality assessment — RoB 2, ROBINS-I, QUADAS-2',
  },
]);

export type ModeId = (typeof MODES)[number]['id'];

export const DEFAULT_MODE = 'brain' satisfies ModeId;
