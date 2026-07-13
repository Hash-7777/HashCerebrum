// Approximate token accounting and per-model context sizing for chat context
// assembly. The provider catalog does not carry per-model context windows, so we
// size conservatively from the model id — always erring small so a request never
// overflows a modest window.

const CHARS_PER_TOKEN = 4; // rough average for English + biomedical prose

/** Approximate token count of a string (chars ÷ 4). Deliberately cheap — exact
 *  tokenisation would need each provider's tokenizer; a slight over-estimate is
 *  the safe direction for a budget. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// Approximate context windows (tokens) keyed by a pattern on the model id.
const KNOWN_WINDOWS: Array<{ rx: RegExp; tokens: number }> = [
  { rx: /claude|sonnet|opus|haiku|fable/i, tokens: 200000 },
  { rx: /gemini|flash|pro-1\.5|pro-2/i, tokens: 1000000 },
  { rx: /gpt-4\.1|gpt-4o|gpt-5|o[34]\b|omni/i, tokens: 128000 },
  { rx: /llama-?3\.[13]|llama-?4|llama-?3-70|scout|maverick/i, tokens: 128000 },
  { rx: /deepseek/i, tokens: 64000 },
  { rx: /qwen|mixtral|mistral-large|command-r/i, tokens: 32000 },
  { rx: /gpt-3\.5|-8k\b/i, tokens: 8000 },
];
const DEFAULT_WINDOW = 8000;

/** Best-effort context window (tokens) for a model id; small default when unknown. */
export function contextWindowTokens(modelId: string | undefined): number {
  if (!modelId) return DEFAULT_WINDOW;
  for (const { rx, tokens } of KNOWN_WINDOWS) if (rx.test(modelId)) return tokens;
  return DEFAULT_WINDOW;
}

/** How many tokens of replayed conversation history we allow for a model — a
 *  fraction of its window, floored so a tiny model still gets some context and
 *  capped so a huge window does not replay an unbounded transcript. The rest of
 *  the window is reserved for the system prompt, retrieved evidence, and output. */
export function historyTokenBudget(modelId: string | undefined): number {
  const window = contextWindowTokens(modelId);
  return Math.max(1200, Math.min(Math.floor(window * 0.25), 24000));
}
