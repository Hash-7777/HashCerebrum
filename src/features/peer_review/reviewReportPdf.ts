// Builds a structured jsPDF peer-review report from a completed PaperReview.
// Layout: mint accent bar, title block, score badge, then one section per
// swarm agent (and the classic overall sections as a summary).

import jsPDF from 'jspdf';
import type { ReviewedPaper } from '@core/store/peerReviewStore';
import { REVIEW_SWARM_AGENTS } from './reviewSwarm';

// Light document palette — readable, print-friendly, high contrast. The mint
// brand colour (#82e0c2) is too pale on white, so headings/accents use a deep
// teal; body text is near-black.
const ACCENT_R = 26, ACCENT_G = 122, ACCENT_B = 99; // #1a7a63 deep teal
const INK_R = 38, INK_G = 38, INK_B = 46;           // body text
const MUTED_R = 110, MUTED_G = 112, MUTED_B = 120;  // meta / footer
const GREEN_R = 31, GREEN_G = 116, GREEN_B = 80;    // strengths / high score
const AMBER_R = 173, AMBER_G = 116, AMBER_B = 28;   // mid score
const RED_R = 192, RED_G = 57, RED_B = 43;          // weaknesses / low score
const PAGE_W = 210;
const PAGE_H = 297;
const ML = 18, MR = 18;
const CONTENT_W = PAGE_W - ML - MR;
const FONT_NORMAL = 10;
const FONT_SMALL  = 8.5;
const LINE_H      = 5.2;

function accentBar(doc: jsPDF) {
  doc.setFillColor(ACCENT_R, ACCENT_G, ACCENT_B);
  doc.rect(0, 0, PAGE_W, 3.5, 'F');
}

function newPage(doc: jsPDF): number {
  doc.addPage();
  accentBar(doc);
  return 14;
}

function checkPage(doc: jsPDF, y: number, needed = 14): number {
  if (y + needed > PAGE_H - 12) return newPage(doc);
  return y;
}

function heading(doc: jsPDF, text: string, y: number): number {
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(ACCENT_R, ACCENT_G, ACCENT_B);
  doc.text(text.toUpperCase(), ML, y);
  doc.setDrawColor(ACCENT_R, ACCENT_G, ACCENT_B);
  doc.setLineWidth(0.4);
  doc.line(ML, y + 1.5, PAGE_W - MR, y + 1.5);
  doc.setDrawColor(180, 180, 180);
  return y + 6;
}

function paragraph(doc: jsPDF, text: string, y: number): number {
  doc.setFontSize(FONT_NORMAL);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(INK_R, INK_G, INK_B);
  const lines = doc.splitTextToSize(text, CONTENT_W) as string[];
  for (const line of lines) {
    y = checkPage(doc, y, LINE_H);
    doc.text(line, ML, y);
    y += LINE_H;
  }
  return y + 2;
}

function bulletList(doc: jsPDF, items: string[], y: number): number {
  doc.setFontSize(FONT_NORMAL);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(INK_R, INK_G, INK_B);
  for (const item of items) {
    y = checkPage(doc, y, LINE_H * 2);
    const lines = doc.splitTextToSize(item, CONTENT_W - 6) as string[];
    doc.setTextColor(ACCENT_R, ACCENT_G, ACCENT_B);
    doc.text('–', ML, y);
    doc.setTextColor(INK_R, INK_G, INK_B);
    doc.text(lines[0] ?? '', ML + 5, y);
    y += LINE_H;
    for (let i = 1; i < lines.length; i++) {
      y = checkPage(doc, y, LINE_H);
      doc.text(lines[i]!, ML + 5, y);
      y += LINE_H;
    }
  }
  return y + 2;
}

