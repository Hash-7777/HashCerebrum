import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LlmMessage } from '@core/llm/types';
import { agentModelFor } from '@core/store/agentModelStore';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';
import { useProjectStore } from '@core/store/projectStore';
import { useResearchRunStore } from '@core/store/researchRunStore';
import { classifyEvidenceStrength } from '@core/rag';
import { useRagStore, type NewRagChunk } from '@core/store/ragStore';
import { notify } from '@platform/notify';
import { runSwarm } from '@features/brain/swarm/runSwarm';
import { memoryTopicLabel, citedEvidenceFor } from '@features/brain/memoryTopic';
import { isMetaOrAppQuestion } from '@features/brain/swarm/paper';
import { manuscriptToReadableText } from '@features/brain/swarm/manuscript';
import { Icon } from '@ui/icons';
import type { PaperJobSpec, EffectRow } from './types';
import { PAPER_TYPES, paperTypeById } from './paperTypeRegistry';

const STEPS = [
  'Question',
  'Type',
  'PICO & Style',
  'Data',
  'Options',
  'Review',
] as const;

type StepIndex = 0 | 1 | 2 | 3 | 4 | 5;

function emptySpec(): PaperJobSpec {
  return {
    title: '',
    question: '',
    paperType: 'systematic_review',
    pico: { population: '', intervention: '', comparator: '', outcomes: [''] },
    effectData: [],
    citationStyle: 'vancouver',
    options: { mini: false, outlineFirst: false },
  };
}

function buildSyntheticQuestion(spec: PaperJobSpec): string {
  const parts: string[] = [];
  parts.push(spec.title || spec.question);
  if (spec.pico.population) parts.push(`Population: ${spec.pico.population}`);
  if (spec.pico.intervention) parts.push(`Intervention: ${spec.pico.intervention}`);
  if (spec.pico.comparator) parts.push(`Comparator: ${spec.pico.comparator}`);
  if (spec.pico.outcomes.some((o) => o.trim())) {
    parts.push(`Outcomes: ${spec.pico.outcomes.filter(Boolean).join(', ')}`);
  }
  if (spec.effectData.length > 0) {
    parts.push('Data:');
    for (const row of spec.effectData) {
      const n = row.sampleSize ? ` (n=${row.sampleSize})` : '';
      parts.push(`- ${row.label}${n}: ${row.measure} ${row.point} (95% CI ${row.ciLow}-${row.ciHigh})`);
    }
  }
  parts.push(`Paper type: ${paperTypeById(spec.paperType)?.label ?? spec.paperType}`);
  parts.push(`Citation style: ${spec.citationStyle}`);
  parts.push('Requirements: write a full research paper with numbered citations, honest reporting, and source-grounded claims.');
  return parts.join('\n');
}

