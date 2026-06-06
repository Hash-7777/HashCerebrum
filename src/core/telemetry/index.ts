// Local OpenTelemetry-style tracing — mirrors Rust telemetry spans in the renderer.
// All data stays on device; no external endpoints.

import { bus } from '@core/bus/EventBus';

interface TraceSpan {
  id: number;
  traceId: string;
  parentId?: number | null;
  name: string;
  startedAt: string;
  endedAt?: string | null;
  status: string;
  attributes?: string | null;
}

const spans = new Map<string, TraceSpan[]>();

export function recordSpan(
  traceId: string,
  name: string,
  startedAt: string,
  endedAt?: string,
  status = 'ok',
  attributes?: Record<string, unknown>,
) {
  const list = spans.get(traceId) ?? [];
  list.push({
    id: list.length + 1,
    traceId,
    parentId: null,
    name,
    startedAt,
    endedAt: endedAt ?? null,
    status,
    attributes: attributes ? JSON.stringify(attributes) : null,
  });
  spans.set(traceId, list);
  bus.emit('telemetry:span', { traceId, name, status });
}

export function getSpans(traceId: string): TraceSpan[] {
  return spans.get(traceId) ?? [];
}

export function allTraceIds(): string[] {
  return Array.from(spans.keys());
}
