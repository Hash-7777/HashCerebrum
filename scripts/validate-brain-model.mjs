import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const modelPath = path.join(root, 'public/models/brain/science-museum-human-brain.glb');
const expectedNodes = new Set([
  'Object_2',
  'Object_3',
  'Object_4',
  'Object_5',
  'Object_6',
  'Object_7',
  'Object_8',
  'Object_9',
]);

function fail(message) {
  console.error(`brain model validation failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(modelPath)) {
  fail(`missing ${path.relative(root, modelPath)}`);
}

const data = fs.readFileSync(modelPath);
if (data.toString('utf8', 0, 4) !== 'glTF') {
  fail('file is not a binary glTF');
}

const version = data.readUInt32LE(4);
if (version !== 2) {
  fail(`expected glTF 2.0, got ${version}`);
}

const jsonLength = data.readUInt32LE(12);
const jsonType = data.toString('utf8', 16, 20).trim();
if (jsonType !== 'JSON') {
  fail(`first GLB chunk is ${jsonType}, expected JSON`);
}

const json = JSON.parse(data.slice(20, 20 + jsonLength).toString('utf8'));
const nodes = new Set((json.nodes ?? []).map((node) => node.name).filter(Boolean));
const missing = [...expectedNodes].filter((name) => !nodes.has(name));
if (missing.length) {
  fail(`missing expected mesh nodes: ${missing.join(', ')}`);
}

const license = json.asset?.extras?.license;
const source = json.asset?.extras?.source;
if (license !== 'CC0-1.0 (http://creativecommons.org/publicdomain/zero/1.0/)') {
  fail(`unexpected license metadata: ${license ?? 'none'}`);
}
if (source !== 'https://sketchfab.com/3d-models/model-of-a-human-brain-fc7ae7b989f94c80a50152e71f44e47c') {
  fail(`unexpected source metadata: ${source ?? 'none'}`);
}

console.log(`brain model validation passed: ${expectedNodes.size} mesh nodes, ${license}`);
