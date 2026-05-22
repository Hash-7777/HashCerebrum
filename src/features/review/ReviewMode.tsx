// Review mode — structured quality assessment for single studies.
// Supports RoB 2 (RCTs), ROBINS-I (non-randomised), and QUADAS-2
// (diagnostic accuracy). Assessments can be copied as Markdown for
// pasting into a manuscript or external tool.

import { useMemo, useState } from 'react';
import { Icon } from '@ui/icons';
import {
  ROB2_DOMAINS,
  ROBINSI_DOMAINS,
  rob2Overall,
  robinsIOverall,
  quadas2Overall,
  type Rob2Domain,
  type RobinsIDomain,
  type Rob2Judgement,
  type RobinsIJudgement,
  type Quadas2Judgement,
} from '@features/brain/swarm/evidenceQuality';

type Tool = 'rob2' | 'robins-i' | 'quadas2';

const TOOLS: { id: Tool; label: string; description: string }[] = [
  {
    id: 'rob2',
    label: 'RoB 2',
    description: 'Risk of Bias 2 — for randomised controlled trials',
  },
  {
    id: 'robins-i',
    label: 'ROBINS-I',
    description: 'Risk Of Bias In Non-randomised Studies — for observational and quasi-experimental designs',
  },
  {
    id: 'quadas2',
    label: 'QUADAS-2',
    description: 'Quality Assessment of Diagnostic Accuracy Studies',
  },
];

const ROB2_OPTIONS: { value: Rob2Judgement; label: string }[] = [
  { value: 'low', label: 'Low risk' },
  { value: 'some_concerns', label: 'Some concerns' },
  { value: 'high', label: 'High risk' },
];

const ROBINSI_OPTIONS: { value: RobinsIJudgement; label: string }[] = [
  { value: 'low', label: 'Low risk' },
  { value: 'moderate', label: 'Moderate risk' },
  { value: 'serious', label: 'Serious risk' },
  { value: 'critical', label: 'Critical risk' },
  { value: 'no_information', label: 'No information' },
];

const QUADAS2_OPTIONS: { value: Quadas2Judgement; label: string }[] = [
  { value: 'low', label: 'Low risk' },
  { value: 'high', label: 'High risk' },
  { value: 'unclear', label: 'Unclear' },
];

function judgementClass(value: string): string {
  if (value === 'low') return 'judgement-low';
  if (value === 'some_concerns' || value === 'moderate' || value === 'unclear') return 'judgement-moderate';
  if (value === 'high' || value === 'serious') return 'judgement-high';
  if (value === 'critical') return 'judgement-critical';
  return 'judgement-none';
}

function overallLabel(tool: Tool, overall: string): string {
  if (overall === 'low') return tool === 'quadas2' ? 'Low concern' : 'Low risk';
  if (overall === 'some_concerns') return 'Some concerns';
  if (overall === 'moderate') return 'Moderate risk';
  if (overall === 'serious') return 'Serious risk';
  if (overall === 'high') return tool === 'quadas2' ? 'High concern' : 'High risk';
  if (overall === 'critical') return 'Critical risk';
  if (overall === 'unclear') return 'Unclear';
  return 'No information';
}

