import { useEffect, useMemo, useState } from 'react';
import { APP_NAME } from '@config/constants';
import { filterNotices, packageCount, parseNoticeDocument } from '@core/licenses/noticeDocument';
import { platform, type LicenseDocumentId } from '@platform/index';
import { Icon } from '@ui/icons';

// The Licenses tab: the attribution bundle a release carries, readable in the
// app instead of only inside the application folder.
//
// Each document is fetched once, on the first view that needs it, and kept for
// the session. The notices document is about a megabyte, so it is never drawn
// whole: it is listed one row per notice and a notice's text appears only when
// the reader opens that row. The text is rendered as plain text, never as
// markup — it is other people's copyright text, not app content.

const DOCUMENTS: { id: LicenseDocumentId; label: string }[] = [
  { id: 'notices', label: 'Notices' },
  { id: 'inventory', label: 'Dependency list' },
  { id: 'project', label: "This app's licence" },
];

export function LicensesPanel() {
  const [document, setDocument] = useState<LicenseDocumentId>('notices');
  const [text, setText] = useState<Partial<Record<LicenseDocumentId, string>>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openNotice, setOpenNotice] = useState<string | null>(null);

  const loaded = text[document];

  useEffect(() => {
    if (loaded !== undefined) return;
    let cancelled = false;
    setFailed(null);
    platform()
      .licenses.read(document)
      .then((content) => {
        if (!cancelled) setText((all) => ({ ...all, [document]: content }));
      })
      .catch((err: unknown) => {
        if (!cancelled) setFailed(err instanceof Error ? err.message : 'Could not read that document.');
      });
    return () => {
      cancelled = true;
    };
  }, [document, loaded]);

  const parsed = useMemo(
    () => parseNoticeDocument(text.notices ?? ''),
    [text.notices],
  );
  const shown = useMemo(() => filterNotices(parsed.notices, query), [parsed.notices, query]);

  return (
    <section className="settings-licenses" aria-label="Licenses">
      <header>
        <strong>
          <Icon name="book" size={12} /> Credits and licenses
        </strong>
        <span>AGPL-3.0-or-later</span>
      </header>

      <p>
        {APP_NAME} is free software under the GNU AGPL-3.0-or-later. It is built on work by many
        other people, and their copyright and permission notices are carried here, word for word,
        exactly as they published them.
      </p>

      <div className="licenses-switch" role="group" aria-label="Licence documents">
        {DOCUMENTS.map((doc) => (
          <button
            key={doc.id}
            type="button"
            data-active={document === doc.id}
            aria-pressed={document === doc.id}
            onClick={() => setDocument(doc.id)}
          >
            {doc.label}
          </button>
        ))}
      </div>

      {failed ? (
        <p className="licenses-empty" role="status">
          {failed}
        </p>
      ) : loaded === undefined ? (
        <p className="licenses-empty" role="status">
          Reading…
        </p>
      ) : document !== 'notices' ? (
        <pre className="licenses-text">{loaded}</pre>
      ) : (
        <>
          <label className="licenses-search">
            <Icon name="search" size={13} />
            <input
              placeholder="Search by package, version or licence file…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search the notices"
            />
          </label>

          <p className="licenses-count" role="status">
            {query.trim() ? (
              <>
                <b>{shown.length}</b> of {parsed.notices.length} notices
              </>
            ) : (
              <>
                <b>{parsed.notices.length}</b> notices covering {packageCount(parsed.notices)} packages
              </>
            )}
          </p>

          {shown.length === 0 ? (
            <p className="licenses-empty" role="status">
              No notice matches that search.
            </p>
          ) : (
            <ul className="licenses-list">
              {shown.map((notice) => {
                const open = openNotice === notice.id;
                // A vendored asset is named by its own path, so its file name
                // would just be the same text twice on one row.
                const files = notice.files.filter(
                  (file) => !notice.packages.some((name) => name.endsWith(file)),
                );
                return (
                  <li key={notice.id}>
                    <button
                      type="button"
                      className="licenses-notice-head"
                      aria-expanded={open}
                      onClick={() => setOpenNotice(open ? null : notice.id)}
                    >
                      <Icon name={open ? 'minus' : 'plus'} size={12} />
                      <span className="licenses-notice-packages">{notice.packages.join(', ')}</span>
                      <span className="licenses-notice-files">{files.join(', ')}</span>
                    </button>
                    {open && <pre className="licenses-text">{notice.text}</pre>}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
