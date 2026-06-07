// Side panel for Genetics mode — replaces the agent-swarm panel with a
// confidence-band key and a note on the trusted sources, so the mode reads as a
// focused gene-correlation checker.

import { Icon } from '@ui/icons';

const BANDS: Array<{ label: string; range: string; detail: string; cls: string }> = [
  { label: 'Very strong', range: '80–100%', detail: 'Consistent, well-powered association', cls: 'vstrong' },
  { label: 'Strong', range: '60–79%', detail: 'Multiple concordant significant studies', cls: 'strong' },
  { label: 'Moderate', range: '40–59%', detail: 'Some significant support', cls: 'moderate' },
  { label: 'Weak', range: '20–39%', detail: 'Limited or mixed evidence', cls: 'weak' },
  { label: 'Insufficient', range: '< 20%', detail: 'No quantifiable published association', cls: 'insufficient' },
];

export function GeneticsPanel() {
  return (
    <aside className="gene-panel" aria-label="Gene–disease association grading">
      <header className="gene-panel-head">
        <span className="gene-panel-mark" aria-hidden="true">
          <Icon name="dna" size={16} />
        </span>
        <div>
          <h2>Genetics</h2>
          <p>Gene variant × disease, scored from GWAS Catalog, ClinVar &amp; literature.</p>
        </div>
      </header>

      <p className="gene-bands-cap">Association confidence</p>
      <div className="gene-bands">
        {BANDS.map((b) => (
          <div key={b.label} className={`gene-band gene-band-${b.cls}`}>
            <span className="gene-band-range">{b.range}</span>
            <span className="gene-band-text">
              <strong>{b.label}</strong>
              <span>{b.detail}</span>
            </span>
          </div>
        ))}
      </div>

      <p className="gene-band-note">
        The score reflects the strength of the <strong>published association</strong>, computed in code from the
        retrieved records — not a personal risk estimate.
      </p>

      <div className="gene-disclaimer" role="note">
        <p className="gene-disclaimer-text">
          <Icon name="alert" size={13} />
          <span>
            <strong>Not medical advice.</strong> Verify every finding against the cited sources and a qualified
            clinician or geneticist before any decision.
          </span>
        </p>
      </div>
    </aside>
  );
}