export function PaperMode() {
  const [step, setStep] = useState<StepIndex>(0);
  const [spec, setSpec] = useState<PaperJobSpec>(emptySpec);
  const [isRunning, setIsRunning] = useState(false);
  const [manuscript, setManuscript] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const modelGroups = useModelCatalogStore((s) => s.groups);
  const availableModels = useMemo(() => modelGroups.flatMap((g) => g.models), [modelGroups]);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const runs = useResearchRunStore();

  const updateSpec = useCallback((patch: Partial<PaperJobSpec>) => {
    setSpec((s) => ({ ...s, ...patch }));
  }, []);

  const updatePico = useCallback((patch: Partial<PaperJobSpec['pico']>) => {
    setSpec((s) => ({ ...s, pico: { ...s.pico, ...patch } }));
  }, []);

  const addEffectRow = useCallback(() => {
    setSpec((s) => ({
      ...s,
      effectData: [...s.effectData, { label: '', measure: 'HR', point: 1, ciLow: 0.5, ciHigh: 1.5 }],
    }));
  }, []);

  const removeEffectRow = useCallback((index: number) => {
    setSpec((s) => ({ ...s, effectData: s.effectData.filter((_, i) => i !== index) }));
  }, []);

  const updateEffectRow = useCallback((index: number, patch: Partial<EffectRow>) => {
    setSpec((s) => ({
      ...s,
      effectData: s.effectData.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }, []);

  const addOutcome = useCallback(() => {
    setSpec((s) => ({
      ...s,
      pico: { ...s.pico, outcomes: [...s.pico.outcomes, ''] },
    }));
  }, []);

  const removeOutcome = useCallback((index: number) => {
    setSpec((s) => ({
      ...s,
      pico: { ...s.pico, outcomes: s.pico.outcomes.filter((_, i) => i !== index) },
    }));
  }, []);

  const updateOutcome = useCallback((index: number, value: string) => {
    setSpec((s) => ({
      ...s,
      pico: { ...s.pico, outcomes: s.pico.outcomes.map((o, i) => (i === index ? value : o)) },
    }));
  }, []);

  const canAdvance = useMemo(() => {
    switch (step) {
      case 0:
        return spec.title.trim().length > 0 || spec.question.trim().length > 0;
      case 1:
        return true;
      case 2:
        return spec.pico.population.trim().length > 0;
      case 3: {
        const pt = paperTypeById(spec.paperType);
        if (!pt?.requiresDataStep) return true;
        return spec.effectData.length >= 2 && spec.effectData.every((r) => r.label.trim() && r.point > 0 && r.ciLow > 0 && r.ciHigh > r.ciLow);
      }
      case 4:
        return true;
      case 5:
        return true;
    }
  }, [step, spec]);

  const stopRun = useCallback(() => {
    abortRef.current?.abort();
    if (isMounted.current) {
      setIsRunning(false);
      setProgress('Run stopped by user');
    }
  }, []);

  const runPaper = useCallback(async () => {
    if (isRunning || availableModels.length === 0) return;
    setIsRunning(true);
    setManuscript(null);
    setError(null);
    setProgress('Starting…');

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    const syntheticQuestion = buildSyntheticQuestion(spec);
    const cleanQuery = syntheticQuestion;
    const conversation: LlmMessage[] = [{ role: 'user', content: cleanQuery }];

    const traceEntries: import('@core/store/chatHistoryStore').TurnTraceEntry[] = [];
    let activeRunId: string | null = null;
    const ensureResearchRun = () => {
      if (!activeRunId) activeRunId = runs.startRun(cleanQuery, []).id;
      return activeRunId;
    };

    const callbacks = {
      onBossPhase: (phase: string) => {
        if (!isMounted.current) return;
        const detail = phase === 'delegating' || phase === 'synthesizing' ? ensureResearchRun() : '';
        traceEntries.push({ agent: 'boss', phase: phase as string, detail: String(detail) });
        setProgress(phase);
      },
      onSpecialistStart: (agentId: string, subQuery: string) => {
        if (!isMounted.current) return;
        ensureResearchRun();
        traceEntries.push({ agent: agentId, phase: 'start', detail: subQuery });
        setProgress(`${agentId}: ${subQuery}`);
      },
      onSpecialistDone: (agentId: string, recordCount: number) => {
        if (!isMounted.current) return;
        traceEntries.push({ agent: agentId, phase: 'done', detail: `${recordCount} records` });
      },
      onSpecialistError: (agentId: string, message: string) => {
        if (!isMounted.current) return;
        traceEntries.push({ agent: agentId, phase: 'error', detail: message });
      },
      onToolCall: (agentId: string, toolName: string) => {
        traceEntries.push({ agent: agentId, phase: 'tool_call', detail: toolName });
      },
      onToolResult: (agentId: string, toolName: string, count: number) => {
        traceEntries.push({ agent: agentId, phase: 'tool_result', detail: `${toolName}: ${count}` });
      },
      onAnswerToken: (_delta: string) => {
        // streaming not used for paper pipeline
      },
      onManuscriptSection: (heading: string) => {
        if (!isMounted.current) return;
        setProgress(heading);
        traceEntries.push({ agent: 'boss', phase: 'manuscript', detail: heading });
      },
    };

    try {
      const result = await runSwarm({
        question: cleanQuery,
        conversation,
        modelFor: agentModelFor,
        callbacks,
        signal,
        mini: spec.options.mini,
        onPaperDraftComplete: (res) => {
          if (!isMounted.current) return;
          const text = res.manuscript
            ? manuscriptToReadableText(res.manuscript)
            : res.answer || 'Drafting completed.';
          setManuscript(text);
          setProgress(null);
          setIsRunning(false);
          if (res.manuscript) {
            void notify('Manuscript complete', 'Your paper is ready for review and export.');
          }
          if (res.evidence.length > 0 && activeProjectId) {
            const runId = ensureResearchRun();
            runs.storeEvidence(runId, res.evidence);
            runs.storeSummary(runId, text, res.modelUsed);
            const memoryTopic = memoryTopicLabel(cleanQuery);
            const citableForMemory = citedEvidenceFor(text, res.evidence);
            if (memoryTopic && citableForMemory.length > 0 && !isMetaOrAppQuestion(cleanQuery)) {
              const evidenceChunks: NewRagChunk[] = citableForMemory.map((item) => {
                const strength = classifyEvidenceStrength([item.title, item.snippet ?? ''].join(' '), item.source);
                return {
                  kind: 'evidence',
                  title: item.title,
                  text: [item.title, item.snippet ?? ''].filter(Boolean).join(' — '),
                  source: item.source,
                  runId,
                  query: memoryTopic,
                  ...(item.url ? { url: item.url } : {}),
                  ...(item.year != null ? { year: item.year } : {}),
                  ...(item.identifiers?.pmid ? { pmid: item.identifiers.pmid } : {}),
                  ...(item.identifiers?.doi ? { doi: item.identifiers.doi } : {}),
                  ...(item.authors?.length ? { authors: item.authors.slice(0, 8) } : {}),
                  ...(strength ? { evidenceStrength: strength } : {}),
                };
              });
              const answerChunk: NewRagChunk = {
                kind: 'answer',
                title: memoryTopic,
                text,
                source: 'answer',
                runId,
                query: memoryTopic,
              };
              useRagStore.getState().addChunks(activeProjectId, [...evidenceChunks, answerChunk]);
            }
          }
        },
      });

      if (result.kind !== 'drafting') {
        const text =
          result.manuscript
            ? manuscriptToReadableText(result.manuscript)
            : result.answer || 'No response returned.';
        if (isMounted.current) {
          setManuscript(text);
          setProgress(null);
          setIsRunning(false);
        }
      }
    } catch (err) {
      if (!isMounted.current) return;
      const detail = err instanceof Error ? err.message : String(err);
      setError(detail);
      setProgress(null);
      setIsRunning(false);
    }
  }, [isRunning, availableModels, spec, runs, activeProjectId]);

  const exportMarkdown = useCallback(() => {
    if (!manuscript) return;
    const blob = new Blob([manuscript], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${spec.title.replace(/\s+/g, '_') || 'paper'}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [manuscript, spec.title]);

  return (
    <div className="mode paper-mode">
      <header className="paper-header">
        <h1>Paper Studio</h1>
        <p className="paper-subtitle">Structured inputs → deterministic stats → publishable manuscript</p>
      </header>

      <div className="paper-stepper" role="tablist" aria-label="Paper steps">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={i === step}
            className={`paper-step${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}
            onClick={() => !isRunning && setStep(i as StepIndex)}
          >
            <span className="step-num">{i + 1}</span>
            <span className="step-label">{label}</span>
          </button>
        ))}
      </div>

      <div className="paper-body">
        {step === 0 && (
          <div className="paper-step-panel">
            <h2>Research question & title</h2>
            <label>
              Title
              <input
                type="text"
                value={spec.title}
                onChange={(e) => updateSpec({ title: e.target.value })}
                placeholder="e.g. SGLT2 inhibitors in heart failure with mildly reduced ejection fraction"
              />
            </label>
            <label>
              Research question
              <textarea
                value={spec.question}
                onChange={(e) => updateSpec({ question: e.target.value })}
                placeholder="e.g. In patients with HFrEF, do SGLT2 inhibitors reduce cardiovascular mortality compared with placebo?"
                rows={4}
              />
            </label>
          </div>
        )}

        {step === 1 && (
          <div className="paper-step-panel">
            <h2>Paper type</h2>
            <div className="paper-type-grid">
              {PAPER_TYPES.map((pt) => (
                <button
                  key={pt.id}
                  type="button"
                  className={`paper-type-card${spec.paperType === pt.id ? ' active' : ''}`}
                  onClick={() => updateSpec({ paperType: pt.id })}
                >
                  <div className="paper-type-title">{pt.label}</div>
                  <div className="paper-type-desc">{pt.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="paper-step-panel">
            <h2>PICO & citation style</h2>
            <label>
              Population
              <input
                type="text"
                value={spec.pico.population}
                onChange={(e) => updatePico({ population: e.target.value })}
                placeholder="e.g. Adults with HFrEF (LVEF ≤40%)"
              />
            </label>
            <label>
              Intervention
              <input
                type="text"
                value={spec.pico.intervention}
                onChange={(e) => updatePico({ intervention: e.target.value })}
                placeholder="e.g. SGLT2 inhibitor (dapagliflozin or empagliflozin)"
              />
            </label>
            <label>
              Comparator
              <input
                type="text"
                value={spec.pico.comparator}
                onChange={(e) => updatePico({ comparator: e.target.value })}
                placeholder="e.g. Placebo or standard care"
              />
            </label>
            <div className="outcomes-list">
              <label>Outcomes</label>
              {spec.pico.outcomes.map((outcome, i) => (
                <div key={i} className="outcome-row">
                  <input
                    type="text"
                    value={outcome}
                    onChange={(e) => updateOutcome(i, e.target.value)}
                    placeholder={`Outcome ${i + 1}`}
                  />
                  {spec.pico.outcomes.length > 1 && (
                    <button type="button" onClick={() => removeOutcome(i)} aria-label="Remove outcome">
                      <Icon name="minus" size={14} />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="btn sm ghost" onClick={addOutcome}>
                <Icon name="plus" size={13} /> Add outcome
              </button>
            </div>
            <label>
              Citation style
              <select
                value={spec.citationStyle}
                onChange={(e) => updateSpec({ citationStyle: e.target.value as PaperJobSpec['citationStyle'] })}
              >
                <option value="vancouver">Vancouver</option>
                <option value="apa">APA</option>
                <option value="mla">MLA</option>
                <option value="chicago">Chicago</option>
              </select>
            </label>
          </div>
        )}

        {step === 3 && (
          <div className="paper-step-panel">
            <h2>Data — effect-size rows</h2>
            {!paperTypeById(spec.paperType)?.requiresDataStep && (
              <p className="paper-hint">This paper type does not require structured data, but you may add rows if you have them.</p>
            )}
            {spec.effectData.length === 0 ? (
              <p className="paper-hint">Add effect-size rows (HR/OR/RR + 95% CI) so the pipeline can compute pooled estimates and forest plots deterministically.</p>
            ) : (
              <table className="paper-data-table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Measure</th>
                    <th>Point</th>
                    <th>CI low</th>
                    <th>CI high</th>
                    <th>n</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {spec.effectData.map((row, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          type="text"
                          value={row.label}
                          onChange={(e) => updateEffectRow(i, { label: e.target.value })}
                          placeholder="Trial name"
                        />
                      </td>
                      <td>
                        <select
                          value={row.measure}
                          onChange={(e) => updateEffectRow(i, { measure: e.target.value as EffectRow['measure'] })}
                        >
                          <option value="HR">HR</option>
                          <option value="OR">OR</option>
                          <option value="RR">RR</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          value={row.point}
                          onChange={(e) => updateEffectRow(i, { point: Number.parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          value={row.ciLow}
                          onChange={(e) => updateEffectRow(i, { ciLow: Number.parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          value={row.ciHigh}
                          onChange={(e) => updateEffectRow(i, { ciHigh: Number.parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={row.sampleSize ?? ''}
                          onChange={(e) =>
                            updateEffectRow(i, {
                              sampleSize: e.target.value ? Number.parseInt(e.target.value, 10) : undefined,
                            })
                          }
                          placeholder="n"
                        />
                      </td>
                      <td>
                        <button type="button" onClick={() => removeEffectRow(i)} aria-label="Remove row">
                          <Icon name="minus" size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button type="button" className="btn sm ghost" onClick={addEffectRow}>
              <Icon name="plus" size={13} /> Add row
            </button>
          </div>
        )}

        {step === 4 && (
          <div className="paper-step-panel">
            <h2>Sources & options</h2>
            <label className="paper-toggle">
              <input
                type="checkbox"
                checked={spec.options.mini}
                onChange={(e) => updateSpec({ options: { ...spec.options, mini: e.target.checked } })}
              />
              Mini mode — cap specialists to 2 and trim context for small models
            </label>
            <label className="paper-toggle">
              <input
                type="checkbox"
                checked={spec.options.outlineFirst}
                onChange={(e) => updateSpec({ options: { ...spec.options, outlineFirst: e.target.checked } })}
              />
              Outline first — propose structure before drafting
            </label>
            <p className="paper-hint">
              The pipeline will search PubMed, Europe PMC, OpenAlex, ClinicalTrials.gov, and other trusted sources.
            </p>
          </div>
        )}

        {step === 5 && (
          <div className="paper-step-panel">
            <h2>Review & run</h2>
            <div className="paper-review">
              <div className="review-row">
                <span className="review-key">Title</span>
                <span className="review-val">{spec.title || '—'}</span>
              </div>
              <div className="review-row">
                <span className="review-key">Type</span>
                <span className="review-val">{paperTypeById(spec.paperType)?.label}</span>
              </div>
              <div className="review-row">
                <span className="review-key">Population</span>
                <span className="review-val">{spec.pico.population || '—'}</span>
              </div>
              <div className="review-row">
                <span className="review-key">Intervention</span>
                <span className="review-val">{spec.pico.intervention || '—'}</span>
              </div>
              <div className="review-row">
                <span className="review-key">Comparator</span>
                <span className="review-val">{spec.pico.comparator || '—'}</span>
              </div>
              <div className="review-row">
                <span className="review-key">Outcomes</span>
                <span className="review-val">{spec.pico.outcomes.filter(Boolean).join(', ') || '—'}</span>
              </div>
              <div className="review-row">
                <span className="review-key">Data rows</span>
                <span className="review-val">{spec.effectData.length}</span>
              </div>
              <div className="review-row">
                <span className="review-key">Citation style</span>
                <span className="review-val">{spec.citationStyle}</span>
              </div>
            </div>

            {isRunning ? (
              <div className="paper-run-status">
                <div className="paper-spinner">
                  <Icon name="spinner" size={18} />
                </div>
                <span className="paper-progress">{progress || 'Running…'}</span>
                <button type="button" className="btn danger" onClick={stopRun}>
                  Stop
                </button>
              </div>
            ) : (
              <button type="button" className="btn primary" onClick={runPaper} disabled={!canAdvance}>
                <Icon name="send" size={14} /> Run paper pipeline
              </button>
            )}

            {error && (
              <div className="paper-error">
                <Icon name="alert" size={14} /> {error}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="paper-nav">
        <button type="button" className="btn ghost" disabled={step === 0 || isRunning} onClick={() => setStep((s) => (s - 1) as StepIndex)}>
          Back
        </button>
        <button type="button" className="btn" disabled={step === 5 || isRunning || !canAdvance} onClick={() => setStep((s) => (s + 1) as StepIndex)}>
          Next
        </button>
      </div>

      {manuscript && (
        <div className="paper-output">
          <div className="paper-output-header">
            <h3>Manuscript</h3>
            <button type="button" className="btn sm ghost" onClick={exportMarkdown}>
              <Icon name="download" size={13} /> Export MD
            </button>
          </div>
          <pre className="paper-manuscript">{manuscript}</pre>
        </div>
      )}
    </div>
  );
}
