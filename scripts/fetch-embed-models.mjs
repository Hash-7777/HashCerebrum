#!/usr/bin/env node
// Vendors the in-app embedding model into public/models/embed/. These weights
// are large (>5 MB) so they are NOT committed to git (see .gitignore) — they are
// fetched once at setup and bundled into the built app. At runtime the app never
// downloads anything (transformers.js runs with allowRemoteModels=false), so the
// privacy/offline guarantee holds; this script is a dev/build-time step only.
//
// Usage:  npm run setup:models
//
// - Fallback model (bge-small-en-v1.5, MIT) is a prebuilt transformers.js export
//   and is downloaded directly here, so semantic search works out of the box.
// - Default model (MedEmbed-small-v0.1, Apache-2.0, medical) has no prebuilt
//   ONNX repo; convert it once with HF Optimum (instructions printed below) to
//   upgrade. The app prefers MedEmbed and falls back to bge-small automatically.

import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'models', 'embed');
const HF = 'https://huggingface.co';

// repo on the HF hub -> local folder name (must match model.config.ts ids)
const FALLBACK = { repo: 'Xenova/bge-small-en-v1.5', dir: 'bge-small-en-v1.5' };
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_quantized.onnx',
];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(repo, file, destDir) {
  const url = `${HF}/${repo}/resolve/main/${file}`;
  const dest = join(destDir, file);
  if (await exists(dest)) {
    console.log(`  • ${file} (already present)`);
    return;
  }
  process.stdout.write(`  • ${file} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`${(buf.length / 1024 / 1024).toFixed(1)} MB`);
}

async function main() {
  console.log(`Fetching fallback embedding model: ${FALLBACK.repo}`);
  const destDir = join(OUT, FALLBACK.dir);
  for (const file of FILES) {
    try {
      await download(FALLBACK.repo, file, destDir);
    } catch (err) {
      // special_tokens_map.json is optional for some repos — warn, continue.
      if (file.includes('special_tokens_map')) console.log(`(skipped: ${err.message})`);
      else throw err;
    }
  }
  console.log('\n✓ Fallback model ready — semantic memory will work.\n');
  console.log('To use the medical default (MedEmbed-small), convert it once:');
  console.log('  pip install "optimum[onnxruntime]"');
  console.log('  optimum-cli export onnx --model abhinand/MedEmbed-small-v0.1 \\');
  console.log('    --task feature-extraction public/models/embed/medembed-small-v0.1');
  console.log('  (keep the quantised onnx as onnx/model_quantized.onnx)\n');
}

main().catch((err) => {
  console.error('\n✗ Model fetch failed:', err.message);
  process.exit(1);
});
