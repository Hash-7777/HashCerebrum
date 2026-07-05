import { useCallback, useEffect, useState } from 'react';
import { APP_NAME, APP_VERSION } from '@config/constants';
import { useThemeStore, THEMES } from '@core/store/themeStore';
import { useExportSettingsStore } from '@core/store/exportSettingsStore';
import { CITATION_STYLES } from '@features/brain/export/citationStyles';
import { getOllamaHost, getPrivacyLocalOnly, setOllamaHost, setPrivacyLocalOnly } from '@core/llm/ProviderRegistry';
import { PROVIDER_DEFS, providerKeyName } from '@core/llm/modelCatalog';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';
import { useProjectStore } from '@core/store/projectStore';
import { useResearchRunStore } from '@core/store/researchRunStore';
import { useMemorySettingsStore } from '@core/store/memorySettingsStore';
import type { LlmProviderId } from '@core/llm/types';
import { platform, type CacheStats } from '@platform/index';
import { resetAllData } from '@core/store/resetData';
import { Icon, type IconName } from '@ui/icons';
import { AgentModelSettings } from './AgentModelSettings';
import { AuditModal } from './AuditModal';
import { ErrorConsole } from '@ui/errors/ErrorConsole';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type SettingsTab = 'settings' | 'apis' | 'data' | 'disclaimer' | 'dev';

const SETTINGS_TABS: { id: SettingsTab; label: string; icon: IconName }[] = [
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'apis', label: 'APIs', icon: 'database' },
  { id: 'data', label: 'Data & Privacy', icon: 'lock' },
  { id: 'disclaimer', label: 'Disclaimer', icon: 'alert' },
  { id: 'dev', label: 'Dev', icon: 'activity' },
];

