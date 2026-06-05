// Side panel for the Drug-Interactions mode — replaces the agent-swarm panel
// with a clinical interaction-grade key (A–X) and a safety note, so the mode
// reads as a focused interaction checker rather than the general research team.

import { useEffect, useState } from 'react';
import { Icon } from '@ui/icons';
import { useModeStore } from '@core/store/modeStore';
import { DrugInteractionDisclaimer, hasAckedDiDisclaimer } from './DrugInteractionDisclaimer';

const GRADES: Array<{ grade: string; label: string; detail: string; cls: string }> = [
  { grade: 'A', label: 'None', detail: 'No known interaction', cls: 'a' },
  { grade: 'B', label: 'Minor', detail: 'Monitor — usually no action', cls: 'b' },
  { grade: 'C', label: 'Moderate', detail: 'Monitor closely; adjust dose/timing', cls: 'c' },
  { grade: 'D', label: 'Major', detail: 'Intervention needed before combining', cls: 'd' },
  { grade: 'X', label: 'Contraindicated', detail: 'Avoid the combination', cls: 'x' },
];

export function DrugInteractionPanel() {
  // Gate first use behind the full disclaimer; allow re-opening it any time.
  // The panel is mounted (hidden) at app start, so only raise the gate once the
  // Drug-Interactions mode is actually active — not on launch.
  const isActive = useModeStore((s) => s.mode === 'drug_interactions');
  const [disclaimer, setDisclaimer] = useState<'gate' | 'review' | null>(null);
  useEffect(() => {
    if (isActive && !hasAckedDiDisclaimer()) setDisclaimer('gate');
  }, [isActive]);

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

      <p className="di-grades-cap">Interaction grade</p>
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

      <p className="di-grade-bias">
        When evidence is thin or conflicting, the grade is set to the more serious level.
      </p>

      <div className="di-disclaimer" role="note">
        <p className="di-disclaimer-text">
          <Icon name="alert" size={13} />
          <span>
            <strong>Not medical advice.</strong> Automated triage that can be wrong — always confirm with a
            licensed pharmacist or physician before any decision.
          </span>
        </p>
        <button type="button" className="di-disclaimer-link" onClick={() => setDisclaimer('review')}>
          Read full disclaimer →
        </button>
      </div>

      {disclaimer && (
        <DrugInteractionDisclaimer mode={disclaimer} onClose={() => setDisclaimer(null)} />
      )}
    </aside>
  );
}
