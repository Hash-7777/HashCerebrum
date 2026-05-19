// Brain workspace — chat-first research surface that fans queries out
// to every registered medical source, lights the corresponding brain
// regions, and asks the selected LLM to draft a cited synthesis with
// automatic failover when a cloud provider is rate-limited or 5xxs.
//
// The mode is intentionally split into small components (Composer,
// Transcript, BrainCanvas, SourceRunner, EvidenceList, BrainLegend,
// SettingsPanel) so a crash in one stays contained by FeatureBoundary
// instead of taking the workspace down.

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AgentId, RegionId } from '@config/agents';
import { AGENTS } from '@config/agents';
import { bus } from '@core/bus/EventBus';
import { completeWithModelChain, type FailoverProgress } from '@core/llm/ProviderRegistry';
import { DEFAULT_MODEL, MODEL_GROUPS } from '@core/llm/modelCatalog';
import { classify } from '@core/topic/MeshClassifier';
import { tools } from '@core/tools/ToolRegistry';
import type { EvidenceItem, MedicalSourceResult } from '@platform/index';
import { FeatureBoundary } from '@ui/errors/FeatureBoundary';
import { Icon } from '@ui/icons';

import { BrainCanvas } from './components/BrainCanvas';
import { BrainLegend } from './components/BrainLegend';
import { Composer } from './components/Composer';
import { EvidenceList } from './components/EvidenceList';
import { SettingsPanel } from './components/SettingsPanel';
import { INITIAL_SOURCES, SourceRunner, type SourceStatus } from './components/SourceRunner';
import { Transcript, type ChatMessage } from './components/Transcript';
import { BRAIN_MODEL, partForRegion } from './data/modelParts';
import { regionById } from './data/regions';
import { useLitRegions } from './useLitRegions';

const SOURCE_AGENT_LABEL = Object.fromEntries(AGENTS.map((agent) => [agent.id, agent.label])) as Record<AgentId, string>;

function summarizeEvidence(items: EvidenceItem[]) {
  if (items.length === 0) {
    return 'No source records returned. Try a narrower biomedical query or run inside the Tauri app for live guarded fetching.';
  }
  return items
    .slice(0, 8)
    .map((item, index) => {
      const year = item.year ? ` (${item.year})` : '';
      const snippet = item.snippet ? ` ${item.snippet}` : '';
      return `[S${index + 1}] ${item.source.toUpperCase()}${year}: ${item.title}.${snippet}`;
    })
    .join('\n');
}

function fallbackAnswer(query: string, evidence: EvidenceItem[], reason: string) {
  return [
    `Source records are ready for "${query}", but the model could not draft the synthesis: ${reason}`,
    '',
    'Evidence snapshot:',
    summarizeEvidence(evidence),
    '',
    'Use this as source triage, not medical advice. Pick an available Ollama model or add a provider key in Settings.',
  ].join('\n');
}

function isResearchQuery(value: string) {
  const compact = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (compact.length < 3) return false;
  return !new Set(['hi', 'hello', 'hey', 'yo', 'test', 'thanks', 'thank you']).has(compact);
}

function sourceArgs(source: SourceStatus, query: string) {
  if (source.id === 'openfda') return { endpoint: 'drug/event', query, maxResults: 5 };
  if (source.id === 'rxnorm') return { drug: query };
  return { query, maxResults: 5 };
}

