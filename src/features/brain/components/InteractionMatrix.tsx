// Colour-coded pairwise interaction grid shown above the detailed grade cards
// in Drug-Interactions mode. Drugs are numbered; row headers carry the name and
// number, column headers are the numbers alone, so long drug names never widen
// the grid. Every cell is the A–X grade for that pair, parsed deterministically
// from the report (see interactionMatrix.ts) so it always matches the cards.

import type { InteractionMatrix as Matrix, Grade } from '../swarm/interactionMatrix';
import { gradeLabel } from '../swarm/interactionMatrix';

const LEGEND: Grade[] = ['A', 'B', 'C', 'D', 'X'];

export function InteractionMatrix({ matrix }: { matrix: Matrix }) {
  const { drugs, cells } = matrix;
  return (
    <figure className="di-matrix" aria-label="Drug interaction matrix">
      <figcaption className="di-matrix-cap">Interaction overview</figcaption>
      <div className="di-matrix-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col" className="di-matrix-corner">
                <span className="di-matrix-axis">Drug</span>
              </th>
              {drugs.map((drug, i) => (
                <th key={drug} scope="col" className="di-matrix-colnum" title={drug}>
                  {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drugs.map((drug, i) => (
              <tr key={drug}>
                <th scope="row" className="di-matrix-rowhead" title={drug}>
                  <span className="di-matrix-num">{i + 1}</span>
                  <span className="di-matrix-name">{drug}</span>
                </th>
                {cells[i]!.map((grade, j) => {
                  if (i === j) {
                    return (
                      <td key={j} className="di-matrix-self" aria-hidden="true">
                        ·
                      </td>
                    );
                  }
                  if (!grade) {
                    return (
                      <td key={j} className="di-matrix-empty" title="Not graded">
                        –
                      </td>
                    );
                  }
                  return (
                    <td
                      key={j}
                      className="di-matrix-cell"
                      data-grade={grade}
                      title={`${drug} ↔ ${drugs[j]} — ${grade} (${gradeLabel(grade)})`}
                    >
                      {grade}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="di-matrix-legend" aria-hidden="true">
        {LEGEND.map((g) => (
          <span key={g} className="di-matrix-legend-item">
            <span className="di-matrix-legend-swatch" data-grade={g}>
              {g}
            </span>
            {gradeLabel(g)}
          </span>
        ))}
      </div>
    </figure>
  );
}
