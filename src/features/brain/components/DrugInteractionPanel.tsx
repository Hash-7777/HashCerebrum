// Side panel for the Drug-Interactions mode — replaces the agent-swarm panel
// with a clinical interaction-grade key (A–X) and a safety note, so the mode
// reads as a focused interaction checker rather than the general research team.

import { Icon } from '@ui/icons';

const GRADES: Array<{ grade: string; label: string; detail: string; cls: string }> = [
  { grade: 'A', label: 'None', detail: 'No known interaction', cls: 'a' },
  { grade: 'B', label: 'Minor', detail: 'Monitor — usually no action', cls: 'b' },
  { grade: 'C', label: 'Moderate', detail: 'Monitor closely; adjust dose/timing', cls: 'c' },
  { grade: 'D', label: 'Major', detail: 'Intervention needed before combining', cls: 'd' },
  { grade: 'X', label: 'Contraindicated', detail: 'Avoid the combination', cls: 'x' },
];

export function DrugInteractionPanel() {
  return (
    <aside className="di-panel" aria-label="Drug interaction grading">
      <header className="di-panel-head">
        <span className="di-panel-mark" aria-hidden="true">
          <Icon name="pill" size={16} />
        </span>
        <div>
          <h2>Drug Interactions</h2>
          <p>Each drug pair is graded from trusted label &amp; literature sources.</p>
        </div>
      </header>

      <div className="di-grades">
        {GRADES.map((g) => (
          <div key={g.grade} className={`di-grade di-grade-${g.cls}`}>
            <span className="di-grade-badge">{g.grade}</span>
            <span className="di-grade-text">
              <strong>{g.label}</strong>
              <span>{g.detail}</span>
            </span>
          </div>
        ))}
      </div>

      <p className="di-panel-note">
        When evidence is thin or conflicting the checker errs toward the more serious grade.
        Informational triage only — verify with a licensed pharmacist or physician.
      </p>
    </aside>
  );
}
