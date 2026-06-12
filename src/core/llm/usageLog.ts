// Records the REAL token usage of a model response to the local usage log that
// the HashMeter ecosystem reads (HashMeterAi). Measured-only: it skips when the
// provider did not report usage, so the log never carries an estimate. The call
// is best-effort — a logging failure must never break or surface inside a run.

import { platform } from '@platform/index';

export function logModelUsage(
  model: string,
  usage?: { inputTokens: number; outputTokens: number },
): void {
  if (!usage || !model) return;
  const input = Math.max(0, Math.round(usage.inputTokens || 0));
  const output = Math.max(0, Math.round(usage.outputTokens || 0));
  if (input === 0 && output === 0) return; // nothing was actually measured
  try {
    void platform()
      .usageLog.append({ ts: new Date().toISOString(), model, input_tokens: input, output_tokens: output })
      .catch(() => {
        /* logging is best-effort */
      });
  } catch {
    /* platform/usageLog unavailable — ignore */
  }
}