function dedupeEvidence(items: EvidenceItem[]) {
  const seen = new Set<string>();
  return items.filter((item, index) => {
    const key = item.url || item.identifiers.pmid || item.identifiers.doi || item.provenanceHash || `${item.source}-${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function labelForModel(modelValue: string): string {
  for (const group of MODEL_GROUPS) {
    const option = group.models.find((m) => m.value === modelValue);
    if (option) return option.label;
  }
  return modelValue;
}

function shortLabelForModel(modelValue: string): string {
  for (const group of MODEL_GROUPS) {
    const option = group.models.find((m) => m.value === modelValue);
    if (option) return option.shortLabel;
  }
  return modelValue;
}

export function BrainMode() {
  const [selectedRegion, setSelectedRegion] = useState<RegionId | null>(null);
  const [hoveredRegion, setHoveredRegion] = useState<RegionId | null>(null);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'system',
      content:
        'Ask a biomedical research question. HashCerebrum will query guarded medical sources, light the linked brain meshes, and draft a cited synthesis.',
    },
  ]);
  const [sourceStatuses, setSourceStatuses] = useState<SourceStatus[]>(INITIAL_SOURCES);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const regions = useLitRegions();
  const canSubmit = isResearchQuery(query);
  const modelLabel = useMemo(() => labelForModel(selectedModel), [selectedModel]);

  // Clicking the same region twice clears the selection.
  const toggleRegion = (region: RegionId | null) => {
    setSelectedRegion((current) => (current === region ? null : region));
  };

  // Cmd+, / Ctrl+, opens settings — matches HashCortx muscle memory.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        setSettingsOpen((open) => !open);
      } else if (event.key === 'Escape' && settingsOpen) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen]);

  const updateSource = (id: SourceStatus['id'], update: Partial<SourceStatus>) => {
    setSourceStatuses((current) => current.map((source) => (source.id === id ? { ...source, ...update } : source)));
  };

  const runSource = async (source: SourceStatus, cleanQuery: string) => {
    const tool = tools.get(source.tool);
    if (!tool) throw new Error(`Tool not registered: ${source.tool}`);
    updateSource(source.id, { state: 'running', count: 0, detail: SOURCE_AGENT_LABEL[source.agentId] });
    bus.emit('agent:activity', { agentId: source.agentId, phase: 'tool_call', detail: source.label });
    bus.emit('region:light', {
      region: source.region,
      source: 'agent',
      agentId: source.agentId,
      intensity: 0.75,
      ttlMs: 9000,
    });
    try {
      const result = (await tool.execute(sourceArgs(source, cleanQuery))) as MedicalSourceResult;
      updateSource(source.id, { state: 'done', count: result.results.length, detail: `${result.results.length} records` });
      bus.emit('agent:activity', {
        agentId: source.agentId,
        phase: 'tool_result',
        detail: `${source.label}: ${result.results.length}`,
      });
      return result.results;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      updateSource(source.id, { state: 'error', count: 0, detail });
      bus.emit('agent:activity', { agentId: source.agentId, phase: 'error', detail: source.label });
      return [];
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery || isRunning) return;

    setQuery('');
    setSourceStatuses(INITIAL_SOURCES.map((source) => ({ ...source, state: 'idle', count: 0 })));
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', content: cleanQuery }]);

    if (!isResearchQuery(cleanQuery)) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            'I only run the medical-source pipeline for a real biomedical research question. Try a disease, drug, trial, biomarker, or safety signal.',
        },
      ]);
      return;
    }

    setIsRunning(true);
    bus.emit('agent:activity', { agentId: 'synthesizer', phase: 'start', detail: 'brain research turn' });
    bus.emit('region:light', {
      region: 'parietal',
      source: 'agent',
      agentId: 'synthesizer',
      intensity: 0.8,
      ttlMs: 9000,
    });

    const sourceResults = await Promise.all(INITIAL_SOURCES.map((source) => runSource(source, cleanQuery)));
    const nextEvidence = dedupeEvidence(sourceResults.flat());
    setEvidence(nextEvidence);

    const evidenceContext = summarizeEvidence(nextEvidence);
    const prompt = [
      `Research question: ${cleanQuery}`,
      '',
      'Evidence records:',
      evidenceContext,
      '',
      'Write a concise research answer. Use bracket citations like [S1] and include uncertainty when records are weak or absent.',
    ].join('\n');

    const failoverNotes: string[] = [];
    const onProgress = (progress: FailoverProgress) => {
      const note = `Failover ${progress.attempt}: ${shortLabelForModel(progress.from)} → ${progress.to.shortLabel}`;
      failoverNotes.push(note);
      bus.emit('agent:activity', {
        agentId: 'synthesizer',
        phase: 'tool_call',
        detail: note,
      });
    };

    try {
      const response = await completeWithModelChain(
        selectedModel,
        {
          temperature: 0.2,
          maxTokens: 1400,
          messages: [
            {
              role: 'system',
              content:
                'You are HashCerebrum Brain Research. Use only the provided source records for factual claims. Do not provide personal medical advice. Cite claims with [S#].',
            },
            { role: 'user', content: prompt },
          ],
        },
        onProgress,
      );
      for (const hit of classify(response.content)) {
        bus.emit('topic:detected', hit);
        bus.emit('region:light', { region: hit.region, source: 'topic', intensity: hit.confidence * 0.55, ttlMs: 9000 });
      }
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.content || summarizeEvidence(nextEvidence),
          citations: nextEvidence.slice(0, 12),
          modelLabel: labelForModel(response.modelUsed),
          ...(failoverNotes.length > 0 ? { failoverNote: failoverNotes[failoverNotes.length - 1] } : {}),
        },
      ]);
      bus.emit('agent:activity', { agentId: 'synthesizer', phase: 'done', detail: labelForModel(response.modelUsed) });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: fallbackAnswer(cleanQuery, nextEvidence, detail),
          citations: nextEvidence.slice(0, 12),
          error: detail,
        },
      ]);
      bus.emit('agent:activity', { agentId: 'synthesizer', phase: 'error', detail });
    } finally {
      setIsRunning(false);
    }
  };

  const selectedPart = selectedRegion ? partForRegion(selectedRegion) : null;
  const focusEvidence = selectedRegion
    ? evidence.filter((item) => {
        const match = sourceStatuses.find((s) => s.id === item.source);
        return match?.region === selectedRegion;
      })
    : evidence;

  return (
    <div className="mode brain-mode brain-workspace">
      <section className="research-chat" aria-label="Brain research chat">
        <header className="workspace-toolbar">
          <div>
            <p className="eyebrow">
              <Icon name="brain" size={10} /> Brain Research
            </p>
            <h1>Chat-first workspace</h1>
          </div>
          <div className="toolbar-actions">
            <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} aria-label="Model">
              {MODEL_GROUPS.map((group) => (
                <optgroup key={group.provider} label={group.label}>
                  {group.models.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.shortLabel}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button type="button" onClick={() => setSettingsOpen(true)} className="toolbar-icon-button" aria-label="Settings">
              <Icon name="settings" size={14} />
            </button>
          </div>
        </header>

        <FeatureBoundary name="Transcript">
          <Transcript messages={messages} modelLabel={modelLabel} isRunning={isRunning} />
        </FeatureBoundary>

        <FeatureBoundary name="Composer">
          <Composer
            query={query}
            setQuery={setQuery}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            isRunning={isRunning}
            canSubmit={canSubmit}
            onSubmit={submit}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </FeatureBoundary>
      </section>

      <section className="brain-side">
        <FeatureBoundary name="Brain canvas" resetKey={BRAIN_MODEL.path}>
          <div className="brain-model-panel">
            <div className="brain-stage">
              <BrainCanvas
                selectedRegion={selectedRegion}
                hoveredRegion={hoveredRegion}
                onSelectRegion={toggleRegion}
                onHoverRegion={setHoveredRegion}
              />
              <section className="brain-hero">
                <p className="eyebrow">
                  <Icon name="brain" size={10} /> Mesh-linked atlas
                </p>
                <h2>{selectedPart ? selectedPart.label : 'Click a region to focus'}</h2>
                <p className="model-line">
                  {selectedPart
                    ? `Linked to ${selectedPart.regionIds.map((region) => regionById(region).label).join(', ')}.`
                    : 'Hover for region info. Selecting a region filters evidence cards.'}
                </p>
                <p className="brain-credit">
                  {BRAIN_MODEL.source} · {BRAIN_MODEL.license}
                </p>
              </section>
            </div>
          </div>
        </FeatureBoundary>

        <div className="source-panel">
          <FeatureBoundary name="Sources">
            <SourceRunner statuses={sourceStatuses} evidenceCount={evidence.length} onSelectRegion={toggleRegion} />
          </FeatureBoundary>
          <FeatureBoundary name="Region legend">
            <BrainLegend regions={regions} selectedRegion={selectedRegion} onSelectRegion={toggleRegion} />
          </FeatureBoundary>
          <FeatureBoundary name="Evidence">
            <EvidenceList items={focusEvidence} />
          </FeatureBoundary>
        </div>
      </section>

      {settingsOpen && (
        <FeatureBoundary name="Settings">
          <SettingsPanel
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            onClose={() => setSettingsOpen(false)}
          />
        </FeatureBoundary>
      )}
    </div>
  );
}
