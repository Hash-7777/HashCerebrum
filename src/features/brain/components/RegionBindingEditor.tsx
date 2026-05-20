// Dev-only brain region binding editor. Reached via ?dev=bindings in a
// dev build (see AppShell). Loads the configured GLB, lists every mesh
// node, lets you bind each node to one or more anatomical regions, and
// exports an updated region-map.json for src/features/brain/data/.
//
// This is a tool, not a shipped feature: AppShell gates it behind
// import.meta.env.DEV so it is never reachable in a production build.

import { Suspense, useMemo, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { RegionId } from '@config/agents';
import { REGIONS } from '../data/regions';
import { BRAIN_MODEL, BRAIN_MODEL_PARTS } from '../data/modelParts';

const REGION_MAP_COMMENT =
  'GLB-swap protocol: replace the asset under public/models/brain/, run npm run validate:brain-model to confirm the node names, then update the bindings below. Code does not need to change.';

interface EditableRow {
  id: string;
  nodeName: string;
  label: string;
  regionIds: RegionId[];
  note: string;
  inModel: boolean;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'part';
}

function buildRows(modelNodeNames: string[]): EditableRow[] {
  const byNode = new Map(BRAIN_MODEL_PARTS.map((part) => [part.nodeName, part]));
  const seen = new Set<string>();
  const rows: EditableRow[] = [];
  for (const nodeName of modelNodeNames) {
    seen.add(nodeName);
    const existing = byNode.get(nodeName);
    rows.push({
      id: existing?.id ?? slugify(nodeName),
      nodeName,
      label: existing?.label ?? '',
      regionIds: existing ? [...existing.regionIds] : [],
      note: existing?.note ?? '',
      inModel: true,
    });
  }
  // Bindings present in region-map.json but absent from the loaded GLB.
  for (const part of BRAIN_MODEL_PARTS) {
    if (seen.has(part.nodeName)) continue;
    rows.push({
      id: part.id,
      nodeName: part.nodeName,
      label: part.label,
      regionIds: [...part.regionIds],
      note: part.note,
      inModel: false,
    });
  }
  return rows;
}

function EditorBody() {
  const gltf = useGLTF(BRAIN_MODEL.path);

  const modelNodeNames = useMemo(() => {
    const names: string[] = [];
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Mesh && object.name) names.push(object.name);
    });
    return names;
  }, [gltf.scene]);

  const [rows, setRows] = useState<EditableRow[]>(() => buildRows(modelNodeNames));

  const updateRow = (nodeName: string, patch: Partial<EditableRow>) => {
    setRows((current) => current.map((row) => (row.nodeName === nodeName ? { ...row, ...patch } : row)));
  };

  const toggleRegion = (nodeName: string, region: RegionId) => {
    setRows((current) =>
      current.map((row) => {
        if (row.nodeName !== nodeName) return row;
        const has = row.regionIds.includes(region);
        return {
          ...row,
          regionIds: has ? row.regionIds.filter((id) => id !== region) : [...row.regionIds, region],
        };
      }),
    );
  };

  const exportable = rows.filter((row) => row.regionIds.length > 0);
  const unboundCount = rows.filter((row) => row.inModel && row.regionIds.length === 0).length;
  const staleCount = rows.filter((row) => !row.inModel).length;
  const coveredRegions = new Set(exportable.flatMap((row) => row.regionIds));
  const missingRegions = REGIONS.filter((region) => !coveredRegions.has(region.id));

  const exportJson = () => {
    const parts = exportable.map((row) => ({
      id: row.id,
      nodeName: row.nodeName,
      label: row.label.trim() || row.nodeName,
      regionIds: row.regionIds,
      note: row.note.trim(),
    }));
    const doc = { model: BRAIN_MODEL, _comment: REGION_MAP_COMMENT, parts };
    const blob = new Blob([`${JSON.stringify(doc, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'region-map.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="region-editor-toolbar">
        <div className="region-editor-stats">
          <span>{exportable.length} bound</span>
          <span data-tone={unboundCount > 0 ? 'warn' : 'ok'}>{unboundCount} unbound in GLB</span>
          <span data-tone={staleCount > 0 ? 'warn' : 'ok'}>{staleCount} stale binding</span>
          <span data-tone={missingRegions.length > 0 ? 'warn' : 'ok'}>
            {missingRegions.length} region{missingRegions.length === 1 ? '' : 's'} uncovered
          </span>
        </div>
        <button type="button" className="region-editor-export" onClick={exportJson} disabled={exportable.length === 0}>
          Download region-map.json
        </button>
      </div>

      {missingRegions.length > 0 && (
        <p className="region-editor-hint">
          No mesh is bound to: {missingRegions.map((region) => region.label).join(', ')}. Those regions will not light
          up until a node is bound to them.
        </p>
      )}

      <div className="region-editor-rows">
        {rows.map((row) => (
          <section
            key={row.nodeName}
            className="region-editor-row"
            data-state={!row.inModel ? 'stale' : row.regionIds.length === 0 ? 'unbound' : 'bound'}
          >
            <header>
              <code>{row.nodeName}</code>
              <span className="region-editor-badge">
                {!row.inModel ? 'stale — not in GLB' : row.regionIds.length === 0 ? 'unbound' : `${row.regionIds.length} region(s)`}
              </span>
            </header>
            <div className="region-editor-fields">
              <label>
                <span>Label</span>
                <input
                  value={row.label}
                  placeholder={row.nodeName}
                  onChange={(event) => updateRow(row.nodeName, { label: event.target.value })}
                />
              </label>
              <label>
                <span>Note</span>
                <input
                  value={row.note}
                  placeholder="Why this node maps to these regions"
                  onChange={(event) => updateRow(row.nodeName, { note: event.target.value })}
                />
              </label>
            </div>
            <div className="region-editor-chips" role="group" aria-label={`Regions for ${row.nodeName}`}>
              {REGIONS.map((region) => {
                const active = row.regionIds.includes(region.id);
                return (
                  <button
                    key={region.id}
                    type="button"
                    className="region-editor-chip"
                    data-active={active}
                    style={{ '--chip-color': region.emissive } as React.CSSProperties}
                    aria-pressed={active}
                    onClick={() => toggleRegion(row.nodeName, region.id)}
                  >
                    {region.label}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

export function RegionBindingEditor() {
  return (
    <div className="region-editor">
      <header className="region-editor-head">
        <div>
          <p className="region-editor-eyebrow">Dev tool · ?dev=bindings</p>
          <h1>Brain region binding editor</h1>
          <p className="region-editor-sub">
            Bind GLB mesh nodes to anatomical regions, then download an updated <code>region-map.json</code> and
            replace the file in <code>src/features/brain/data/</code>.
          </p>
        </div>
        <a className="region-editor-exit" href={window.location.pathname}>
          Exit
        </a>
      </header>
      <Suspense fallback={<div className="region-editor-loading">Loading {BRAIN_MODEL.path}…</div>}>
        <EditorBody />
      </Suspense>
    </div>
  );
}
