// The review's result panels: the overall score ring, one collapsible section
// per review agent with its live status, and the citation-faithfulness card
// that grades each cited claim against the source snippet it cites.

import { useState } from 'react';
import type { AgentReviewResult } from '@core/store/peerReviewStore';
import type { EvidenceItem } from '@platform/index';
import { Icon } from '@ui/icons';
import { sourcesForMarkers, type FaithfulnessGrade } from '../citationAudit';
import type { CitationAudit, FaithfulnessItem } from '../citationGrade';
import { isSafeUrl } from './editorHtml';

export function ScoreRing({ score }: { score: number }) {
  const tier = score >= 8 ? 'high' : score >= 5 ? 'mid' : 'low';
  const safeScore = Math.max(1, Math.min(10, score));
  const radius = 19;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - safeScore / 10);
  return (
    <div className="review-score-ring" data-tier={tier}>
      <svg className="review-score-svg" viewBox="0 0 44 44" aria-hidden="true">
        <circle className="review-score-track" cx="22" cy="22" r={radius} />
        <circle
          className="review-score-progress"
          cx="22"
          cy="22"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span className="review-score-value">
        <span className="review-score-number">{safeScore}</span>
        <span className="review-score-denom">/10</span>
      </span>
    </div>
  );
}

function AgentDot({ status }: { status: AgentReviewResult['status'] }) {
  return <span className={`review-agent-dot review-agent-dot--${status}`} aria-hidden="true" />;
}

// Display metadata for each faithfulness grade. `tone` drives the badge colour
// (green → red) and `glyph` is a compact one-character cue.
const FAITH_GRADE_META: Record<FaithfulnessGrade, { label: string; tone: string; glyph: string }> = {
  supported:    { label: 'Supported',    tone: 'ok',    glyph: '✓' },
  weak:         { label: 'Weak',         tone: 'weak',  glyph: '~' },
  overstated:   { label: 'Overstated',   tone: 'warn',  glyph: '↑' },
  unsupported:  { label: 'Unsupported',  tone: 'bad',   glyph: '?' },
  contradicted: { label: 'Contradicted', tone: 'bad',   glyph: '✕' },
  unassessed:   { label: 'Not assessed', tone: 'muted', glyph: '·' },
};

const FAITH_SUMMARY_ORDER: FaithfulnessGrade[] = [
  'supported', 'weak', 'overstated', 'unsupported', 'contradicted', 'unassessed',
];

/** One graded claim, with its cited source(s) revealed on click (verify). */
function FaithfulnessRow({ item, citations }: { item: FaithfulnessItem; citations: EvidenceItem[] }) {
  const meta = FAITH_GRADE_META[item.grade];
  const sources = sourcesForMarkers(item.markers, citations);
  return (
    <div className={`review-faith-row review-faith-row--${meta.tone}`}>
      <div className="review-faith-row-head">
        <span className={`review-faith-badge review-faith-badge--${meta.tone}`} title={meta.label}>
          <span aria-hidden="true">{meta.glyph}</span> {meta.label}
        </span>
        <span className="review-faith-markers">
          {item.markers.map((n) => `[${n}]`).join(' ')}
        </span>
      </div>
      <p className="review-faith-claim">{item.sentence}</p>
      {item.note && <p className="review-faith-note">{item.note}</p>}
      {sources.length > 0 && (
        <details className="review-faith-sources">
          <summary>Verify source{sources.length > 1 ? 's' : ''}</summary>
          {sources.map((s) => (
            <div className="review-faith-source" key={s.marker}>
              <p className="review-faith-source-title">
                <span className="review-faith-source-marker">[{s.marker}]</span> {s.title}
                {s.year ? ` · ${s.year}` : ''}
              </p>
              {s.snippet && <p className="review-faith-source-snippet">{s.snippet}</p>}
              <p className="review-faith-source-ids">
                {s.pmid && (
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    PMID {s.pmid}
                  </a>
                )}
                {s.doi && (
                  <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noreferrer">
                    doi:{s.doi}
                  </a>
                )}
                {!s.pmid && !s.doi && s.url && isSafeUrl(s.url) && (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    Source
                  </a>
                )}
              </p>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

/**
 * Citation-faithfulness card. Renders the grading result for a Brain manuscript
 * (every cited claim checked against the snippet it cites), or a clear
 * "cannot verify" note for an uploaded document with no source records.
 */
export function CitationFaithfulnessCard({
  audit,
  citations,
  hasSources,
  streaming,
}: {
  audit?: CitationAudit;
  citations: EvidenceItem[];
  hasSources: boolean;
  streaming: boolean;
}) {
  if (!hasSources) {
    return (
      <div className="review-faith-block">
        <p className="review-bullets-label review-faith-label">Citation Faithfulness</p>
        <p className="review-faith-empty">
          Citations could not be verified — this document carries no source records to
          check claims against.
        </p>
      </div>
    );
  }
  if (!audit) {
    if (streaming) {
      return (
        <div className="review-faith-block">
          <p className="review-bullets-label review-faith-label">Citation Faithfulness</p>
          <p className="review-faith-empty">Checking cited claims against their sources…</p>
        </div>
      );
    }
    return null;
  }
  return (
    <div className="review-faith-block">
      <p className="review-bullets-label review-faith-label">Citation Faithfulness</p>
      <div className="review-faith-summary">
        {FAITH_SUMMARY_ORDER.filter((g) => audit.counts[g] > 0).map((g) => {
          const meta = FAITH_GRADE_META[g];
          return (
            <span
              key={g}
              className={`review-faith-chip review-faith-chip--${meta.tone}`}
              title={meta.label}
            >
              {meta.label} {audit.counts[g]}
            </span>
          );
        })}
        <span className="review-faith-checked">{audit.checked} claim{audit.checked === 1 ? '' : 's'} checked</span>
      </div>
      <div className="review-faith-list">
        {audit.items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: claims are a static, ordered list
          <FaithfulnessRow key={i} item={item} citations={citations} />
        ))}
      </div>
    </div>
  );
}

export function AgentSection({
  agent,
  def,
}: {
  agent: AgentReviewResult;
  def: { label: string; iconName: string };
}) {
  const [open, setOpen] = useState(false);
  const hasContent = agent.items.length > 0 || agent.text.trim().length > 0 || Boolean(agent.error);

  return (
    <div className={`review-agent-section review-agent-section--${agent.status}`}>
      <button
        type="button"
        className="review-agent-section-head"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasContent}
      >
        <AgentDot status={agent.status} />
        <span className="review-agent-section-label">{def.label}</span>
        <span className="review-agent-section-status">
          {agent.status === 'running' ? (
            <Icon name="spinner" size={11} />
          ) : agent.status === 'error' ? (
            <Icon name="alert" size={11} />
          ) : agent.status === 'done' ? (
            agent.items.length > 0 ? `${agent.items.length} items` : 'done'
          ) : (
            'waiting'
          )}
        </span>
        {hasContent && (
          <span className={`review-agent-chevron${open ? ' open' : ''}`} aria-hidden="true">
            <Icon name="chevDown" size={11} />
          </span>
        )}
      </button>
      {open && hasContent && (
        <div className="review-agent-section-body">
          {agent.status === 'error' ? (
            <p className="review-agent-error">{agent.error}</p>
          ) : agent.items.length > 0 ? (
            <ul>
              {agent.items.map((item, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static list
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="review-agent-raw">{agent.text}</p>
          )}
        </div>
      )}
    </div>
  );
}
