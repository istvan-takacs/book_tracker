// The app's data layer. Views read from in-memory Maps and subscribe to
// changes; writes go to Firestore (with its offline cache) or, in preview
// mode, to localStorage. Collections live under users/{uid}/:
//   books/{bookKey}  authors/{authorKey}  series/{seriesKey}  meta/settings

const COLLECTIONS = ['books', 'authors', 'series'];

/** Firestore rejects `undefined`; drop it everywhere. */
export function clean(value) {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
        const out = {};
        for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = clean(v);
        return out;
    }
    return value;
}

function deepMerge(target, patch) {
    const out = { ...target };
    for (const [k, v] of Object.entries(patch)) {
        out[k] = v && typeof v === 'object' && !Array.isArray(v) && target?.[k] && typeof target[k] === 'object' && !Array.isArray(target[k]) ? deepMerge(target[k], v) : v;
    }
    return out;
}

class Store {
    constructor() {
        this.books = new Map();
        this.authors = new Map();
        this.series = new Map();
        this.settings = {};
        this.mode = null;
        this.uid = null;
        this.loaded = false;
        this.listeners = new Set();
        this.backend = null;
        this.notifyQueued = false;
        this.errorListeners = new Set();
    }

    onError(fn) { this.errorListeners.add(fn); return () => this.errorListeners.delete(fn); }

    /**
     * Firestore's write promises resolve only once the server confirms, which
     * never happens offline. Changes are already applied locally (and queued by
     * Firestore), so don't make the UI wait; just report failures.
     */
    persist(promise) {
        Promise.resolve(promise).catch((err) => {
            console.error('[store] write failed', err);
            for (const fn of this.errorListeners) fn(err);
        });
    }

    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

    notify() {
        if (this.notifyQueued) return;
        this.notifyQueued = true;
        queueMicrotask(() => { this.notifyQueued = false; for (const fn of this.listeners) fn(this); });
    }

    async attach(backend) {
        await this.backend?.detach?.();
        this.backend = backend;
        this.mode = backend.mode;
        this.uid = backend.uid;
        for (const c of COLLECTIONS) this[c] = new Map();
        this.settings = {};
        this.loaded = false;
        await backend.start({
            onCollection: (name, map) => { this[name] = map; this.notify(); },
            onSettings: (s) => { this.settings = s || {}; this.notify(); },
            onLoaded: () => { this.loaded = true; this.notify(); },
        });
    }

    get(collection, key) { return this[collection].get(key) || null; }

    /** Merge `patch` into a document (creates it if missing). Applied locally first. */
    async save(collection, key, patch) {
        const next = clean(deepMerge(this[collection].get(key) || {}, patch));
        this[collection].set(key, next);
        this.notify();
        this.persist(this.backend.write(collection, key, clean(patch)));
        return next;
    }

    /** Replace a document entirely (used by Undo). */
    async put(collection, key, doc) {
        if (doc == null) return this.remove(collection, key);
        this[collection].set(key, clean(doc));
        this.notify();
        this.persist(this.backend.replace(collection, key, clean(doc)));
    }

    async remove(collection, key) {
        this[collection].delete(key);
        this.notify();
        this.persist(this.backend.remove(collection, key));
    }

    /** ops: [{collection, key, patch}] written atomically where the backend allows. */
    async batch(ops) {
        for (const { collection, key, patch } of ops) {
            this[collection].set(key, clean(deepMerge(this[collection].get(key) || {}, patch)));
        }
        this.notify();
        this.persist(this.backend.batch(ops.map((o) => ({ ...o, patch: clean(o.patch) }))));
    }

    async saveSettings(patch) {
        this.settings = clean(deepMerge(this.settings, patch));
        this.notify();
        this.persist(this.backend.writeSettings(clean(patch)));
    }
}

export const store = new Store();

// ─── Firestore backend ──────────────────────────────────────────────
export function firestoreBackend({ db, fs, uid }) {
    const unsubs = [];
    const userDoc = (...path) => fs.doc(db, 'users', uid, ...path);
    return {
        mode: 'firebase',
        uid,
        async start({ onCollection, onSettings, onLoaded }) {
            let pending = COLLECTIONS.length + 1;
            const done = () => { if (--pending === 0) onLoaded(); };
            for (const name of COLLECTIONS) {
                let first = true;
                unsubs.push(fs.onSnapshot(fs.collection(db, 'users', uid, name), (snap) => {
                    const map = new Map();
                    snap.forEach((d) => map.set(d.id, { ...d.data(), key: d.id }));
                    onCollection(name, map);
                    if (first) { first = false; done(); }
                }, (err) => { console.error(`[store] ${name}`, err); if (first) { first = false; done(); } }));
            }
            let firstSettings = true;
            unsubs.push(fs.onSnapshot(userDoc('meta', 'settings'), (d) => {
                onSettings(d.exists() ? d.data() : {});
                if (firstSettings) { firstSettings = false; done(); }
            }, (err) => { console.error('[store] settings', err); if (firstSettings) { firstSettings = false; done(); } }));
        },
        detach() { unsubs.splice(0).forEach((u) => u()); },
        write: (c, k, patch) => fs.setDoc(userDoc(c, k), patch, { merge: true }),
        replace: (c, k, doc) => fs.setDoc(userDoc(c, k), doc),
        remove: (c, k) => fs.deleteDoc(userDoc(c, k)),
        async batch(ops) {
            for (let i = 0; i < ops.length; i += 400) {
                const b = fs.writeBatch(db);
                for (const o of ops.slice(i, i + 400)) b.set(userDoc(o.collection, o.key), o.patch, { merge: true });
                await b.commit();
            }
        },
        writeSettings: (patch) => fs.setDoc(userDoc('meta', 'settings'), patch, { merge: true }),
    };
}

// ─── Preview backend (this browser only) ─────────────────────────────
const PREVIEW_KEY = 'bt-preview-v1';

export function previewBackend() {
    let data = { books: {}, authors: {}, series: {}, settings: {} };
    try { data = { ...data, ...JSON.parse(localStorage.getItem(PREVIEW_KEY) || '{}') }; } catch { /* private mode or corrupt */ }
    const persist = () => { try { localStorage.setItem(PREVIEW_KEY, JSON.stringify(data)); } catch { /* quota or blocked */ } };
    let cb = null;
    const emit = (name) => cb.onCollection(name, new Map(Object.entries(data[name]).map(([k, v]) => [k, { ...v, key: k }])));
    return {
        mode: 'preview',
        uid: 'preview',
        async start(callbacks) {
            cb = callbacks;
            for (const c of COLLECTIONS) emit(c);
            cb.onSettings(data.settings);
            cb.onLoaded();
        },
        detach() {},
        async write(c, k, patch) { data[c][k] = deepMerge(data[c][k] || {}, patch); persist(); },
        async replace(c, k, doc) { data[c][k] = doc; persist(); },
        async remove(c, k) { delete data[c][k]; persist(); },
        async batch(ops) { for (const o of ops) data[o.collection][o.key] = deepMerge(data[o.collection][o.key] || {}, o.patch); persist(); },
        async writeSettings(patch) { data.settings = deepMerge(data.settings, patch); persist(); },
        reset() { localStorage.removeItem(PREVIEW_KEY); },
    };
}
