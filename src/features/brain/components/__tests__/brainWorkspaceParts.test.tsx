/** @vitest-environment jsdom */
// The Brain workspace's header and side panel are separate components fed by
// BrainMode. These render them for real: the header's counters and actions,
// and the Lite-mode side panel, which must show the 2D workflow and the agent
// panel without ever loading the 3D canvas.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatHeader } from '../ChatHeader';
import { BrainSidePanel } from '../BrainSidePanel';
import { initialAgentStatuses } from '../AgentPanel';
import { BrainMode } from '../../BrainMode';
import { useBrainModesStore } from '@core/store/brainModesStore';

let container: HTMLDivElement;
let root: Root;

function mount(ui: React.ReactElement) {
  act(() => {
    root.render(ui);
  });
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`no button containing "${label}"`);
  return found;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const noop = () => {};

describe('ChatHeader', () => {
  it('shows padded turn and evidence counts, the run stage, and the actions once there are turns', () => {
    const onClear = vi.fn();
    mount(
      <ChatHeader
        isRunning
        turnCount={3}
        evidenceCount={12}
        draftProgress="Paper pipeline - Drafting"
        onExportMarkdown={noop}
        onExportPdf={noop}
        onClear={onClear}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('03 turns');
    expect(text).toContain('12 evidence');
    expect(text).toContain('Paper pipeline - Drafting');
    act(() => {
      button('Clear').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('hides the evidence count and the actions for an empty conversation', () => {
    mount(
      <ChatHeader
        isRunning={false}
        turnCount={0}
        evidenceCount={0}
        draftProgress={null}
        onExportMarkdown={noop}
        onExportPdf={noop}
        onClear={noop}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('evidence');
    expect(container.querySelector('.chat-export-actions')).toBeNull();
  });
});

describe('BrainSidePanel', () => {
  it('renders the 2D workflow and the agent panel in Lite mode, without the 3D canvas', () => {
    mount(
      <BrainSidePanel
        lite
        agentStatuses={initialAgentStatuses()}
        activeIntent="evidence_review"
        selectedRegion={null}
        hoveredRegion={null}
        toggleRegion={noop}
        setHoveredRegion={noop}
      />,
    );
    expect(container.querySelector('.brain-side--solo')).not.toBeNull();
    expect(container.querySelector('.brain-model-panel--flat')).not.toBeNull();
    expect(container.textContent).not.toContain('Preparing the 3D brain');
  });
});

describe('BrainMode', () => {
  it('composes the workspace from its parts in Lite mode: header, composer and side panel', () => {
    useBrainModesStore.setState({ lite: 'on' });
    mount(<BrainMode />);
    const text = container.textContent ?? '';
    expect(text).toContain('00 turns');
    expect(text).toContain('Agent Swarm');
    expect(button('Send')).toBeTruthy();
    expect(container.querySelector('.research-chat')).not.toBeNull();
    expect(container.querySelector('.brain-side--solo')).not.toBeNull();
    expect(text).not.toContain('Preparing the 3D brain');
  });
});
