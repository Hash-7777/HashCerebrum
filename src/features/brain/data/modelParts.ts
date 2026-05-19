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

// Light validation — fail loud if someone edits the JSON into a bad
// shape. We do not silently fall back to a default, because that would
// hide the bug behind an empty brain.
function validate(map: unknown): RegionMapShape {
  if (!map || typeof map !== 'object') throw new Error('region-map.json is not an object');
  const m = map as Partial<RegionMapShape>;
  if (!m.model || typeof m.model !== 'object') throw new Error('region-map.json.model is missing');
  if (!Array.isArray(m.parts)) throw new Error('region-map.json.parts is not an array');
  for (const part of m.parts) {
    if (!part.nodeName || !part.id || !part.label) {
      throw new Error(`region-map.json.parts entry missing id/nodeName/label: ${JSON.stringify(part)}`);
    }
    if (!Array.isArray(part.regionIds) || part.regionIds.length === 0) {
      throw new Error(`region-map.json part ${part.id} has no regionIds`);
    }
  }
  return m as RegionMapShape;
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
