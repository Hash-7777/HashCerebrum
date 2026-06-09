function modelSizeScore(text: string): number {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*([bkmt])\b/gi)];
  if (matches.length === 0) return 0;
  return Math.max(
    ...matches.map(([, n, unit]) => {
      const value = Number(n) || 0;
      const normalized = (unit ?? '').toLowerCase();
      if (normalized === 't') return value * 1000;
      if (normalized === 'b') return value;
      if (normalized === 'm') return value / 1000;
      return value / 1_000_000;
    }),
  );
}

export function modelStrengthScore(value: string, label = '', bigTask = true): number {
  const text = `${value} ${label}`.toLowerCase();
  let score = 0;
  const add = (match: RegExp, points: number) => {
    if (match.test(text)) score += points;
  };

  add(/\bgpt-5|gpt5|o3|o4|gpt-4\.1|gpt-4o|claude-4|opus|sonnet/i, 160);
  add(/gemini-2\.5-pro|gemini.*pro/i, 150);
  add(/deepseek[-\s]?r1|deepseek[-\s]?v3/i, 135);
  add(/llama-4|maverick|scout/i, 128);
  add(/nemotron|hermes-3|qwen3|qwen-3|qwq/i, 118);
  add(/gpt-oss-120b|405b|235b|120b|70b/i, 105);
  add(/llama-3\.3|llama-3\.1/i, 65);

  // Parameter count is a signal, not the verdict. Capped low so a huge but
  // fragile model cannot outscore a smaller, reliable, tool-capable flagship on
  // raw size alone — the bug that made a rate-limited free 405B the auto-boss.
  // (Free-tier reliability is handled separately at auto-assignment time so this
  // capability score still ranks the discovery catalog faithfully.)
  score += Math.min(modelSizeScore(text), 140);
  if (bigTask) {
    add(/pro|opus|sonnet|r1|v3|405b|235b|120b|70b|maverick|nemotron|hermes/i, 60);
    add(/flash|lite|mini|small|fast|instant|8b|20b/i, -90);
  } else {
    add(/flash|fast|instant|lite/i, 25);
  }
  add(/embedding|rerank|moderation|safeguard|guard|image|tts|whisper|transcrib|realtime|ocr/i, -1000);
  return score;
}
