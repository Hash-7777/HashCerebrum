/** @vitest-environment jsdom */
// Lite mode keeps WebGL off, and every mode is mounted (hidden) at start-up, so
// Memory must open as a list there — opening on the 3D map would load three.js
// the moment any memory was saved. The map stays one click away, and turning
// Lite on while Memory is open switches it back to the list.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useBrainModesStore } from '@core/store/brainModesStore';
import { useProjectStore } from '@core/store/projectStore';
import { useRagStore, type RagChunk } from '@core/rag';

// A stand-in for the 3D map, so a test can see whether it mounted without
// pulling three.js into jsdom.
vi.mock('../graph/MemoryVectorGraph3D', () => ({
  MemoryVectorGraph3D: () => <div data-testid="memory-map" />,
}));

const lowEnd = vi.hoisted(() => ({ value: false }));
vi.mock('@ui/hooks/useLowEndDevice', () => ({ useLowEndDevice: () => lowEnd.value }));

const { MemoryMode } = await import('../MemoryMode');

let container: HTMLDivElement;
let root: Root;

const chunk: RagChunk = {
  id: 'c1',
  projectId: 'p1',
  kind: 'evidence',
  title: 'Aspirin and stroke',
  text: 'Low-dose aspirin lowered recurrent stroke risk.',
  source: 'pubmed',
  createdAt: '2026-09-01T00:00:00.000Z',
};

function pressed(label: string): string | null {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found.getAttribute('aria-pressed');
}

// Lets the lazy map import resolve and Suspense swap its fallback out.
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mountMemory() {
  act(() => {
    root.render(<MemoryMode />);
  });
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  lowEnd.value = false;
  useProjectStore.setState({ activeProjectId: 'p1' });
  useRagStore.setState({ chunks: [chunk] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Memory mode in Lite', () => {
  it('opens as a list and never mounts the 3D map', async () => {
    useBrainModesStore.setState({ lite: 'on' });
    await mountMemory();
    expect(pressed('List')).toBe('true');
    expect(pressed('Map')).toBe('false');
    expect(container.querySelector('.memory-list')).not.toBeNull();
    expect(container.querySelector('[data-testid="memory-map"]')).toBeNull();
    expect(container.textContent).not.toContain('Loading the memory map');
  });

  it('opens on the map when Lite is off', async () => {
    useBrainModesStore.setState({ lite: 'off' });
    await mountMemory();
    expect(pressed('Map')).toBe('true');
    expect(container.querySelector('[data-testid="memory-map"]')).not.toBeNull();
  });

  it('follows the device check when Lite is on auto', async () => {
    lowEnd.value = true;
    useBrainModesStore.setState({ lite: 'auto' });
    await mountMemory();
    expect(pressed('List')).toBe('true');
    expect(container.querySelector('[data-testid="memory-map"]')).toBeNull();
  });

  it('switches to the list when Lite is turned on while Memory is open', async () => {
    useBrainModesStore.setState({ lite: 'off' });
    await mountMemory();
    expect(container.querySelector('[data-testid="memory-map"]')).not.toBeNull();
    act(() => {
      useBrainModesStore.setState({ lite: 'on' });
    });
    await settle();
    expect(pressed('List')).toBe('true');
    expect(container.querySelector('[data-testid="memory-map"]')).toBeNull();
  });

  it('keeps the map one click away in Lite', async () => {
    useBrainModesStore.setState({ lite: 'on' });
    await mountMemory();
    const map = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Map');
    act(() => map?.click());
    await settle();
    expect(pressed('Map')).toBe('true');
    expect(container.querySelector('[data-testid="memory-map"]')).not.toBeNull();
  });
});
