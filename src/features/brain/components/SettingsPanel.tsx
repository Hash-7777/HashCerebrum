import { useCallback, useEffect, useState } from 'react';
import { getOllamaHost, getPrivacyLocalOnly, setOllamaHost, setPrivacyLocalOnly } from '@core/llm/ProviderRegistry';
import { DEFAULT_MODEL, MODEL_GROUPS, parseModelRef, providerKeyName } from '@core/llm/modelCatalog';
import type { LlmProviderId } from '@core/llm/types';
import { platform, type CacheStats } from '@platform/index';
import { Icon } from '@ui/icons';
import { AuditModal } from './AuditModal';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function SettingsPanel({
  selectedModel,
  setSelectedModel,
  onClose,
}: {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  onClose: () => void;
}) {
  const [keyStatus, setKeyStatus] = useState<Partial<Record<LlmProviderId, boolean>>>({});
  const [apiKeys, setApiKeys] = useState<Partial<Record<LlmProviderId, string>>>({});
  const [host, setHost] = useState(getOllamaHost());
  const [localOnly, setLocalOnly] = useState(getPrivacyLocalOnly());
  const [saving, setSaving] = useState<LlmProviderId | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

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
      MODEL_GROUPS.map(async (group) => {
        const keyName = providerKeyName(group.provider);
        if (!keyName) return [group.provider, false] as const;
        const value = await platform().keychain.retrieve(keyName);
        return [group.provider, !!value] as const;
      }),
    ).then((entries) => {
      if (!cancelled) setKeyStatus(Object.fromEntries(entries) as Partial<Record<LlmProviderId, boolean>>);
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
    if (value && parseModelRef(selectedModel).kind === 'cloud') {
      setSelectedModel(DEFAULT_MODEL);
    }
  };

  const saveKey = async (provider: LlmProviderId) => {
    const keyName = providerKeyName(provider);
    const value = apiKeys[provider]?.trim();
    if (!keyName || !value) return;
    setSaving(provider);
    try {
      await platform().keychain.store(keyName, value);
      setApiKeys((current) => ({ ...current, [provider]: '' }));
      setKeyStatus((current) => ({ ...current, [provider]: true }));
    } finally {
      setSaving(null);
    }
  };

  const deleteKey = async (provider: LlmProviderId) => {
    const keyName = providerKeyName(provider);
    if (!keyName) return;
    setSaving(provider);
    try {
      await platform().keychain.delete(keyName);
      setKeyStatus((current) => ({ ...current, [provider]: false }));
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

      <label className="field">
        <span>Active model</span>
        <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
          {MODEL_GROUPS.map((group) => (
            <optgroup key={group.provider} label={group.label}>
              {group.models.map((model) => {
                const disabled = localOnly && parseModelRef(model.value).kind === 'cloud';
                return (
                  <option key={model.value} value={model.value} disabled={disabled}>
                    {model.label}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>
      </label>

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
        {MODEL_GROUPS.filter((group) => !!group.keyName).map((group) => (
          <section key={group.provider} className="provider-key-row">
            <header>
              <strong>{group.label}</strong>
              <span data-ready={keyStatus[group.provider] === true}>
                {keyStatus[group.provider] ? (
                  <>
                    <Icon name="check" size={11} /> key saved
                  </>
                ) : (
                  <>
                    <Icon name="alert" size={11} /> no key
                  </>
                )}
              </span>
            </header>
            <div>
              <input
                type="password"
                value={apiKeys[group.provider] ?? ''}
                autoComplete="off"
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
          </section>
        ))}
      </div>

      {auditOpen && <AuditModal onClose={() => setAuditOpen(false)} />}
    </aside>
  );
}
