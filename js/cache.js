// A small persistent key-value cache in IndexedDB, so book data survives
// app restarts (iOS often restarts installed web apps). Falls back to
// nothing (memory-only in api.js) when IndexedDB is unavailable.
// Entries: { value, freshUntil, keepUntil }. Stale entries are kept for a
// while so the app can show them when Hardcover is busy or offline.

const DB = 'bt-cache';
const STORE = 'kv';
let dbPromise = null;

function open() {
    if (!globalThis.indexedDB) return Promise.resolve(null);
    dbPromise ??= new Promise((resolve) => {
        try {
            const req = indexedDB.open(DB, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
            req.onblocked = () => resolve(null);
        } catch { resolve(null); }
    });
    return dbPromise;
}

function request(mode, fn) {
    return open().then((db) => new Promise((resolve) => {
        if (!db) return resolve(null);
        try {
            const tx = db.transaction(STORE, mode);
            const req = fn(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(req?.result ?? null);
            tx.onerror = () => resolve(null);
            tx.onabort = () => resolve(null);
        } catch { resolve(null); }
    }));
}

export const persistentCache = {
    get: (key) => request('readonly', (s) => s.get(key)),
    set: (key, entry) => request('readwrite', (s) => s.put(entry, key)),
    delete: (key) => request('readwrite', (s) => s.delete(key)),

    /** Drop entries past their keep-until date (runs once per app start). */
    async prune(now = Date.now()) {
        const db = await open();
        if (!db) return 0;
        return new Promise((resolve) => {
            let removed = 0;
            try {
                const tx = db.transaction(STORE, 'readwrite');
                const cursorReq = tx.objectStore(STORE).openCursor();
                cursorReq.onsuccess = () => {
                    const c = cursorReq.result;
                    if (!c) return;
                    if (!c.value?.keepUntil || c.value.keepUntil < now) { c.delete(); removed++; }
                    c.continue();
                };
                tx.oncomplete = () => resolve(removed);
                tx.onerror = () => resolve(removed);
            } catch { resolve(0); }
        });
    },
};
