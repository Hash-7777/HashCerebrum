import { AGENTS, type AgentId } from '@config/agents';
import { AgentBase } from './AgentBase';
import { Librarian } from '@agents/librarian';
import { Trialist } from '@agents/trialist';
import { Pharmacologist } from '@agents/pharmacologist';
import { Synthesizer } from '@agents/synthesizer';
import { Citation } from '@agents/citation';
import { Critic } from '@agents/critic';

const CONSTRUCTORS: Record<AgentId, new () => AgentBase> = {
  librarian: Librarian,
  trialist: Trialist,
  pharmacologist: Pharmacologist,
  synthesizer: Synthesizer,
  citation: Citation,
  critic: Critic,
};

const instances = new Map<AgentId, AgentBase>();

export function getAgent(id: AgentId): AgentBase {
  let a = instances.get(id);
  if (!a) {
    a = new CONSTRUCTORS[id]();
    instances.set(id, a);
  }
  return a;
}

export function listAgents() {
  return AGENTS;
}
