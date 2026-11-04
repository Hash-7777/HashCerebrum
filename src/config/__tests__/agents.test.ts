import { describe, expect, it } from 'vitest';
import { AGENTS, BRAIN_AGENTS, agentForRegion, agentById } from '../agents';
import { MAX_AGENTS } from '../constants';
import { SOURCE_DOMAIN } from '../sourceRegions';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The brain lights the region bound to whichever agent is working, and the agent
// panel lists BRAIN_AGENTS. These hold the two together, so nothing can light the
// brain without a row on the panel to say who it is.
describe('agent roster', () => {
  it('stays within the agent cap', () => {
    expect(AGENTS.length).toBeLessThanOrEqual(MAX_AGENTS);
  });

  it('lists every agent that can run on the panel', () => {
    expect(BRAIN_AGENTS.map((a) => a.id).sort()).toEqual(AGENTS.map((a) => a.id).sort());
  });

  it('binds each region to at most one agent and each agent to its own region', () => {
    const regions = AGENTS.map((a) => a.regionBinding);
    expect(new Set(regions).size).toBe(regions.length);
    for (const agent of AGENTS) expect(agentForRegion(agent.regionBinding)?.id).toBe(agent.id);
  });

  it('gives every agent a distinct label', () => {
    const labels = AGENTS.map((a) => a.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('has one drug expert that can reach the drug label and terminology sources', () => {
    const pharmacist = agentById('pharmacist');
    expect(pharmacist.tools).toContain('openfda_query');
    expect(pharmacist.tools).toContain('rxnorm_lookup');
    expect(SOURCE_DOMAIN.openfda?.agentId).toBe('pharmacist');
  });

  it('runs the drug-interaction path on an agent from the roster', () => {
    const source = readFileSync(join(__dirname, '../../features/brain/swarm/runSwarm.ts'), 'utf8');
    const ids = [...source.matchAll(/agentById\('([a-z_]+)'\)/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(AGENTS.some((a) => a.id === id)).toBe(true);
  });
});
