/** @vitest-environment jsdom */
// The Licenses tab, rendered for real against a fake platform.
//
// This panel is the only place in the app where a user can read the notices
// the licences require us to pass on, so the test covers what would make that
// fail quietly: a notice that never appears, a search that hides the wrong
// rows, text rendered as markup instead of text, and a build with no documents
// in it saying nothing at all.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { setPlatform, type LicenseDocumentId, type Platform } from '@platform/index';
import { browserPlatform } from '@platform/browser';
import { LicensesPanel } from '../LicensesPanel';

const NOTICES = [
  '# Third-Party Notices',
  '',
  'What this file is.',
  '',
  '## Notices',
  '',
  '### Notice 1 — LICENSE-MIT',
  '',
  'Applies to:',
  '',
  '- npm three 0.184.0',
  '',
  '```text',
  'Copyright (c) 2026 three.js authors',
  '',
  '<script>alert(1)</script> & "quoted"',
  '```',
  '',
  '### Notice 2 — LICENSE',
  '',
  'Applies to:',
  '',
  '- crate serde 1.0.228',
  '',
  '```text',
  'Copyright (c) serde developers',
  '```',
].join('\n');

let container: HTMLDivElement;
let root: Root;
let reads: LicenseDocumentId[];

function install(read: (document: LicenseDocumentId) => Promise<string>) {
  reads = [];
  setPlatform({
    ...browserPlatform,
    licenses: {
      read: (document) => {
        reads.push(document);
        return read(document);
      },
    },
  } as Platform);
}

async function mount() {
  act(() => {
    root.render(<LicensesPanel />);
  });
  // Let the document read resolve and the list render.
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// React tracks an input's value on the node, so assigning to `.value` and
// firing an event looks like no change at all. Going through the native setter
// is what makes React see the new text.
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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
  install(async () => NOTICES);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('LicensesPanel', () => {
  it('lists every notice with the packages it covers, and reads the file once', async () => {
    await mount();
    expect(reads).toEqual(['notices']);
    const rows = [...container.querySelectorAll('.licenses-notice-head')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('npm three 0.184.0');
    expect(rows[1]?.textContent).toContain('crate serde 1.0.228');
    expect(container.querySelector('.licenses-count')?.textContent).toContain('2');
  });

  it('does not print a vendored asset\'s file name twice on its row', async () => {
    install(async () =>
      [
        '### Notice 1 — public/fonts/LICENSE.txt',
        '',
        'Applies to:',
        '',
        '- asset public/fonts/LICENSE.txt',
        '',
        '```text',
        'Font licence text',
        '```',
      ].join('\n'),
    );
    await mount();
    const row = container.querySelector('.licenses-notice-head')!;
    expect(row.textContent).toContain('asset public/fonts/LICENSE.txt');
    expect(row.querySelector('.licenses-notice-files')?.textContent).toBe('');
  });

  it('shows a notice only when its row is opened, and closes it again', async () => {
    await mount();
    expect(container.querySelector('.licenses-text')).toBeNull();

    act(() => button('npm three').click());
    const text = container.querySelector('.licenses-text');
    expect(text?.textContent).toContain('Copyright (c) 2026 three.js authors');

    act(() => button('npm three').click());
    expect(container.querySelector('.licenses-text')).toBeNull();
  });

  it('renders notice text as text — markup in a licence is never run', async () => {
    await mount();
    act(() => button('npm three').click());
    const text = container.querySelector('.licenses-text')!;
    expect(text.querySelector('script')).toBeNull();
    expect(text.textContent).toContain('<script>alert(1)</script> & "quoted"');
  });

  it('filters the list by what the reader types', async () => {
    await mount();
    const search = container.querySelector<HTMLInputElement>('.licenses-search input')!;
    act(() => type(search, 'serde'));
    const rows = [...container.querySelectorAll('.licenses-notice-head')];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('crate serde');

    act(() => type(search, 'nothing matches this'));
    expect(container.querySelectorAll('.licenses-notice-head')).toHaveLength(0);
    expect(container.querySelector('.licenses-empty')?.textContent).toContain('No notice matches');
  });

  it('reads the other two documents only when they are asked for', async () => {
    install(async (document) => (document === 'notices' ? NOTICES : 'GNU AFFERO GENERAL PUBLIC LICENSE'));
    await mount();
    expect(reads).toEqual(['notices']);

    act(() => button("This app's licence").click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(reads).toEqual(['notices', 'project']);
    expect(container.querySelector('.licenses-text')?.textContent).toContain('AFFERO');
  });

  it('says so plainly when a build carries no documents', async () => {
    install(async () => {
      throw new Error('The licence documents ship with the desktop app');
    });
    await mount();
    expect(container.querySelector('.licenses-empty')?.textContent).toContain(
      'ship with the desktop app',
    );
    expect(container.querySelector('.licenses-list')).toBeNull();
  });
});
