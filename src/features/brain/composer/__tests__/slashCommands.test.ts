import { describe, expect, it } from 'vitest';
import { parseSlashCommands, matchingCommands, activeSlashPrefix } from '../slashCommands';

describe('parseSlashCommands', () => {
  it('forces an intent from a leading command and strips it', () => {
    const r = parseSlashCommands('/genetics MICA and type 1 diabetes');
    expect(r.forcedIntent).toBe('genetics');
    expect(r.text).toBe('MICA and type 1 diabetes');
    expect(r.applied).toEqual(['/genetics']);
  });

  it('resolves aliases to the canonical intent', () => {
    expect(parseSlashCommands('/drugs warfarin and aspirin').forcedIntent).toBe('drug_interactions');
    expect(parseSlashCommands('/pharmacist warfarin').applied).toEqual(['/interactions']);
  });

  it('combines an intent command with an effort modifier', () => {
    const r = parseSlashCommands('/paper /mini DOACs vs warfarin');
    expect(r.forcedIntent).toBe('paper');
    expect(r.forcedEffort).toBe('mini');
    expect(r.text).toBe('DOACs vs warfarin');
  });

  it('leaves an unknown leading command as literal text', () => {
    const r = parseSlashCommands('/unknownthing do something');
    expect(r.forcedIntent).toBeUndefined();
    expect(r.text).toBe('/unknownthing do something');
    expect(r.applied).toEqual([]);
  });

  it('does not treat a mid-message slash as a command', () => {
    const r = parseSlashCommands('compare aspirin/warfarin bleeding risk');
    expect(r.forcedIntent).toBeUndefined();
    expect(r.text).toBe('compare aspirin/warfarin bleeding risk');
  });

  it('first intent wins; a second intent command stops parsing', () => {
    const r = parseSlashCommands('/genetics /interactions MICA');
    expect(r.forcedIntent).toBe('genetics');
    expect(r.text).toBe('/interactions MICA');
  });
});

describe('matchingCommands / activeSlashPrefix', () => {
  it('lists all commands for a bare slash', () => {
    expect(matchingCommands('/').length).toBe(7);
  });

  it('filters by prefix including aliases', () => {
    const names = matchingCommands('/d').map((c) => c.command);
    expect(names).toContain('/interactions'); // matched via alias /drugs
    expect(names).toContain('/deep');
  });

  it('returns nothing when the prefix is not a slash token', () => {
    expect(matchingCommands('genetics')).toEqual([]);
  });

  it('detects an in-progress leading slash prefix only', () => {
    expect(activeSlashPrefix('/gen')).toBe('/gen');
    expect(activeSlashPrefix('/')).toBe('/');
    expect(activeSlashPrefix('/genetics MICA')).toBeNull();
    expect(activeSlashPrefix('hello')).toBeNull();
  });
});
