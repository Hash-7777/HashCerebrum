// Durable storage for uploaded / generated peer-review PDFs.
//
// The session-only object URL (blobUrl) on a ReviewedPaper dies when the app is
// closed, so after a restart the preview fell back to extracted text — "messy,
// without the usual shape". We keep the raw PDF bytes in IndexedDB (which holds
// binary efficiently and persists across restarts in WKWebView and the browser)
// keyed by paper id, and the preview rebuilds a fresh blob URL from them. Bytes
// are written once per paper, never on edits, so document editing stays fast.
//
// All operations are best-effort: if IndexedDB is unavailable the preview simply
// falls back to the extracted-text view as before.

const DB_NAME = 'hc-peerreview';
const STORE = 'pdfs';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  }).catch((err) => {
    dbPromise = null; // allow a later retry
    throw err;
  });
  return dbPromise;
}

/** Persist a PDF's bytes for a paper. Best-effort; failures are swallowed. */
export async function savePdf(id: string, blob: Blob): Promise<void> {
  try {
    const buffer = await blob.arrayBuffer();
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(buffer, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* preview will fall back to extracted text */
  }
}

/** Load a paper's PDF as a fresh Blob, or null if not stored. */
export async function loadPdf(id: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const buffer = await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined);
      req.onerror = () => reject(req.error);
    });
    return buffer ? new Blob([buffer], { type: 'application/pdf' }) : null;
  } catch {
    return null;
  }
}

/** Remove a paper's stored PDF. Best-effort. */
export async function deletePdf(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* best-effort */
  }
}
