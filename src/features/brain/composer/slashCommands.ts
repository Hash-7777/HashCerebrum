// Slash-command "skills" for the mega-mind Brain composer. A leading `/token`
// forces an intent (or an effort modifier) for that turn, overriding the automatic
// classifier. Only LEADING tokens are commands; a `/` anywhere later in the message
// is literal text. Peer Review is intentionally NOT a command — it stays its own
// mode operating on an already-produced paper.

export type SlashIntent = 'genetics' | 'drug_interactions' | 'paper' | 'lookup' | 'rag';
export type SlashEffort = 'mini' | 'deep';

export interface SlashCommand {
  /** Canonical command, including the leading slash. */
  command: string;
  aliases?: string[];
  intent?: SlashIntent;
  effort?: SlashEffort;
  label: string;
  help: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/paper', intent: 'paper', label: 'Full paper', help: 'Draft a full, source-grounded manuscript' },
  { command: '/genetics', intent: 'genetics', label: 'Genetics', help: 'Gene / variant × disease association report' },
  {
    command: '/interactions',
    aliases: ['/pharmacist', '/drugs'],
    intent: 'drug_interactions',
    label: 'Interactions',
    help: 'Grade drug–drug interactions A–X',
  },
  { command: '/search', intent: 'lookup', label: 'Quick search', help: 'A short, cited answer — no manuscript' },
  { command: '/rag', intent: 'rag', label: 'Memory recall', help: 'Answer from your saved research memory' },
  { command: '/mini', effort: 'mini', label: 'Mini', help: 'Lighter pipeline — fewer calls, for free / local models' },
  { command: '/deep', effort: 'deep', label: 'Deep', help: 'More specialists and a verification pass' },
];

// command (and alias) → definition, for O(1) lookup.
const BY_TOKEN = new Map<string, SlashCommand>();
for (const cmd of SLASH_COMMANDS) {
  BY_TOKEN.set(cmd.command, cmd);
  for (const alias of cmd.aliases ?? []) BY_TOKEN.set(alias, cmd);
}

export interface ParsedInput {
  /** The message with recognised leading commands stripped. */
  text: string;
  forcedIntent?: SlashIntent;
  forcedEffort?: SlashEffort;
  /** Canonical commands that were applied, in order. */
  applied: string[];
}

const LEADING_TOKEN = /^\s*(\/[a-z][a-z-]*)(?=\s|$)/i;

/**
 * Consume leading `/command` tokens. The first intent command wins; an effort
 * command (/mini, /deep) may accompany it. Parsing stops at the first token that is
 * not a known command, so the rest of the message (including any later `/`) is left
 * untouched. An unknown leading `/x` is treated as literal text.
 */
export function parseSlashCommands(raw: string): ParsedInput {
  let rest = raw;
  const applied: string[] = [];
  let forcedIntent: SlashIntent | undefined;
  let forcedEffort: SlashEffort | undefined;

  for (;;) {
    const match = LEADING_TOKEN.exec(rest);
    if (!match) break;
    const token = match[1]!.toLowerCase();
    const cmd = BY_TOKEN.get(token);
    if (!cmd) break; // unknown leading command → stop, keep as text
    // Ignore a second intent command or a repeated modifier — first wins.
    if (cmd.intent && forcedIntent) break;
    if (cmd.effort && forcedEffort) break;
    if (cmd.intent) forcedIntent = cmd.intent;
    if (cmd.effort) forcedEffort = cmd.effort;
    applied.push(cmd.command);
    rest = rest.slice(match[0].length);
  }

  return {
    text: rest.replace(/^\s+/, ''),
    ...(forcedIntent ? { forcedIntent } : {}),
    ...(forcedEffort ? { forcedEffort } : {}),
    applied,
  };
}

/** Commands whose canonical name or alias starts with the typed prefix (for the
 *  autocomplete popover). An empty or bare "/" prefix lists everything. */
export function matchingCommands(prefix: string): SlashCommand[] {
  const p = prefix.trim().toLowerCase();
  if (!p.startsWith('/')) return [];
  if (p === '/') return SLASH_COMMANDS;
  const seen = new Set<SlashCommand>();
  const out: SlashCommand[] = [];
  for (const cmd of SLASH_COMMANDS) {
    const names = [cmd.command, ...(cmd.aliases ?? [])];
    if (names.some((n) => n.startsWith(p)) && !seen.has(cmd)) {
      seen.add(cmd);
      out.push(cmd);
    }
  }
  return out;
}

/** Whether the current input is an in-progress slash token at the very start
 *  (used to decide when to show the autocomplete popover). */
export function activeSlashPrefix(raw: string): string | null {
  const m = /^\s*(\/[a-z-]*)$/i.exec(raw);
  return m ? m[1]! : null;
}