// Developer bio shown in the Dev tab. Edit freely.
const DEVELOPER_NAME = 'Dr. Seif Hashish';
const DEVELOPER_BIO =
  'Developer of HashCerebrum, a private, local-first biomedical research workspace. Research ' +
  'interests span medical genetics and clinical epidemiology, including work on MICA ' +
  '(MHC class I chain-related gene A) polymorphisms and cardiovascular complications in ' +
  'type 1 diabetes.';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [keyStatus, setKeyStatus] = useState<Partial<Record<LlmProviderId, boolean>>>({});
  const [apiKeys, setApiKeys] = useState<Partial<Record<LlmProviderId, string>>>({});
  const [keyErrors, setKeyErrors] = useState<Partial<Record<LlmProviderId, string>>>({});
  const [host, setHost] = useState(getOllamaHost());
  const [localOnly, setLocalOnly] = useState(getPrivacyLocalOnly());
  const rerankEnabled = useMemorySettingsStore((s) => s.rerankEnabled);
  const toggleRerank = useMemorySettingsStore((s) => s.toggleRerank);
  const fullTextEnabled = useMemorySettingsStore((s) => s.fullTextEnabled);
  const toggleFullText = useMemorySettingsStore((s) => s.toggleFullText);
  const verifyEnabled = useMemorySettingsStore((s) => s.verifyEnabled);
  const toggleVerify = useMemorySettingsStore((s) => s.toggleVerify);
  const [saving, setSaving] = useState<LlmProviderId | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [tab, setTab] = useState<SettingsTab>('settings');
  const modelGroups = useModelCatalogStore((s) => s.groups);
  const modelStatuses = useModelCatalogStore((s) => s.statuses);
  const refreshingModels = useModelCatalogStore((s) => s.refreshing);
  const refreshAllModels = useModelCatalogStore((s) => s.refreshAll);
  const refreshProviderModels = useModelCatalogStore((s) => s.refreshProvider);
  const removeProviderModels = useModelCatalogStore((s) => s.removeProvider);
  const availableModels = modelGroups.flatMap((group) => group.models);
  const totalProjects = useProjectStore((s) => s.projects.length);
  const totalRuns = useResearchRunStore((s) => s.runs.length);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const citationStyle = useExportSettingsStore((s) => s.citationStyle);
  const setCitationStyle = useExportSettingsStore((s) => s.setCitationStyle);

  const refreshCacheStats = useCallback(async () => {
    try {
      const stats = await platform().cache.stats();
      setCacheStats(stats);
    } catch {
      setCacheStats(null);
    }
  }, []);

  useEffect(() => {
    void refreshCacheStats();
  }, [refreshCacheStats]);

  const clearCache = async (expiredOnly: boolean) => {
    setCacheBusy(true);
    try {
      if (expiredOnly) await platform().cache.clearExpired();
      else await platform().cache.clear();
      await refreshCacheStats();
    } finally {
      setCacheBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      PROVIDER_DEFS.map(async (group) => {
        if (!group.keyName) return [group.provider, false] as const;
        const value = await platform().keychain.retrieve(group.keyName);
        return [group.provider, !!value] as const;
      }),
    ).then((entries) => {
      if (!cancelled) setKeyStatus(Object.fromEntries(entries) as Partial<Record<LlmProviderId, boolean>>);
    }).catch(() => {
      // Keychain read failure is non-fatal — settings panel renders without key indicators.
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveHost = () => {
    setOllamaHost(host);
    setHost(getOllamaHost());
  };

  const toggleLocalOnly = (value: boolean) => {
    setLocalOnly(value);
    setPrivacyLocalOnly(value);
  };

  const saveKey = async (provider: LlmProviderId) => {
    const keyName = providerKeyName(provider);
    const value = apiKeys[provider]?.trim();
    if (!keyName || !value) return;
    setSaving(provider);
    setKeyErrors((current) => ({ ...current, [provider]: '' }));
    try {
      await platform().keychain.store(keyName, value);
      const verified = await platform().keychain.retrieve(keyName);
      if (verified !== value) {
        throw new Error('Keychain verification failed. The key was not readable after saving.');
      }
      setApiKeys((current) => ({ ...current, [provider]: '' }));
      setKeyStatus((current) => ({ ...current, [provider]: true }));
      const status = await refreshProviderModels(provider);
      if (status.state !== 'connected') {
        setKeyErrors((current) => ({
          ...current,
          [provider]: `Key saved, but model fetch failed: ${status.error ?? 'no compatible chat models returned'}`,
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setKeyErrors((current) => ({ ...current, [provider]: message }));
    } finally {
      setSaving(null);
    }
  };

  const deleteKey = async (provider: LlmProviderId) => {
    const keyName = providerKeyName(provider);
    if (!keyName) return;
    setSaving(provider);
    setKeyErrors((current) => ({ ...current, [provider]: '' }));
    try {
      await platform().keychain.delete(keyName);
      setKeyStatus((current) => ({ ...current, [provider]: false }));
      removeProviderModels(provider);
    } finally {
      setSaving(null);
    }
  };

  const connectedProviders = PROVIDER_DEFS.filter(
    (g) => modelStatuses[g.provider]?.state === 'connected',
  ).length;

  return (
    <aside className="settings-panel" aria-label="Settings">
      <header>
        <div>
          <p className="eyebrow">
            <Icon name="settings" size={10} /> Settings
          </p>
          <h3>{SETTINGS_TABS.find((t) => t.id === tab)?.label}</h3>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close settings">
          <Icon name="close" size={14} />
        </button>
      </header>

      <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className="settings-tab"
            data-active={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} size={12} /> {t.label}
          </button>
        ))}
      </nav>

      <div className="settings-body">
        {tab === 'settings' && (
          <>
            <section className="settings-theme" aria-label="Appearance">
              <header>
                <strong>Appearance</strong>
                <span>{THEMES.find((t) => t.id === theme)?.label}</span>
              </header>
              <div className="settings-theme-swatches">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="settings-theme-swatch"
                    data-active={theme === t.id}
                    title={t.label}
                    onClick={() => setTheme(t.id)}
                    style={{ '--swatch-color': t.swatch } as React.CSSProperties}
                  />
                ))}
              </div>
            </section>

            <section className="settings-theme" aria-label="Citation style">
              <header>
                <strong>Citation style</strong>
                <span>{CITATION_STYLES.find((s) => s.value === citationStyle)?.label}</span>
              </header>
              <div className="settings-citation-styles">
                {CITATION_STYLES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className="settings-citation-style"
                    data-active={citationStyle === s.value}
                    onClick={() => setCitationStyle(s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="field-hint">
                Applies to the reference list in every export (PDF, Word, LaTeX, Markdown, HTML).
                In-text citation numbers never change.
              </p>
            </section>

            <section className="settings-theme" aria-label="Retrieval quality">
              <header>
                <strong>Retrieval quality</strong>
                <span>{rerankEnabled ? 'Smarter' : 'Standard'}</span>
              </header>
              <label className="toggle-row">
                <input type="checkbox" checked={rerankEnabled} onChange={() => toggleRerank()} />
                <span>Smarter re-ranking — take a closer second look at the top results</span>
              </label>
              <p className="field-hint">
                After finding papers, re-reads each top result against your exact question and
                puts the most relevant ones first. Runs fully offline and only when the reranker
                model is installed; if it isn&apos;t, search works exactly as before.
              </p>
              <label className="toggle-row">
                <input type="checkbox" checked={fullTextEnabled} onChange={() => toggleFullText()} />
                <span>Read whole papers — use full text when a paper is free to read</span>
              </label>
              <p className="field-hint">
                For the top open-access papers, fetches the full article and uses the passage that
                best answers your question instead of just the abstract. Bounded so runs stay fast;
                any paper without free full text simply keeps its abstract.
              </p>
              <label className="toggle-row">
                <input type="checkbox" checked={verifyEnabled} onChange={() => toggleVerify()} />
                <span>Fact-check answers — flag sentences a source doesn&apos;t clearly support</span>
              </label>
              <p className="field-hint">
                After an answer is written, checks each cited sentence against the paper it points to
                and marks any that aren&apos;t clearly backed. Runs fully offline; it only adds a note
                and never changes the answer. Needs the fact-check model installed.
              </p>
            </section>
          </>
        )}

        {tab === 'apis' && (
          <>
            <div className="field inline">
              <label>
                <span>Ollama host</span>
                <input value={host} onChange={(event) => setHost(event.target.value)} placeholder="http://localhost:11434" />
              </label>
              <button type="button" onClick={saveHost}>
                Save
              </button>
            </div>
            <p className="field-hint">
              Run Ollama on this machine, or on another device on your network — e.g.{' '}
              <code>192.168.1.50:11434</code> or <code>ollama.local:11434</code>. The scheme is added
              automatically; only your local network is reachable, never the public internet.
              <br />
              For a LAN device, start Ollama there with <code>OLLAMA_HOST=0.0.0.0</code> and allow port{' '}
              <code>11434</code> through its firewall so this machine can reach it.
            </p>

            <div className="settings-tip">
              <span className="tip-badge">Tip</span>
              <span>Set a large Boss model for the best manuscript and evidence-synthesis results.</span>
            </div>

            <div className="settings-model-tools">
              <span>
                {refreshingModels
                  ? 'checking providers'
                  : `${availableModels.length} live model${availableModels.length === 1 ? '' : 's'} loaded`}
              </span>
              <button type="button" disabled={refreshingModels} onClick={() => void refreshAllModels()}>
                Refresh models
              </button>
            </div>

            <AgentModelSettings />

            <div className="provider-key-list">
              {PROVIDER_DEFS.filter((group) => !!group.keyName).map((group) => {
                const status = modelStatuses[group.provider];
                const hasSavedKey = keyStatus[group.provider] === true;
                const providerError = keyErrors[group.provider] || (hasSavedKey ? status?.error : '');
                const statusLabel = keyStatus[group.provider]
                  ? status?.state === 'connected'
                    ? `${status.modelCount} models`
                    : status?.state === 'checking'
                      ? 'checking'
                      : status?.state === 'unavailable'
                        ? 'no models'
                        : 'fetch failed'
                  : 'no key';
                return (
                <section key={group.provider} className="provider-key-row">
                  <header>
                    <strong>{group.label}</strong>
                    <span data-ready={keyStatus[group.provider] === true && status?.state === 'connected'}>
                      {keyStatus[group.provider] && status?.state === 'connected' ? (
                        <>
                          <Icon name="check" size={11} /> {statusLabel}
                        </>
                      ) : (
                        <>
                          <Icon name="alert" size={11} /> {statusLabel}
                        </>
                      )}
                    </span>
                  </header>
                  <div>
                    <input
                      type="password"
                      value={apiKeys[group.provider] ?? ''}
                      autoComplete="new-password"
                      spellCheck={false}
                      placeholder={`${group.label} API key`}
                      onChange={(event) => setApiKeys((current) => ({ ...current, [group.provider]: event.target.value }))}
                    />
                    <button type="button" disabled={saving === group.provider} onClick={() => saveKey(group.provider)}>
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={saving === group.provider || !keyStatus[group.provider]}
                      onClick={() => deleteKey(group.provider)}
                    >
                      Remove
                    </button>
                  </div>
                  {providerError && <p className="provider-key-error">{providerError}</p>}
                </section>
                );
              })}
            </div>
          </>
        )}

        {tab === 'data' && (
          <>
            <section className="settings-privacy" aria-label="Privacy and data locality">
              <header>
                <strong>
                  <Icon name="lock" size={12} /> Privacy &amp; data
                </strong>
                <span className="settings-privacy-pill" data-on={localOnly}>
                  {localOnly ? 'Local-only' : 'Standard'}
                </span>
              </header>
              <p>
                Local-first. Your projects, saved findings, evidence cache, audit log, and API keys stay on
                this device — no account, no cloud, no telemetry. The interface cannot make a network call;
                only the Rust core can, and only to the destinations below.
              </p>
              <ul className="settings-privacy-facts">
                <li>
                  <span>Evidence sources</span>
                  <span>PubMed · Europe PMC · OpenAlex · ClinicalTrials.gov · openFDA · RxNorm · Semantic Scholar</span>
                </li>
                <li>
                  <span>LLM provider</span>
                  <span>Only the provider you configure receives your prompts</span>
                </li>
                <li>
                  <span>Telemetry</span>
                  <span>None</span>
                </li>
              </ul>
              <label className="toggle-row">
                <input type="checkbox" checked={localOnly} onChange={(event) => toggleLocalOnly(event.target.checked)} />
                <span>Local-only mode — block cloud providers, use a local Ollama model only</span>
              </label>
              <p className="settings-privacy-note">
                {localOnly
                  ? 'Cloud providers are blocked. With a local Ollama model the app makes no external LLM calls — your prompts never leave this device.'
                  : 'A cloud provider receives your prompt (question + retrieved evidence) under its own terms. For zero external calls, enable Local-only and use Ollama.'}
              </p>
            </section>

            <section className="settings-cache" aria-label="Source cache">
              <header>
                <strong>Source cache</strong>
                <span>
                  {cacheStats
                    ? `${cacheStats.rows} rows · ${formatBytes(cacheStats.bytes)}`
                    : 'not available'}
                </span>
              </header>
              {cacheStats && cacheStats.hosts.length > 0 && (
                <ul>
                  {cacheStats.hosts.slice(0, 6).map((host) => (
                    <li key={host.host}>
                      <span>{host.host}</span>
                      <span>{host.rows}</span>
                      <span>{formatBytes(host.bytes)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="settings-cache-actions">
                <button type="button" disabled={cacheBusy} onClick={() => clearCache(true)}>
                  Clear expired
                </button>
                <button type="button" disabled={cacheBusy} onClick={() => clearCache(false)}>
                  Clear all
                </button>
              </div>
            </section>

            <section className="settings-audit" aria-label="Audit log">
              <header>
                <strong>Audit log</strong>
                <button type="button" onClick={() => setAuditOpen(true)} className="settings-audit-button">
                  <Icon name="shield" size={12} /> Open
                </button>
              </header>
              <p>Hash-chained, tamper-evident log of every guarded action, stored in plain text on this device. Verify to confirm the chain is intact.</p>
            </section>

            <section className="danger-zone" aria-label="Danger zone">
              <p className="danger-zone-title">
                <Icon name="alert" size={12} /> Danger zone
              </p>
              <div className="danger-zone-row">
                <div className="danger-zone-text">
                  <strong>Reset all data</strong>
                  <p>
                    Permanently erases every project&apos;s memory and embeddings, all chat history,
                    research runs, and the source cache. Your settings and API keys are kept. This
                    cannot be undone.
                  </p>
                </div>
                <button
                  type="button"
                  className="danger-zone-btn"
                  disabled={resetting}
                  onClick={() => {
                    const ok = window.confirm(
                      'Erase ALL saved data — every project’s memory, chats, research runs, and cache? ' +
                        'Settings and API keys are kept. This cannot be undone.',
                    );
                    if (!ok) return;
                    setResetting(true);
                    void resetAllData(); // wipes storage + cache, then reloads
                  }}
                >
                  {resetting ? 'Resetting…' : 'Reset all data'}
                </button>
              </div>
            </section>
          </>
        )}

        {tab === 'disclaimer' && (
          <section className="settings-disclaimer" aria-label="Disclaimer and terms of use">
            <header>
              <strong>
                <Icon name="alert" size={12} /> Disclaimer &amp; Terms of Use
              </strong>
            </header>
            <div className="settings-disclaimer-grid">
              <div className="settings-disclaimer-item">
                <h4>Not a Medical Device</h4>
                <p>For research and education only. Not a medical device, no FDA/EMA approval, not intended to diagnose, treat, or prevent any condition. Not for users under 18. By using this software you represent that you are of legal age and have sufficient training to evaluate its outputs. LLMs can hallucinate — always verify independently.</p>
              </div>
              <div className="settings-disclaimer-item">
                <h4>Consult a Professional</h4>
                <p>Never disregard professional medical advice or delay seeking it because of something you read or generated here. Always consult your physician, pharmacist, or qualified healthcare provider for questions about a medical condition, medication, or treatment.</p>
              </div>
              <div className="settings-disclaimer-item">
                <h4>No Warranties</h4>
                <p>Provided "as is" without warranties of any kind. As open-source software it has not undergone professional clinical validation or heavy-load testing. Authors have no obligation to provide updates, support, or bug fixes. You are responsible for your own data backups.</p>
              </div>
              <div className="settings-disclaimer-item">
                <h4>No Liability</h4>
                <p>To the fullest extent permitted by law, the authors are not liable for damages, wrong results, data-privacy issues, or data loss arising from your use. You agree to indemnify the authors from any claims arising from your use, modification, or distribution of the software.</p>
              </div>
              <div className="settings-disclaimer-item">
                <h4>Data &amp; Third Parties</h4>
                <p>HashCerebrum is software, not a HIPAA-covered entity or GDPR controller. Your data stays on your device; you are responsible for its security. Retrieved evidence comes from public databases and LLM providers — we do not control, guarantee, or endorse their accuracy. References to drugs or treatments do not constitute endorsement.</p>
              </div>
              <div className="settings-disclaimer-item">
                <h4>License</h4>
                <p>Licensed under GNU AGPL-3.0-or-later. You may use, modify, and distribute the software under those terms. You are responsible for any modifications you make. Third-party trademarks belong to their owners. Your generated manuscripts remain your intellectual property.</p>
              </div>
            </div>
            <p className="settings-disclaimer-footer">
              By using HashCerebrum, you acknowledge these terms. If you do not agree, please do not use the software.
            </p>
          </section>
        )}

        {tab === 'dev' && (
          <section className="settings-developer" aria-label="Developer">
            <header>
              <strong>
                <Icon name="shield" size={12} /> Developer
              </strong>
            </header>
            <p className="settings-developer-name">{DEVELOPER_NAME}</p>
            <p>{DEVELOPER_BIO}</p>
          </section>
        )}

        {tab === 'dev' && (
          <section className="settings-status" aria-label="System status">
            <header>
              <strong>System</strong>
              <span>{platform().env.isTauri ? `Tauri (${platform().env.platform})` : 'Browser dev'}</span>
            </header>
            <ul>
              <li>
                <span>App</span>
                <span>{APP_NAME} v{APP_VERSION}</span>
              </li>
              <li>
                <span>Platform</span>
                <span>{platform().env.isTauri ? `Tauri (${platform().env.platform})` : 'Browser dev'}</span>
              </li>
              <li>
                <span>Providers</span>
                <span>{connectedProviders} / {PROVIDER_DEFS.length} connected</span>
              </li>
              <li>
                <span>Models</span>
                <span>{availableModels.length}</span>
              </li>
              <li>
                <span>Projects</span>
                <span>{totalProjects}</span>
              </li>
              <li>
                <span>Research runs</span>
                <span>{totalRuns}</span>
              </li>
            </ul>
          </section>
        )}

        {tab === 'dev' && (
          <section className="settings-eco" aria-label="The Hash ecosystem">
            <header>
              <strong>The Hash ecosystem</strong>
              <span>Sibling apps by the same developer</span>
            </header>
            <ul>
              <li>
                <button type="button" onClick={() => void platform().openExternal('https://github.com/Hash-7777/HashCerebrum')}>
                  <span className="eco-name">HashCerebrum <em>this app</em></span>
                  <span className="eco-desc">Local-first medical-research workbench with a 3D brain interface.</span>
                </button>
              </li>
              <li>
                <button type="button" onClick={() => void platform().openExternal('https://github.com/Hash-7777/HashCortX')}>
                  <span className="eco-name">HashCortX</span>
                  <span className="eco-desc">The local-first AI workspace — eleven modes, ten providers, zero telemetry.</span>
                </button>
              </li>
              <li>
                <button type="button" onClick={() => void platform().openExternal('https://github.com/Hash-7777/HashMeterAi')}>
                  <span className="eco-name">HashMeterAi</span>
                  <span className="eco-desc">See how much AI you really use — the honest local usage meter. Reads HashCerebrum's usage log.</span>
                </button>
              </li>
            </ul>
          </section>
        )}

        {tab === 'dev' && <ErrorConsole />}
      </div>

      {auditOpen && <AuditModal onClose={() => setAuditOpen(false)} />}
    </aside>
  );
}
