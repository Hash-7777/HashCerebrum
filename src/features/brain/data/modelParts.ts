// Brain part → region binding. The actual mapping lives in
// region-map.json so a GLB swap is a data change, not a code change.
// The JSON is also the single source of truth for the validate script
// (scripts/validate-brain-model.mjs).
//
// Adding a new mesh:
//   1. Drop the GLB at the path declared in the JSON
//   2. Run `npm run validate:brain-model` to list node names
//   3. Update the JSON parts[] to bind node names → RegionId values
//   4. No TS edit needed

import type { RegionId } from '@config/agents';
import { regionById } from './regions';
import rawMap from './region-map.json';

export interface BrainModelMeta {
  path: string;
  title: string;
  source: string;
  license: string;
  sourceUrl: string;
}

export interface BrainModelPart {
  id: string;
  nodeName: string;
  label: string;
  regionIds: RegionId[];
  note: string;
}

interface RegionMapShape {
  model: BrainModelMeta;
  parts: BrainModelPart[];
}

function isRegionMapShape(value: unknown): value is RegionMapShape {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  if (!m.model || typeof m.model !== 'object') return false;
  if (!Array.isArray(m.parts)) return false;
  for (const part of m.parts) {
    if (!part || typeof part !== 'object') return false;
    const p = part as Record<string, unknown>;
    if (!p.nodeName || !p.id || !p.label) return false;
    if (!Array.isArray(p.regionIds) || p.regionIds.length === 0) return false;
  }
  return true;
}

// Light validation — fail loud if someone edits the JSON into a bad
// shape. We do not silently fall back to a default, because that would
// hide the bug behind an empty brain.
function validate(map: unknown): RegionMapShape {
  if (!isRegionMapShape(map)) throw new Error('region-map.json failed validation');
  return map;
}

const map = validate(rawMap);

export const BRAIN_MODEL: BrainModelMeta = map.model;
export const BRAIN_MODEL_PARTS: BrainModelPart[] = map.parts;

export const PARTS_BY_NODE = new Map(BRAIN_MODEL_PARTS.map((part) => [part.nodeName, part]));

export const partForRegion = (regionId: RegionId): BrainModelPart | undefined =>
  BRAIN_MODEL_PARTS.find((part) => part.regionIds.includes(regionId));

export const primaryRegionForPart = (part: BrainModelPart): RegionId => part.regionIds[0]!;

export const partColor = (part: BrainModelPart): string =>
  regionById(primaryRegionForPart(part)).emissive;

export const labelForRegionPart = (regionId: RegionId): string => {
  const part = partForRegion(regionId);
  return part ? part.label : regionById(regionId).label;
};
