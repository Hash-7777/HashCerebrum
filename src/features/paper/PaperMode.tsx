import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LlmMessage } from '@core/llm/types';
import { agentModelFor } from '@core/store/agentModelStore';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';
import { useProjectStore } from '@core/store/projectStore';
import { useResearchRunStore } from '@core/store/researchRunStore';
import { useToastStore } from '@core/store/toastStore';
import { classifyEvidenceStrength } from '@core/rag';
import { useRagStore, type NewRagChunk } from '@core/store/ragStore';
import { notify } from '@platform/notify';
import { runSwarm } from '@features/brain/swarm/runSwarm';
import { memoryTopicLabel, citedEvidenceFor } from '@features/brain/memoryTopic';
import { isMetaOrAppQuestion } from '@features/brain/swarm/paper';
import { manuscriptToReadableText } from '@features/brain/swarm/manuscript';
import type { Manuscript } from '@features/brain/swarm/manuscript';
import { buildPaperOutline } from '@features/brain/swarm/paperPipeline';
import type { PaperOutline } from '@features/brain/swarm/paperPipeline';
import { summarizeDatasetText, summarizeDatasetXlsx } from '@features/brain/swarm/statistics';
import type { UploadedDatasetSummary } from '@features/brain/swarm/publicationTypes';
import { MarkdownText } from '@ui/MarkdownText';
import { Icon } from '@ui/icons';
import { PdfGlyph } from '@ui/icons/PdfGlyph';
import {
  buildMessagePdfBlob,
  buildMarkdownExport,
  exportMessageDocx,
  downloadBlob,
} from '@features/brain/export/messageExport';
import { exportMessageLatex } from '@features/brain/export/latexExport';
import {
  DocumentPreviewWindow,
  type PreviewDocument,
} from '@features/brain/components/DocumentPreviewWindow';
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

const EXAMPLE_PROMPTS: { title: string; question: string; label: string }[] = [
  {
    label: 'SGLT2 inhibitors in heart failure',
    title: 'SGLT2 inhibitors in heart failure with mildly reduced ejection fraction',
    question:
      'In patients with HFrEF, do SGLT2 inhibitors reduce cardiovascular mortality compared with placebo?',
  },
  {
    label: 'GLP-1 agonists and weight loss',
    title: 'GLP-1 receptor agonists for obesity: a systematic review',
    question:
      'What is the efficacy and safety of GLP-1 receptor agonists for weight loss in adults with obesity?',
  },
  {
    label: 'Anticoagulants in atrial fibrillation',
    title: 'Direct oral anticoagulants versus warfarin in atrial fibrillation',
    question:
      'In patients with non-valvular atrial fibrillation, are DOACs superior to warfarin for stroke prevention?',
  },
  {
    label: 'Statins and dementia risk',
    title: 'Statin therapy and risk of dementia: a meta-analysis',
    question: 'Does statin use reduce the risk of dementia or cognitive decline in older adults?',
  },
];

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

