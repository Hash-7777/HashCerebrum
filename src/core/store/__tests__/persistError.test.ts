import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { setPlatform } from '@platform/index';
import { browserPlatform } from '@platform/browser';
import { useProjectStore } from '../projectStore';

setPlatform(browserPlatform);

describe('store persistence error handling', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('logs persist failures instead of swallowing them', async () => {
    const originalSet = browserPlatform.storage.set;
    browserPlatform.storage.set = vi.fn().mockRejectedValue(new Error('disk full'));

    useProjectStore.setState({ projects: [], activeProjectId: null, hydrated: true });
    useProjectStore.getState().newProject('Test');

    // Wait for the async persist microtask
    await new Promise((r) => setTimeout(r, 10));

    expect(consoleSpy).toHaveBeenCalledWith(
      '[projectStore] persist failed:',
      expect.any(Error),
    );

    browserPlatform.storage.set = originalSet;
  });
});
