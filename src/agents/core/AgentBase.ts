// Base agent — every concrete agent extends this. Defines the standard
// lifecycle:
//   1. emit agent:activity start (lights region via brainStore)
//   2. run tool-loop (delegates to ToolLoop)
//   3. emit agent:activity done (or error)

import { bus } from '@core/bus/EventBus';
import type { AgentContext, AgentTurn, AgentOutput } from './types';
import { runToolLoop } from './ToolLoop';

export abstract class AgentBase {
  constructor(protected readonly ctx: AgentContext) {}

  async run(turn: AgentTurn): Promise<AgentOutput> {
    const started = performance.now();
    bus.emit('agent:activity', { agentId: this.ctx.agentId, phase: 'start' });
    bus.emit('region:light', {
      region: this.ctx.regionBinding,
      source: 'agent',
      agentId: this.ctx.agentId,
      intensity: 0.7,
      ttlMs: 30_000,
    });

    try {
      const result = await runToolLoop(this.ctx, turn);
      bus.emit('agent:activity', { agentId: this.ctx.agentId, phase: 'done' });
      return { ...result, durationMs: performance.now() - started };
    } catch (e) {
      bus.emit('agent:activity', {
        agentId: this.ctx.agentId,
        phase: 'error',
        detail: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }
}