export function ReviewMode() {
  const [tool, setTool] = useState<Tool>('rob2');
  const [studyTitle, setStudyTitle] = useState('');
  const [rob2Domains, setRob2Domains] = useState<Record<string, { judgement: Rob2Judgement; support: string }>>(() =>
    Object.fromEntries(ROB2_DOMAINS.map((d) => [d, { judgement: 'low' as Rob2Judgement, support: '' }])),
  );
  const [robinsIDomains, setRobinsIDomains] = useState<Record<string, { judgement: RobinsIJudgement; support: string }>>(() =>
    Object.fromEntries(ROBINSI_DOMAINS.map((d) => [d, { judgement: 'low' as RobinsIJudgement, support: '' }])),
  );
  const [quadas2Domains, setQuadas2Domains] = useState<Record<string, { judgement: Quadas2Judgement; support: string }>>(() =>
    Object.fromEntries(
      ['Patient selection', 'Index test', 'Reference standard', 'Flow and timing'].map((d) => [
        d,
        { judgement: 'low' as Quadas2Judgement, support: '' },
      ]),
    ),
  );

  const overall = useMemo(() => {
    if (tool === 'rob2') {
      const domains: Rob2Domain[] = ROB2_DOMAINS.map((domain) => ({
        domain,
        judgement: rob2Domains[domain]?.judgement ?? 'low',
        support: rob2Domains[domain]?.support ?? '',
      }));
      return rob2Overall(domains);
    }
    if (tool === 'robins-i') {
      const domains: RobinsIDomain[] = ROBINSI_DOMAINS.map((domain) => ({
        domain,
        judgement: robinsIDomains[domain]?.judgement ?? 'low',
        support: robinsIDomains[domain]?.support ?? '',
      }));
      return robinsIOverall(domains);
    }
    const assessment = {
      studyId: '',
      title: '',
      patientSelection: {
        domain: 'Patient selection',
        judgement: quadas2Domains['Patient selection']?.judgement ?? 'low',
        support: quadas2Domains['Patient selection']?.support ?? '',
      },
      indexTest: {
        domain: 'Index test',
        judgement: quadas2Domains['Index test']?.judgement ?? 'low',
        support: quadas2Domains['Index test']?.support ?? '',
      },
      referenceStandard: {
        domain: 'Reference standard',
        judgement: quadas2Domains['Reference standard']?.judgement ?? 'low',
        support: quadas2Domains['Reference standard']?.support ?? '',
      },
      flowTiming: {
        domain: 'Flow and timing',
        judgement: quadas2Domains['Flow and timing']?.judgement ?? 'low',
        support: quadas2Domains['Flow and timing']?.support ?? '',
      },
    };
    return quadas2Overall(assessment);
  }, [tool, rob2Domains, robinsIDomains, quadas2Domains]);

  const copyMarkdown = async () => {
    const lines: string[] = [];
    lines.push(`# ${TOOLS.find((t) => t.id === tool)?.label} assessment`);
    lines.push('');
    lines.push(`**Study:** ${studyTitle || '(untitled)'}`);
    lines.push(`**Tool:** ${TOOLS.find((t) => t.id === tool)?.label}`);
    lines.push(`**Overall:** ${overallLabel(tool, overall)}`);
    lines.push('');
    if (tool === 'rob2') {
      for (const domain of ROB2_DOMAINS) {
        const d = rob2Domains[domain]!;
        lines.push(`## ${domain}`);
        lines.push(`- **Judgement:** ${d.judgement}`);
        if (d.support) lines.push(`- **Support:** ${d.support}`);
        lines.push('');
      }
    } else if (tool === 'robins-i') {
      for (const domain of ROBINSI_DOMAINS) {
        const d = robinsIDomains[domain]!;
        lines.push(`## ${domain}`);
        lines.push(`- **Judgement:** ${d.judgement}`);
        if (d.support) lines.push(`- **Support:** ${d.support}`);
        lines.push('');
      }
    } else {
      for (const domain of ['Patient selection', 'Index test', 'Reference standard', 'Flow and timing']) {
        const d = quadas2Domains[domain]!;
        lines.push(`## ${domain}`);
        lines.push(`- **Judgement:** ${d.judgement}`);
        if (d.support) lines.push(`- **Support:** ${d.support}`);
        lines.push('');
      }
    }
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  const renderRob2 = () => (
    <div className="review-form">
      {ROB2_DOMAINS.map((domain) => {
        const d = rob2Domains[domain]!;
        return (
          <fieldset key={domain} className="review-domain">
            <legend>{domain}</legend>
            <div className="review-domain-row">
              <select
                value={d.judgement}
                onChange={(e) =>
                  setRob2Domains((prev) => ({ ...prev, [domain]: { ...prev[domain]!, judgement: e.target.value as Rob2Judgement } }))
                }
                className={judgementClass(d.judgement)}
              >
                {ROB2_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              placeholder="Quoted evidence from the paper supporting this judgement…"
              value={d.support}
              onChange={(e) => setRob2Domains((prev) => ({ ...prev, [domain]: { ...prev[domain]!, support: e.target.value } }))}
              rows={3}
            />
          </fieldset>
        );
      })}
    </div>
  );

  const renderRobinsI = () => (
    <div className="review-form">
      {ROBINSI_DOMAINS.map((domain) => {
        const d = robinsIDomains[domain]!;
        return (
          <fieldset key={domain} className="review-domain">
            <legend>{domain}</legend>
            <div className="review-domain-row">
              <select
                value={d.judgement}
                onChange={(e) =>
                  setRobinsIDomains((prev) => ({
                    ...prev,
                    [domain]: { ...prev[domain]!, judgement: e.target.value as RobinsIJudgement },
                  }))
                }
                className={judgementClass(d.judgement)}
              >
                {ROBINSI_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              placeholder="Quoted evidence from the paper supporting this judgement…"
              value={d.support}
              onChange={(e) =>
                setRobinsIDomains((prev) => ({ ...prev, [domain]: { ...prev[domain]!, support: e.target.value } }))
              }
              rows={3}
            />
          </fieldset>
        );
      })}
    </div>
  );

  const renderQuadas2 = () => (
    <div className="review-form">
      {(['Patient selection', 'Index test', 'Reference standard', 'Flow and timing'] as const).map((domain) => {
        const d = quadas2Domains[domain]!;
        return (
          <fieldset key={domain} className="review-domain">
            <legend>{domain}</legend>
            <div className="review-domain-row">
              <select
                value={d.judgement}
                onChange={(e) =>
                  setQuadas2Domains((prev) => ({
                    ...prev,
                    [domain]: { ...prev[domain]!, judgement: e.target.value as Quadas2Judgement },
                  }))
                }
                className={judgementClass(d.judgement)}
              >
                {QUADAS2_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              placeholder="Quoted evidence from the paper supporting this judgement…"
              value={d.support}
              onChange={(e) =>
                setQuadas2Domains((prev) => ({ ...prev, [domain]: { ...prev[domain]!, support: e.target.value } }))
              }
              rows={3}
            />
          </fieldset>
        );
      })}
    </div>
  );

  return (
    <div className="mode review-mode">
      <section className="review-main" aria-label="Quality review">
        <header className="review-toolbar">
          <div>
            <p className="eyebrow">
              <Icon name="shield" size={10} /> Review
            </p>
            <h1>Study quality assessment</h1>
            <p className="review-subtitle">Structured risk-of-bias and diagnostic accuracy checklists</p>
          </div>
          <div className="review-tools">
            <button type="button" className="review-export" onClick={() => void copyMarkdown()}>
              <Icon name="copy" size={12} /> Copy Markdown
            </button>
          </div>
        </header>

        <div className="review-study">
          <label>
            <span>Study title</span>
            <input
              type="text"
              placeholder="e.g. Smith et al. 2024 — RCT of intervention X"
              value={studyTitle}
              onChange={(e) => setStudyTitle(e.target.value)}
              maxLength={200}
            />
          </label>
        </div>

        <div className="review-tool-tabs" role="tablist">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tool === t.id}
              data-active={tool === t.id}
              onClick={() => setTool(t.id)}
            >
              <strong>{t.label}</strong>
              <span>{t.description}</span>
            </button>
          ))}
        </div>

        <div className="review-overall" data-overall={overall}>
          <span>Overall</span>
          <strong className={judgementClass(overall)}>{overallLabel(tool, overall)}</strong>
        </div>

        {tool === 'rob2' && renderRob2()}
        {tool === 'robins-i' && renderRobinsI()}
        {tool === 'quadas2' && renderQuadas2()}
      </section>
    </div>
  );
}
