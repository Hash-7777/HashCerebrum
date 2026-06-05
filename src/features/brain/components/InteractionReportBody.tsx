// Renders a Drug-Interactions report as formatted clinical cards instead of raw
// markdown. The app has no general markdown renderer (assistant text is plain
// pre-wrap), which left the DI report showing literal ** bold ** and 【S#】
// source markers. This is a focused, structure-aware renderer for the report's
// known shape: pair headers, A–X grade lines, Mechanism/Effect/Action/Evidence
// rows, critical alerts, confidence, and the disclaimer line.

import type { ReactNode } from 'react';
import type { Grade } from '../swarm/interactionMatrix';

// Internal source markers — 【S2】, [S3], 【4】 — are scaffolding, not for display.
const SOURCE_MARKER_RX = /[[【]\s*S?\d+\s*[\]】]/g;

function stripMarkers(text: string): string {
  return text
    .replace(SOURCE_MARKER_RX, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:)])/g, '$1')
    .trim();
}

// Inline **bold** / *italic*, with markers stripped.
function inline(text: string): ReactNode[] {
  const clean = stripMarkers(text);
  const out: ReactNode[] = [];
  clean.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).forEach((part, i) => {
    if (!part) return;
    if (/^\*\*[^*]+\*\*$/.test(part)) out.push(<strong key={i}>{part.slice(2, -2)}</strong>);
    else if (/^\*[^*]+\*$/.test(part)) out.push(<em key={i}>{part.slice(1, -1)}</em>);
    else out.push(<span key={i}>{part}</span>);
  });
  return out;
}

const GRADE_RX = /^\*\*\s*Grade:\s*([A-DX])\s*(?:[—–-]\s*)?(.*?)\s*\*\*$/i;
const PAIR_RX = /^\*\*\s*(.+?[↔⇌].+?)\s*\*\*$/;
const RULE_RX = /^(?:[-*_]\s*){3,}$/;

export function InteractionReportBody({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let para: string[] = [];

  const flush = (key: string) => {
    if (para.length === 0) return;
    const text = para.join(' ');
    para = [];
    const trimmed = text.trim();
    // The closing disclaimer line is wrapped in * … * — render it muted.
    if (/^\*[^*].*\*$/.test(trimmed) && /verif|triage|not medical advice/i.test(trimmed)) {
      blocks.push(
        <p key={key} className="di-report-note">
          {inline(trimmed)}
        </p>,
      );
      return;
    }
    blocks.push(
      <p key={key} className="di-report-p">
        {inline(text)}
      </p>,
    );
  };

  lines.forEach((raw, index) => {
    const line = raw.trim();
    const key = `l${index}`;
    if (!line) {
      flush(key);
      return;
    }
    if (RULE_RX.test(line)) {
      flush(key);
      blocks.push(<hr key={key} className="di-report-rule" />);
      return;
    }
    const grade = line.match(GRADE_RX);
    if (grade) {
      flush(key);
      const g = (grade[1] ?? 'C').toUpperCase() as Grade;
      blocks.push(
        <p key={key} className="di-report-grade">
          <span className={`di-report-chip di-grade-${g.toLowerCase()}`}>{g}</span>
          <strong>{grade[2] || g}</strong>
        </p>,
      );
      return;
    }
    const pair = line.match(PAIR_RX);
    if (pair) {
      flush(key);
      blocks.push(
        <h4 key={key} className="di-report-pair">
          {inline(pair[1] ?? line)}
        </h4>,
      );
      return;
    }
    if (/^[-*]\s+/.test(line)) {
      flush(key);
      blocks.push(
        <div key={key} className="di-report-li">
          {inline(line.replace(/^[-*]\s+/, ''))}
        </div>,
      );
      return;
    }
    para.push(line);
  });
  flush('end');

  return <div className="di-report">{blocks}</div>;
}
