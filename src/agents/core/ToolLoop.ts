// Tool-calling loop. LLM produces tool_calls; we execute them; we feed
// results back; repeat until the model stops calling tools or max
// iterations is reached.
//
// Phase 3 implements this fully. Stub returns the input unchanged so
// callers can be wired today.

import type { AgentContext, AgentTurn } from './types';
import { bus } from '@core/bus/EventBus';
import { classify } from '@core/topic/MeshClassifier';
import { tools as toolRegistry } from '@core/tools/ToolRegistry';
import { getProvider } from '@core/llm/ProviderRegistry';

interface LoopResult {
  finalMessage: string;
  toolCallCount: number;
}

const MAX_ITER = 12;

export async function runToolLoop(ctx: AgentContext, turn: AgentTurn): Promise<LoopResult> {
  const provider = getProvider(ctx.llmProviderId);
  const tools = ctx.tools
    .map((n) => toolRegistry.get(n))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));

  const messages = [...turn.input];
  let toolCallCount = 0;

  for (let i = 0; i < (turn.maxIterations ?? MAX_ITER); i++) {
    const resp = await provider.complete({
      model: provider.defaultModel,
      messages,
      tools,
    });

    // Topic accents based on the latest model output
    for (const hit of classify(resp.content)) {
      bus.emit('topic:detected', hit);
      bus.emit('region:light', {
        region: hit.region,
        source: 'topic',
        intensity: hit.confidence * 0.5,
        ttlMs: 8000,
      });
    }

    if (resp.toolCalls.length === 0) {
      return { finalMessage: resp.content, toolCallCount };
    }

    messages.push({ role: 'assistant', content: resp.content });

    for (const call of resp.toolCalls) {
      bus.emit('agent:activity', {
        agentId: ctx.agentId,
        phase: 'tool_call',
        detail: call.name,
      });
      const tool = toolRegistry.get(call.name);
      if (!tool) {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: JSON.stringify({ error: `unknown tool: ${call.name}` }),
        });
        continue;
      }
      try {
        const result = await tool.execute(call.args);
        toolCallCount += 1;
        bus.emit('agent:activity', {
          agentId: ctx.agentId,
          phase: 'tool_result',
          detail: call.name,
        });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: JSON.stringify(result),
        });
      } catch (e) {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        });
      }
    }
  }

  return {
    finalMessage: '[max iterations reached]',
    toolCallCount,
  };
}
