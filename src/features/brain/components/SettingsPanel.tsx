import { useCallback, useEffect, useState } from 'react';
import { APP_NAME, APP_VERSION } from '@config/constants';
import { useThemeStore, THEMES } from '@core/store/themeStore';
import { getOllamaHost, getPrivacyLocalOnly, setOllamaHost, setPrivacyLocalOnly } from '@core/llm/ProviderRegistry';
import { PROVIDER_DEFS, providerKeyName } from '@core/llm/modelCatalog';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';
import { useProjectStore } from '@core/store/projectStore';
import { useResearchRunStore } from '@core/store/researchRunStore';
import type { LlmProviderId } from '@core/llm/types';
import { platform, type CacheStats } from '@platform/index';
import { Icon } from '@ui/icons';
import { AgentModelSettings } from './AgentModelSettings';
import { AuditModal } from './AuditModal';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [keyStatus, setKeyStatus] = useState<Partial<Record<LlmProviderId, boolean>>>({});
  const [apiKeys, setApiKeys] = useState<Partial<Record<LlmProviderId, string>>>({});
  const [keyErrors, setKeyErrors] = useState<Partial<Record<LlmProviderId, string>>>({});
  const [host, setHost] = useState(getOllamaHost());
  const [localOnly, setLocalOnly] = useState(getPrivacyLocalOnly());
  const [saving, setSaving] = useState<LlmProviderId | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
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

  return (
    <aside className="settings-panel" aria-label="Provider settings">
      <header>
        <div>
          <p className="eyebrow">
            <Icon name="settings" size={10} /> Settings
          </p>
          <h3>Model Providers</h3>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close settings">
          <Icon name="close" size={14} />
        </button>
      </header>

      <section className="settings-status" aria-label="System status">
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
            <span>
              {PROVIDER_DEFS.filter((g) => modelStatuses[g.provider]?.state === 'connected').length} / {PROVIDER_DEFS.length} connected
            </span>
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

      <label className="toggle-row">
        <input type="checkbox" checked={localOnly} onChange={(event) => toggleLocalOnly(event.target.checked)} />
        <span>
          <Icon name="lock" size={12} /> Privacy Local Only
        </span>
      </label>

      <div className="field inline">
        <label>
          <span>Ollama host</span>
          <input value={host} onChange={(event) => setHost(event.target.value)} placeholder="http://localhost:11434" />
        </label>
        <button type="button" onClick={saveHost}>
          Save
        </button>
      </div>

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
        <p>Hash-chained log of every guarded action. Verify to confirm the chain is intact.</p>
      </section>

      <div className="provider-key-list">
        {PROVIDER_DEFS.filter((group) => !!group.keyName).map((group) => {
          const status = modelStatuses[group.provider];
          const statusLabel = keyStatus[group.provider]
            ? status?.state === 'connected'
              ? `${status.modelCount} models`
              : status?.state === 'checking'
                ? 'checking'
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
            {keyErrors[group.provider] && <p className="provider-key-error">{keyErrors[group.provider]}</p>}
          </section>
          );
        })}
      </div>

      {auditOpen && <AuditModal onClose={() => setAuditOpen(false)} />}
    </aside>
  );
}