function scoreBox(doc: jsPDF, score: number, x: number, y: number) {
  const [tr, tg, tb] = score >= 8 ? [GREEN_R, GREEN_G, GREEN_B]
    : score >= 5 ? [AMBER_R, AMBER_G, AMBER_B]
    : [RED_R, RED_G, RED_B];
  doc.setDrawColor(tr!, tg!, tb!);
  doc.setLineWidth(1.2);
  doc.circle(x, y, 9, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(tr!, tg!, tb!);
  doc.text(String(score), x, y + 2, { align: 'center' });
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(MUTED_R, MUTED_G, MUTED_B);
  doc.text('/10', x, y + 6.5, { align: 'center' });
}

export async function buildReviewReportPdf(paper: ReviewedPaper): Promise<Blob> {
  const { review } = paper;
  if (!review) throw new Error('No review available to export.');

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  // White document background (jsPDF default), with a deep-teal accent bar.
  accentBar(doc);

  // ── Title block ────────────────────────────────────────────────────────
  let y = 22;
  doc.setFont('times', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(ACCENT_R, ACCENT_G, ACCENT_B);
  doc.text('PEER REVIEW REPORT · HASHCEREBRUM', ML, y);
  y += 7;

  doc.setFont('times', 'normal');
  doc.setFontSize(17);
  doc.setTextColor(20, 20, 24);
  const titleLines = doc.splitTextToSize(paper.title, CONTENT_W - 22) as string[];
  for (const line of titleLines) {
    doc.text(line, ML, y);
    y += 7.5;
  }

  // score ring — top right
  scoreBox(doc, review.score, PAGE_W - MR - 9, 32);

  // meta line
  y += 2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT_SMALL);
  doc.setTextColor(MUTED_R, MUTED_G, MUTED_B);
  const date = new Date(review.reviewedAt).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  doc.text(`Reviewed ${date} · Model: ${review.modelUsed}`, ML, y);
  y += 10;

  // ── Overall summary ────────────────────────────────────────────────────
  y = heading(doc, 'Overall Assessment', y);
  y = paragraph(doc, review.summary, y);

  if (review.strengths.length > 0) {
    y = checkPage(doc, y, 12);
    doc.setFontSize(FONT_SMALL);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(GREEN_R, GREEN_G, GREEN_B);
    doc.text('STRENGTHS', ML, y);
    y += 4;
    y = bulletList(doc, review.strengths, y);
  }
  if (review.weaknesses.length > 0) {
    y = checkPage(doc, y, 12);
    doc.setFontSize(FONT_SMALL);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(RED_R, RED_G, RED_B);
    doc.text('WEAKNESSES', ML, y);
    y += 4;
    y = bulletList(doc, review.weaknesses, y);
  }

  // ── Standard sections ──────────────────────────────────────────────────
  const standard: [string, string][] = [
    ['Methodology', review.methodology],
    ['Statistics', review.statistics],
    ['Conclusions', review.conclusions],
    ['Publication Readiness', review.publishReadiness],
  ];
  for (const [title, text] of standard) {
    if (!text) continue;
    y = checkPage(doc, y, 18);
    y = heading(doc, title, y);
    y = paragraph(doc, text, y);
  }

  // ── Per-agent swarm sections ───────────────────────────────────────────
  if (review.agentResults && review.agentResults.length > 0) {
    y = newPage(doc);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(20, 20, 24);
    doc.text('Swarm Agent Analysis', ML, y);
    y += 10;

    for (const agentDef of REVIEW_SWARM_AGENTS) {
      if (agentDef.agentId === 'orchestrator') continue; // already above
      const result = review.agentResults.find((r) => r.agentId === agentDef.agentId);
      if (!result || result.status !== 'done' || !result.text) continue;

      y = checkPage(doc, y, 18);
      y = heading(doc, agentDef.label, y);

      if (result.items.length > 0) {
        y = bulletList(doc, result.items, y);
      } else {
        y = paragraph(doc, result.text.slice(0, 1200), y);
      }
      y += 3;
    }
  }

  // ── Footer on every page ───────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 65, 75);
    doc.text(
      `HashCerebrum Peer Review  ·  ${date}  ·  Page ${p} of ${pageCount}`,
      PAGE_W / 2,
      PAGE_H - 6,
      { align: 'center' },
    );
  }

  return doc.output('blob');
}
