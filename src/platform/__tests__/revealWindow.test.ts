// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Window } from '@tauri-apps/api/window';
import { startPersistence } from '../revealWindow';

function fakeWindow(listen: 'ok' | 'refused') {
  const handlers: Array<() => void> = [];
  const win = {
    outerPosition: vi.fn(async () => ({ x: 120, y: 80 })),
    innerSize: vi.fn(async () => ({ width: 1400, height: 900 })),
    onMoved: vi.fn(async (fn: () => void) => {
      if (listen === 'refused') throw new Error('not allowed');
      handlers.push(fn);
      return () => {};
    }),
    onResized: vi.fn(async (fn: () => void) => {
      if (listen === 'refused') throw new Error('not allowed');
      handlers.push(fn);
      return () => {};
    }),
  };
  return { win: win as unknown as Window, raw: win, fire: () => handlers.forEach((h) => h()) };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('window geometry persistence', () => {
  it('reads nothing while the window sits still', async () => {
    const { win, raw } = fakeWindow('ok');
    startPersistence(win);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(raw.outerPosition).not.toHaveBeenCalled();
    expect(raw.innerSize).not.toHaveBeenCalled();
  });

  it('saves once after a move settles', async () => {
    const { win, raw, fire } = fakeWindow('ok');
    startPersistence(win);
    await vi.advanceTimersByTimeAsync(0);
    fire();
    fire();
    fire();
    await vi.advanceTimersByTimeAsync(500);
    expect(raw.outerPosition).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('hc_win_pos')!)).toEqual({ x: 120, y: 80 });
    expect(JSON.parse(localStorage.getItem('hc_win_size')!)).toEqual({ width: 1400, height: 900 });
  });

  it('falls back to polling when the shell refuses the window events', async () => {
    const { win, raw } = fakeWindow('refused');
    startPersistence(win);
    await vi.advanceTimersByTimeAsync(4_100);
    expect(raw.outerPosition).toHaveBeenCalled();
  });
});
