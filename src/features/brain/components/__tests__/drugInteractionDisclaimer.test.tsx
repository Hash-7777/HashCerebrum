/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  DrugInteractionDisclaimer,
  hasAckedDiDisclaimer,
  resetDiDisclaimerAck,
} from '../DrugInteractionDisclaimer';

// The gate spent a period rendering nowhere at all: it was written to guard entry
// to a dedicated Drug-Interactions mode, and when that mode was merged into the
// Brain workspace it lost its screen without anyone noticing. Nothing failed,
// because nothing was watching it.

let container: HTMLDivElement;
let root: Root;

function mount(ui: React.ReactElement) {
  act(() => {
    root.render(ui);
  });
}

function clickButton(label: string) {
  const button = [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no button labelled "${label}"`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  resetDiDisclaimerAck();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('drug-interaction safety gate', () => {
  it('starts unacknowledged in a fresh session', () => {
    expect(hasAckedDiDisclaimer()).toBe(false);
  });

  it('does not count as acknowledged merely by being shown', () => {
    mount(<DrugInteractionDisclaimer mode="gate" onClose={() => {}} onCancel={() => {}} />);
    expect(document.body.textContent).toContain('Before you use the interaction checker');
    expect(hasAckedDiDisclaimer()).toBe(false);
  });

  it('records the acknowledgement only when the user accepts', () => {
    const onClose = vi.fn();
    mount(<DrugInteractionDisclaimer mode="gate" onClose={onClose} onCancel={() => {}} />);
    clickButton('I understand and agree');
    expect(hasAckedDiDisclaimer()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets the user decline without acknowledging anything', () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    mount(<DrugInteractionDisclaimer mode="gate" onClose={onClose} onCancel={onCancel} />);
    clickButton('Not now');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    // Declining must never satisfy the gate — the next drug question asks again.
    expect(hasAckedDiDisclaimer()).toBe(false);
  });

  it('treats Escape as declining, never as agreeing', () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    mount(<DrugInteractionDisclaimer mode="gate" onClose={onClose} onCancel={onCancel} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onCancel).toHaveBeenCalled();
    expect(hasAckedDiDisclaimer()).toBe(false);
  });

  it('states the four things a reader has to be told', () => {
    mount(<DrugInteractionDisclaimer mode="gate" onClose={() => {}} onCancel={() => {}} />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('not a medical device');
    expect(text).toContain('It can be wrong or incomplete');
    expect(text).toContain('Always confirm with a professional');
    expect(text).toContain('No warranty, no liability');
    // The specific trap a grade can lull someone into.
    expect(text).toContain('does not prove an interaction is absent');
    expect(text).toContain('licensed pharmacist or physician');
  });

  it('is a plain dismissible notice when re-opened for reference', () => {
    const onClose = vi.fn();
    mount(<DrugInteractionDisclaimer mode="review" onClose={onClose} />);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('I understand and agree');
    clickButton('Close');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