function sanitizeField(s: string): string {
  return s.replace(/[`\\]/g, '').replace(/\n/g, ' ').trim();
}

function buildSyntheticQuestion(spec: PaperJobSpec): string {
  const data: Record<string, unknown> = {
    title: sanitizeField(spec.title),
    question: sanitizeField(spec.question),
    pico: {
      population: sanitizeField(spec.pico.population),
      intervention: sanitizeField(spec.pico.intervention),
      comparator: sanitizeField(spec.pico.comparator),
      outcomes: spec.pico.outcomes.map(sanitizeField).filter(Boolean),
    },
    paperType: paperTypeById(spec.paperType)?.label ?? spec.paperType,
    citationStyle: spec.citationStyle,
  };
  if (spec.effectData.length > 0) {
    data.effectData = spec.effectData.map((row) => ({
      label: sanitizeField(row.label),
      measure: row.measure,
      point: row.point,
      ciLow: row.ciLow,
      ciHigh: row.ciHigh,
      ...(row.sampleSize != null ? { sampleSize: row.sampleSize } : {}),
    }));
  }
  const json = JSON.stringify(data, null, 2);
  return `Produce a full ${spec.citationStyle}-style research paper for this structured specification:\n\n${json}\n\nRequirements: write with numbered citations, honest reporting, and source-grounded claims.`;
}

function canStepAdvance(_step: StepIndex, _spec: PaperJobSpec): boolean {
  // All fields are optional — the user can run the pipeline with any
  // level of detail and let the swarm fill gaps from retrieved evidence.
  return true;
}

export function PaperMode() {
  const [step, setStep] = useState<StepIndex>(0);
  const [spec, setSpec] = useState<PaperJobSpec>(emptySpec);
  const [isRunning, setIsRunning] = useState(false);
  const [manuscript, setManuscript] = useState<string | null>(null);
  const [manuscriptObj, setManuscriptObj] = useState<Manuscript | null>(null);
  const [modelUsed, setModelUsed] = useState<string>('');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outlineProposal, setOutlineProposal] = useState<PaperOutline | null>(null);
  const [dataset, setDataset] = useState<UploadedDatasetSummary | null>(null);
  const [previewDoc, setPreviewDoc] = useState<PreviewDocument | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const isMounted = useRef(true);
  const runAborted = useRef(false);

  useEffect(() => {
    return () => {
      isMounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // Global Escape stops a running paper pipeline
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isRunning) {
        e.preventDefault();
        stopRun();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isRunning]);

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

  const loadExample = useCallback((ex: (typeof EXAMPLE_PROMPTS)[number]) => {
    setSpec((s) => ({
      ...s,
      title: ex.title,
      question: ex.question,
    }));
  }, []);

  const attachDataset = useCallback(async (file: File) => {
    try {
      const isExcel = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');
      const summary = isExcel
        ? await summarizeDatasetXlsx(file.name, await file.arrayBuffer())
        : await summarizeDatasetText(file.name, await file.text());
      setDataset(summary);
      useToastStore.getState().show(`Dataset attached: ${summary.rows} rows`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      useToastStore.getState().show(`Dataset rejected: ${detail}`, 'error');
    }
  }, []);

  const canAdvance = useMemo(() => canStepAdvance(step, spec), [step, spec]);

  const stopRun = useCallback(() => {
    runAborted.current = true;
    abortRef.current?.abort();
    if (isMounted.current) {
      setIsRunning(false);
      setProgress('Run stopped by user');
    }
  }, []);

  const runPaper = useCallback(
    async (forceDraft = false) => {
      if (isRunning || availableModels.length === 0) return;
      setIsRunning(true);
      setManuscript(null);
      setManuscriptObj(null);
      setModelUsed('');
      setError(null);
      setOutlineProposal(null);
      setProgress('Starting…');
      runAborted.current = false;

      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      const syntheticQuestion = buildSyntheticQuestion(spec);
      const cleanQuery = syntheticQuestion;

      // Outline-first: show deterministic structure, no tokens spent
      if (!forceDraft && spec.options.outlineFirst) {
        const outline = buildPaperOutline(cleanQuery, spec.options.mini);
        if (isMounted.current) {
          setOutlineProposal(outline);
          setIsRunning(false);
          setProgress(null);
        }
        return;
      }

      const conversation: LlmMessage[] = [{ role: 'user', content: cleanQuery }];

      let activeRunId: string | null = null;
      const ensureResearchRun = () => {
        if (!activeRunId) activeRunId = runs.startRun(cleanQuery, []).id;
        return activeRunId;
      };

      const callbacks = {
        onBossPhase: (phase: string) => {
          if (!isMounted.current || runAborted.current) return;
          if (phase === 'delegating' || phase === 'synthesizing') ensureResearchRun();
          setProgress(phase);
        },
        onSpecialistStart: (agentId: string, subQuery: string) => {
          if (!isMounted.current || runAborted.current) return;
          ensureResearchRun();
          setProgress(`${agentId}: ${subQuery}`);
        },
        onSpecialistDone: () => {
          /* no-op — trace removed to avoid memory leak */
        },
        onSpecialistError: () => {
          /* no-op */
        },
        onToolCall: () => {
          /* no-op */
        },
        onToolResult: () => {
          /* no-op */
        },
        onAnswerToken: () => {
          /* streaming not used for paper pipeline */
        },
        onManuscriptSection: (heading: string) => {
          if (!isMounted.current || runAborted.current) return;
          setProgress(heading);
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
          ...(dataset ? { dataset } : {}),
          onPaperDraftComplete: (res) => {
            if (!isMounted.current || runAborted.current) return;
            const text = res.manuscript
              ? manuscriptToReadableText(res.manuscript)
              : res.answer || 'Drafting completed.';
            setManuscript(text);
            if (res.manuscript) {
              setManuscriptObj(res.manuscript);
            }
            setModelUsed(res.modelUsed);
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
                  const strength = classifyEvidenceStrength(
                    [item.title, item.snippet ?? ''].join(' '),
                    item.source,
                  );
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
          if (!isMounted.current || runAborted.current) return;
          const text = result.manuscript
            ? manuscriptToReadableText(result.manuscript)
            : result.answer || 'No response returned.';
          setManuscript(text);
          if (result.manuscript) {
            setManuscriptObj(result.manuscript);
          }
          setModelUsed(result.modelUsed);
          setProgress(null);
          setIsRunning(false);
        }
      } catch (err) {
        if (!isMounted.current) return;
        const detail = err instanceof Error ? err.message : String(err);
        setError(detail);
        setProgress(null);
        setIsRunning(false);
      }
    },
    [isRunning, availableModels, spec, dataset, runs, activeProjectId],
  );

  // ── Exports & preview ───────────────────────────────────────────

  const safeFilename = useMemo(
    () => (spec.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'paper_engine').slice(0, 60),
    [spec.title],
  );

  const buildExportable = useCallback((): import('@features/brain/export/messageExport').ExportableMessage | null => {
    if (!manuscript) return null;
    const base: import('@features/brain/export/messageExport').ExportableMessage = {
      title: spec.title || 'Paper Engine Export',
      role: 'assistant',
      content: manuscript,
      modelLabel: modelUsed,
    };
    if (manuscriptObj) {
      base.manuscript = manuscriptObj;
      base.citations = manuscriptObj.publication?.references.map((r) => r.evidence) ?? [];
    }
    return base;
  }, [manuscript, spec.title, modelUsed, manuscriptObj]);

  const openPdfPreview = useCallback(async () => {
    const msg = buildExportable();
    if (!msg) return;
    try {
      const blob = await buildMessagePdfBlob(msg);
      const doc: PreviewDocument = {
        title: msg.title,
        filename: `${safeFilename}.pdf`,
        kind: 'pdf',
        typeLabel: 'PDF',
        blob,
        copyText: manuscript ?? '',
      };
      setPreviewDoc(doc);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`PDF preview failed: ${detail}`, 'error');
    }
  }, [buildExportable, safeFilename, manuscript]);

  const exportMarkdown = useCallback(() => {
    const msg = buildExportable();
    if (!msg) return;
    const md = buildMarkdownExport(msg);
    downloadBlob(`${safeFilename}.md`, new Blob([md], { type: 'text/markdown;charset=utf-8' }));
  }, [buildExportable, safeFilename]);

  const exportPdf = useCallback(async () => {
    const msg = buildExportable();
    if (!msg) return;
    try {
      const blob = await buildMessagePdfBlob(msg);
      downloadBlob(`${safeFilename}.pdf`, blob);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`PDF export failed: ${detail}`, 'error');
    }
  }, [buildExportable, safeFilename]);

  const exportDocx = useCallback(async () => {
    const msg = buildExportable();
    if (!msg) return;
    try {
      await exportMessageDocx(msg);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Word export failed: ${detail}`, 'error');
    }
  }, [buildExportable]);

  const exportLatex = useCallback(() => {
    const msg = buildExportable();
    if (!msg) return;
    try {
      exportMessageLatex(msg);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`LaTeX export failed: ${detail}`, 'error');
    }
  }, [buildExportable]);

  const handleStepClick = useCallback(
    (target: StepIndex) => {
      if (isRunning) return;
      // Allow clicking completed steps, current step, or next step if valid
      if (target <= step) {
        setStep(target);
        return;
      }
      if (target === step + 1 && canAdvance) {
        setStep(target);
      }
    },
    [isRunning, step, canAdvance],
  );

  const handleNext = useCallback(() => {
    if (step < 5 && canAdvance) setStep((s) => (s + 1) as StepIndex);
  }, [step, canAdvance]);

  const handlePanelKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        handleNext();
      }
    },
    [handleNext],
  );

  return (
    <div className="mode paper-mode">
      <header className="paper-header">
        <h1>Paper Engine</h1>
        <p className="paper-subtitle">Structured research → evidence synthesis → publishable manuscript</p>
      </header>

      <div className="paper-stepper" role="tablist" aria-label="Paper steps">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={i === step}
            className={`paper-step${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}
            onClick={() => handleStepClick(i as StepIndex)}
            disabled={isRunning}
          >
            <span className="step-num">{i + 1}</span>
            <span className="step-label">{label}</span>
          </button>
        ))}
      </div>

      <div className="paper-body">
        {step === 0 && (
          <div className="paper-step-panel" onKeyDown={handlePanelKeyDown}>
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
            <div className="paper-examples">
              <span className="examples-label">Example prompts</span>
              <div className="example-chips">
                {EXAMPLE_PROMPTS.map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    className="example-chip"
                    onClick={() => loadExample(ex)}
                    title={`${ex.title} — ${ex.question}`}
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="paper-step-panel" onKeyDown={handlePanelKeyDown}>
            <h2>Paper type</h2>
            <div className="paper-type-grid" role="radiogroup" aria-label="Paper type">
              {PAPER_TYPES.map((pt) => (
                <button
                  key={pt.id}
                  type="button"
                  role="radio"
                  aria-checked={spec.paperType === pt.id}
                  aria-pressed={spec.paperType === pt.id}
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
          <div className="paper-step-panel" onKeyDown={handlePanelKeyDown}>
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
          <div className="paper-step-panel" onKeyDown={handlePanelKeyDown}>
            <h2>Data — effect-size rows</h2>
            {!paperTypeById(spec.paperType)?.requiresDataStep && (
              <p className="paper-hint">
                This paper type does not require structured data, but you may add rows if you have them.
              </p>
            )}
            {spec.effectData.length === 0 ? (
              <p className="paper-hint">
                Add effect-size rows (HR/OR/RR + 95% CI) so the pipeline can compute pooled estimates and
                forest plots deterministically.
              </p>
            ) : (
              <div className="paper-data-table-wrap">
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
                            min="0"
                            value={row.point}
                            onChange={(e) => updateEffectRow(i, { point: Number.parseFloat(e.target.value) || 0 })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={row.ciLow}
                            onChange={(e) => updateEffectRow(i, { ciLow: Number.parseFloat(e.target.value) || 0 })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={row.ciHigh}
                            onChange={(e) => updateEffectRow(i, { ciHigh: Number.parseFloat(e.target.value) || 0 })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            max="999999"
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
              </div>
            )}
            <button type="button" className="btn sm ghost" onClick={addEffectRow}>
              <Icon name="plus" size={13} /> Add row
            </button>

            {spec.paperType === 'original_research' && (
              <div className="paper-dataset-upload">
                <label className="paper-toggle">
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt,.xlsx,.xls"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void attachDataset(file);
                      e.target.value = '';
                    }}
                  />
                  Upload dataset (CSV/TSV/Excel) for original research
                </label>
                {dataset && (
                  <div className="paper-dataset-badge">
                    <Icon name="document" size={13} /> {dataset.filename} — {dataset.rows} rows ·{' '}
                    {dataset.columns.length} columns
                    <button type="button" className="btn sm ghost" onClick={() => setDataset(null)}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="paper-step-panel" onKeyDown={handlePanelKeyDown}>
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
              The pipeline will search PubMed, Europe PMC, OpenAlex, ClinicalTrials.gov, and other trusted
              sources.
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
              {dataset && (
                <div className="review-row">
                  <span className="review-key">Dataset</span>
                  <span className="review-val">
                    {dataset.filename} ({dataset.rows} rows)
                  </span>
                </div>
              )}
              <div className="review-row">
                <span className="review-key">Citation style</span>
                <span className="review-val">{spec.citationStyle}</span>
              </div>
            </div>

            {outlineProposal && !isRunning && (
              <div className="paper-outline-proposal">
                <h3>Proposed outline</h3>
                <div className="paper-outline-content">
                  <strong>{outlineProposal.title}</strong>
                  <ol>
                    {outlineProposal.sections.map((s) => (
                      <li key={s.heading}>
                        <strong>{s.heading}</strong> — {s.intent}
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="paper-outline-actions">
                  <button type="button" className="btn primary" onClick={() => runPaper(true)}>
                    <Icon name="send" size={14} /> Draft full paper
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setOutlineProposal(null)}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}

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
              !outlineProposal && (
                <button type="button" className="btn primary" onClick={() => runPaper()}>
                  <Icon name="send" size={14} />{' '}
                  {spec.options.outlineFirst ? 'Propose outline' : 'Run paper pipeline'}
                </button>
              )
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
        <button type="button" className="btn" disabled={step === 5 || isRunning || !canAdvance} onClick={handleNext}>
          Next
        </button>
      </div>

      {manuscript && (
        <div className="paper-output">
          <div className="paper-output-header">
            <h3>Manuscript</h3>
            <div className="paper-output-actions">
              <button type="button" className="btn sm ghost" onClick={openPdfPreview}>
                <PdfGlyph size={13} /> Preview PDF
              </button>
              <button type="button" className="btn sm ghost" onClick={exportMarkdown}>
                <Icon name="download" size={13} /> MD
              </button>
              <button type="button" className="btn sm ghost" onClick={() => void exportPdf()}>
                <Icon name="download" size={13} /> PDF
              </button>
              <button type="button" className="btn sm ghost" onClick={() => void exportDocx()}>
                <Icon name="download" size={13} /> Word
              </button>
              <button type="button" className="btn sm ghost" onClick={exportLatex}>
                <Icon name="download" size={13} /> LaTeX
              </button>
            </div>
          </div>
          <div className="paper-manuscript">
            <MarkdownText content={manuscript} />
          </div>
        </div>
      )}

      {previewDoc && (
        <DocumentPreviewWindow
          document={previewDoc}
          onClose={() => setPreviewDoc(null)}
        />
      )}
    </div>
  );
}
