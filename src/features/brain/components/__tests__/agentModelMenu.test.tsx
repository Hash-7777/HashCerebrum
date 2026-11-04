/** @vitest-environment jsdom */
// The title-bar model menu, rendered for real: it must name the lead agent's
// model, list every agent with its own picker, and write the same overrides the
// Settings panel writes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { setPlatform } from '@platform/index';
import { browserPlatform } from '@platform/browser';
import { AGENTS } from '@config/agents';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';
import { useAgentModelStore } from '@core/store/agentModelStore';
import { AgentModelMenu } from '../AgentModelMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setPlatform(browserPlatform);
  useAgentModelStore.setState((s) => ({ ...s, overrides: {} }));
  useModelCatalogStore.setState((s) => ({
    ...s,
    groups: [
      {
        provider: 'openai',
        label: 'OpenAI',
        keyName: 'llm.openai',
        models: [
          { value: 'cloud:openai:big-model', label: 'Big Model', shortLabel: 'Big' },
          { value: 'cloud:openai:small-model', label: 'Small Model', shortLabel: 'Small' },
        ],
      },
    ],
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('AgentModelMenu', () => {
  it("names the lead agent's model on the button and opens a picker for every agent", () => {
    act(() => root.render(<AgentModelMenu />));
    const button = host.querySelector<HTMLButtonElement>('.model-menu-btn')!;
    expect(button.textContent).toMatch(/Big|Small/);
    expect(host.querySelector('.model-menu-panel')).toBeNull();
    act(() => button.click());
    expect(host.querySelectorAll('.model-menu-panel select')).toHaveLength(AGENTS.length);
    expect(host.textContent).toContain('Lead agent');
    expect(host.textContent).toContain('Pharmacist');
  });

  it('pins a model for an agent through the same store Settings uses', () => {
    act(() => root.render(<AgentModelMenu />));
    act(() => host.querySelector<HTMLButtonElement>('.model-menu-btn')!.click());
    const first = host.querySelector<HTMLSelectElement>('.model-menu-panel select')!;
    act(() => {
      first.value = 'cloud:openai:small-model';
      first.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useAgentModelStore.getState().overrides.boss).toBe('cloud:openai:small-model');
    expect(host.querySelector('.model-menu-btn')!.textContent).toContain('Small');
  });

  it('closes on Escape', () => {
    act(() => root.render(<AgentModelMenu />));
    act(() => host.querySelector<HTMLButtonElement>('.model-menu-btn')!.click());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(host.querySelector('.model-menu-panel')).toBeNull();
  });

  it('says what to do when no model is connected', () => {
    useModelCatalogStore.setState((s) => ({ ...s, groups: [] }));
    act(() => root.render(<AgentModelMenu />));
    act(() => host.querySelector<HTMLButtonElement>('.model-menu-btn')!.click());
    expect(host.textContent).toContain('Add a provider key in Settings');
  });
});
