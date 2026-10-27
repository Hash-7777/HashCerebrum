// The pre-commit gate, run for real against planted cases.
//
// A secret scanner has one failure mode worse than a false alarm: matching
// nothing and reporting "clean". That is exactly what an unsupported grep
// option produces, because every match fails and every file looks safe. So
// this suite runs `.githooks/pre-commit` itself, in a throwaway repository,
// with whatever bash and grep the machine running the tests has — the same
// tools the hook meets on a real commit.
//
// The fake secrets are assembled at runtime from pieces. Written out whole,
// they would make this file one the hook refuses to commit.

import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../../.githooks/pre-commit', import.meta.url));

// Each case starts a repository and runs the hook, so every assertion waits on
// several real git processes. The default per-test limit is tuned for pure
// functions and is reached on a busy machine while the suite runs in parallel,
// which turns this file into a flaky gate rather than a failing one.
const GIT_TIMEOUT_MS = 30_000;
const roots: string[] = [];

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}

/** A fresh repository with no hooks configured, so only the hook under test runs. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hc-precommit-'));
  roots.push(dir);
  git(dir, 'init', '-q');
  return dir;
}

function put(dir: string, path: string, content: string | Buffer): void {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** Stage `files` (forced, so .gitignore cannot hide a case) and run the hook. */
function runHook(dir: string, files: Record<string, string | Buffer>) {
  for (const [path, content] of Object.entries(files)) put(dir, path, content);
  git(dir, 'add', '-f', '--', ...Object.keys(files));
  const r = spawnSync('bash', [HOOK], { cwd: dir, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr };
}

const filler = (n: number) => 'Ab1_'.repeat(Math.ceil(n / 4)).slice(0, n);
const FAKE = {
  anthropic: 'sk-' + 'ant-' + filler(40),
  openaiProject: 'sk-' + 'proj-' + filler(48),
  groq: 'gsk' + '_' + 'AbCd1234'.repeat(5),
  google: 'AI' + 'za' + filler(35),
  github: 'gh' + 'p_' + 'AbCd1234'.repeat(5),
  privateKey: '-----BEGIN OPENSSH ' + 'PRIVATE KEY-----',
  envPhraseAssignment: 'PASS' + 'PHRASE=' + 'correct-horse',
  codePhraseLiteral: 'pass' + "phrase: 'hunter22'",
};

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe('pre-commit hook — refuses', { timeout: GIT_TIMEOUT_MS }, () => {
  it.each(Object.entries(FAKE))('a staged %s', (_kind, secret) => {
    const r = runHook(repo(), { 'src/config.ts': `export const value = "${secret}";\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('refused');
  });

  it('a local-only note, even when force-added past .gitignore', () => {
    const r = runHook(repo(), { 'PLAN.local.md': '# plan\n' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('PLAN.local.md');
  });

  it('a handoff note and a real .env file', () => {
    const r = runHook(repo(), { 'SESSION_HANDOFF.md': 'x\n', '.env.production': 'X=1\n' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('SESSION_HANDOFF.md');
    expect(r.stderr).toContain('.env.production');
  });

  it('a binary over 5 MB outside public/models', () => {
    const r = runHook(repo(), { 'assets/big.bin': Buffer.alloc(5 * 1024 * 1024 + 1) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('assets/big.bin');
  });
});

describe('pre-commit hook — allows', { timeout: GIT_TIMEOUT_MS }, () => {
  it('ordinary code whose words merely contain a key prefix', () => {
    const r = runHook(repo(), {
      'src/a.css': '.task-assignment-and-scheduling-panel { color: red; }\n',
      'src/b.ts': 'const apiKey = settings.get("openai");\nconst risk = "risk-adjusted-hazard-ratio-table";\n',
      'src/c.ts': 'interface Unlock { passphrase: string }\nconst p: Unlock = { passphrase: askUser() };\n',
      '.env.example': 'OPENAI_API_KEY=\n',
    });
    expect(r.stderr).toBe('pre-commit: no secrets, notes, build output or oversized files staged.\n');
    expect(r.status).toBe(0);
  });

  it('a licensed model asset over 5 MB under public/models', () => {
    const r = runHook(repo(), { 'public/models/brain/brain.glb': Buffer.alloc(5 * 1024 * 1024 + 1) });
    expect(r.status).toBe(0);
  });

  it('removing a secret that was already committed', () => {
    const dir = repo();
    put(dir, 'src/config.ts', `export const value = "${FAKE.anthropic}";\n`);
    git(dir, 'add', 'src/config.ts');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false',
      'commit', '-q', '--no-verify', '-m', 'seed');
    const r = runHook(dir, { 'src/config.ts': 'export const value = settings.key();\n' });
    expect(r.status).toBe(0);
  });
});
