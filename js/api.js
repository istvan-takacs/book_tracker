// Book data sources: Hardcover (through the Worker), Google Books and Open
// Library.
//
// Hardcover allows a burst of 10 requests refilling at 1 per second, so:
//  - responses are cached in memory and in IndexedDB (survives restarts),
//    and a stale copy is used when Hardcover is busy or unreachable;
//  - every Hardcover call goes through a token bucket that mirrors the real
//    limit (synced from the Worker's x-hc-remaining header); background work
//    keeps a reserve free for what you're doing right now;
//  - search costs one request (authors and series are derived from book hits);
//  - when Hardcover can't be asked, search quietly relies on your library,
//    Google Books and Open Library, and only says so if it lasts > 2 minutes.
import { workerUrl, googleBooksKey } from '../config.js';
import { fromHardcoverHit, fromHardcoverBook, fromGoogleVolume, fromOpenLibraryEdition, fromOpenLibrarySearchDoc, authorFromHardcover } from './lib/normalize.js';
import { mergeBook, sameBook } from './lib/merge.js';
import { toIsbn13, isbn13to10 } from './lib/isbn.js';
import { createLimiter } from './lib/rateLimiter.js';
import { deriveAuthorsAndSeries } from './lib/search.js';
import { persistentCache } from './cache.js';

let getIdToken = async () => null;
export function setIdTokenProvider(fn) { getIdToken = fn; }

// ─── Source status ───────────────────────────────────────────────────
export const sourceStatus = { hardcover: workerUrl ? 'unknown' : 'unconfigured', hardcoverMessage: '', checkedAt: null };
const statusListeners = new Set();
export function onSourceStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); }
function setHardcoverStatus(state, message = '') {
    if (sourceStatus.hardcover === state && sourceStatus.hardcoverMessage === message) return;
    Object.assign(sourceStatus, { hardcover: state, hardcoverMessage: message, checkedAt: Date.now() });
    for (const fn of statusListeners) fn(sourceStatus);
}

export class SourceError extends Error {
    constructor(code, message) { super(message || code); this.code = code; }
}

// ─── Caching ────────────────────────────────────────────────────────
const MIN = 60000;
const DAY = 24 * 60 * MIN;
const KEEP_STALE = 7 * DAY;
const memory = new Map();
const inflight = new Map();
const STALE_OK = new Set(['local_limited', 'rate_limited', 'network', 'hardcover_unavailable', 'sign_in_required']);

/**
 * Fresh value from memory or IndexedDB, else `loader()`. If the loader fails
 * for a temporary reason (rate limit, offline), a stale copy is returned.
 */
async function cached(key, ttlMs, loader) {
    const now = Date.now();
    const m = memory.get(key);
    if (m && m.freshUntil > now) return m.value;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
        const stored = m || await persistentCache.get(key);
        if (stored && stored.freshUntil > Date.now()) { memory.set(key, stored); return stored.value; }
        try {
            const value = await loader();
            const entry = { value, freshUntil: Date.now() + ttlMs, keepUntil: Date.now() + Math.max(ttlMs, KEEP_STALE) };
            memory.set(key, entry);
            persistentCache.set(key, entry);
            return value;
        } catch (e) {
            if (stored && stored.keepUntil > Date.now() && STALE_OK.has(e.code)) return stored.value;
            throw e;
        }
    })();
    inflight.set(key, p);
    p.finally(() => inflight.delete(key)).catch(() => {});
    return p;
}

export function pruneCache() { return persistentCache.prune(); }

// ─── Hardcover via the Worker ───────────────────────────────────────
export const hardcoverAvailable = () => !!workerUrl && sourceStatus.hardcover !== 'unconfigured';

export const limiter = createLimiter({ capacity: 10, refillPerSecond: 1 });
let limitedSince = null;
const LIMITED_NOTICE_AFTER = 2 * MIN;

/** Quietly note a rate limit; only tell the reader if it lasts a while. */
function noteLimited(message) {
    limitedSince ??= Date.now();
    if (Date.now() - limitedSince > LIMITED_NOTICE_AFTER) setHardcoverStatus('limited', message);
}

/** Wait for a token. Interactive calls wait briefly; background calls queue. */
async function acquire(priority) {
    if (limiter.tryTake(priority)) return;
    const maxWait = priority === 'background' ? 2 * MIN : 1500;
    const deadline = Date.now() + maxWait;
    while (Date.now() < deadline) {
        await sleep(Math.min(Math.max(limiter.waitMs(priority), 200), deadline - Date.now()));
        if (limiter.tryTake(priority)) return;
    }
    noteLimited('Book data limit reached for the moment.');
    throw new SourceError('local_limited');
}

async function hc(op, variables, ttlMs = 30 * MIN, { priority = 'interactive' } = {}) {
    if (!workerUrl) throw new SourceError('hardcover_unconfigured');
    return cached(`hc:${op}:${JSON.stringify(variables)}`, ttlMs, async () => {
        const token = await getIdToken();
        if (!token) throw new SourceError('sign_in_required');
        await acquire(priority);
        let res;
        try {
            res = await fetch(`${workerUrl.replace(/\/$/, '')}/q/${op}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
                body: JSON.stringify({ variables }),
            });
        } catch {
            setHardcoverStatus(navigator.onLine === false ? 'offline' : 'down', 'Could not reach the book data service.');
            throw new SourceError('network');
        }
        // keep our bucket in step with Hardcover's own count
        const remaining = Number(res.headers.get('x-hc-remaining'));
        if (res.headers.has('x-hc-remaining') && Number.isFinite(remaining)) limiter.sync(remaining, Number(res.headers.get('x-hc-reset')) || 0);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            const why = [body.message, body.detail && `Hardcover said: ${body.detail}`].filter(Boolean).join(' ');
            if (res.status === 429) {
                limiter.block(Number(res.headers.get('retry-after')) || 30);
                noteLimited(body.message);
                throw new SourceError('rate_limited', body.message);
            }
            if (body.error === 'hardcover_token') setHardcoverStatus('token', why);
            else if (body.error === 'hardcover_forbidden') setHardcoverStatus('down', why);
            else if (res.status === 401 || res.status === 403) setHardcoverStatus('signin', body.error);
            else setHardcoverStatus('down', body.message || `Error ${res.status}`);
            throw new SourceError(body.error || `http_${res.status}`, body.message);
        }
        limitedSince = null;
        setHardcoverStatus('ok');
        return body.data;
    });
}

const hits = (data) => {
    const r = data?.search?.results;
    const obj = typeof r === 'string' ? JSON.parse(r) : r;
    return (obj?.hits || []).map((h) => h.document).filter(Boolean);
};

export async function checkHardcover() {
    if (!workerUrl) return setHardcoverStatus('unconfigured');
    try { await hc('searchBooks', { q: 'dune', n: 1 }, 5 * MIN); } catch { /* status already set */ }
}

// ─── Google Books / Open Library ────────────────────────────────────
// Google Books search fails intermittently (503 backendFailed for identical
// requests), so: retry once, and after repeated failures skip Google for a
// while and let Open Library answer. This also keeps the console quiet.
const googleBreaker = { failures: 0, until: 0 };
const GOOGLE_COOLDOWN = 10 * MIN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function googleCoolingDown() {
    return Date.now() < googleBreaker.until;
}

async function gbFetch(path, params) {
    if (googleCoolingDown()) throw new SourceError('google_cooldown');
    const p = new URLSearchParams(params);
    if (googleBooksKey) p.set('key', googleBooksKey);
    const url = `https://www.googleapis.com/books/v1/${path}?${p}`;
    let res = await fetch(url);
    if (res.status === 503) { await sleep(350); res = await fetch(url); }
    if (!res.ok) {
        if (res.status === 503 || res.status === 429) {
            googleBreaker.failures++;
            // quota errors won't clear in minutes; 503s get two strikes
            if (res.status === 429 || googleBreaker.failures >= 2) googleBreaker.until = Date.now() + GOOGLE_COOLDOWN;
        }
        throw new SourceError(`google_${res.status}`);
    }
    googleBreaker.failures = 0;
    return res.json();
}

export function googleSearch(q, n = 12) {
    return cached(`gb:q:${q}:${n}`, DAY, async () => {
        const data = await gbFetch('volumes', { q, maxResults: String(n), printType: 'books', orderBy: 'relevance' });
        return (data.items || []).map(fromGoogleVolume).filter((b) => b?.title);
    });
}

export function googleByIsbn(isbn) {
    return cached(`gb:isbn:${isbn}`, 30 * DAY, async () => {
        const data = await gbFetch('volumes', { q: `isbn:${isbn}`, maxResults: '1' });
        return data.items?.[0] ? fromGoogleVolume(data.items[0]) : null;
    });
}

export function googleVolume(id) {
    return cached(`gb:vol:${id}`, 7 * DAY, async () => {
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(id)}${googleBooksKey ? `?key=${googleBooksKey}` : ''}`);
        if (!res.ok) throw new SourceError(`google_${res.status}`);
        return fromGoogleVolume(await res.json());
    });
}

const OL_FIELDS = 'key,title,subtitle,author_name,first_publish_year,cover_i,isbn,number_of_pages_median,series_name,series_position,ratings_count';

export function openLibrarySearch(q, n = 12) {
    return cached(`ol:q:${q}:${n}`, DAY, async () => {
        const res = await fetch(`https://openlibrary.org/search.json?${new URLSearchParams({ q, limit: String(n), fields: OL_FIELDS })}`);
        if (!res.ok) throw new SourceError(`openlibrary_${res.status}`);
        return ((await res.json()).docs || []).map(fromOpenLibrarySearchDoc).filter(Boolean);
    });
}

export function openLibraryByIsbn(isbn) {
    return cached(`ol:isbn:${isbn}`, 30 * DAY, async () => {
        const res = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
        if (res.status === 404) return null;
        if (!res.ok) throw new SourceError(`openlibrary_${res.status}`);
        const edition = await res.json();
        const book = fromOpenLibraryEdition(edition, isbn);
        // editions only link to author records (sometimes only via the work); fetch the first author's name
        const getJson = (path) => fetch(`https://openlibrary.org${path}.json`).then((r) => (r.ok ? r.json() : null), () => null);
        let authorPath = edition.authors?.[0]?.key;
        if (!authorPath && /^\/works\/OL\w+$/.test(edition.works?.[0]?.key || '')) {
            const work = await getJson(edition.works[0].key);
            authorPath = work?.authors?.[0]?.author?.key;
        }
        if (book && authorPath && /^\/authors\/OL\w+$/.test(authorPath)) {
            const a = await getJson(authorPath);
            if (a?.name) book.authors = [{ id: null, name: a.name }];
        }
        return book;
    });
}

const settle = (p) => p.then((v) => v, () => null);

// ─── High-level lookups ─────────────────────────────────────────────

/**
 * Search everything. `onPartial` receives results as each source answers, so
 * the UI can show library and Google results before Hardcover returns.
 */
export async function searchAll(q, { onPartial, include = {} } = {}) {
    const result = { books: [], authors: [], series: [], hardcover: hardcoverAvailable() ? 'pending' : 'unavailable', google: 'pending' };
    const emit = () => onPartial?.({ ...result });
    const tasks = [];
    if (hardcoverAvailable()) {
        // One request: author and series cards come from the book hits. The
        // dedicated author/series searches run only for the Authors/Series chips.
        const calls = [hc('searchBooks', { q, n: 20 }, DAY)];
        if (include.authors) calls.push(hc('searchAuthors', { q, n: 8 }, DAY));
        if (include.series) calls.push(hc('searchSeries', { q, n: 8 }, DAY));
        tasks.push(Promise.allSettled(calls).then(([b, ...more]) => {
            if (b.status === 'fulfilled') {
                const books = hits(b.value).map(fromHardcoverHit).filter(Boolean).map((x) => ({ ...x, key: `hc_${x.hardcoverId}`, verified: true }));
                result.books.push(...books);
                const derived = deriveAuthorsAndSeries(books);
                result.authors.push(...derived.authors);
                result.series.push(...derived.series);
            }
            const [a, s] = [include.authors ? more.shift() : null, include.series ? more.shift() : null];
            if (a?.status === 'fulfilled') mergeCards(result.authors, hits(a.value).map((d) => ({ hardcoverId: Number(d.id), name: d.name, alternateNames: d.alternate_names || [], booksCount: d.books_count, seriesNames: d.series_names || [], topBooks: d.books || [], imageUrl: d.image?.url || null })), (x) => x.hardcoverId);
            if (s?.status === 'fulfilled') mergeCards(result.series, hits(s.value).map((d) => ({ id: Number(d.id), name: d.name, authorName: d.author_name || d.author?.name || null, authorId: d.author?.id ?? null, booksCount: d.primary_books_count || d.books_count, readersCount: d.readers_count, topBooks: d.books || [] })), (x) => x.id);
            result.hardcover = b.status === 'fulfilled' ? 'ok' : 'error';
            emit();
        }));
    }
    // Google Books first; if it is down or out of quota, Open Library search fills in.
    tasks.push(googleSearch(q).then((list) => list, async (e) => {
        result.google = e.code === 'google_429' ? 'quota' : e.code === 'google_cooldown' ? 'paused' : 'error';
        const ol = await openLibrarySearch(q).catch(() => null);
        if (ol) result.openlibrary = 'ok';
        return ol;
    }).then((list) => {
        if (list && result.google === 'pending') result.google = 'ok';
        for (const g of list || []) {
            if (!result.books.some((b) => sameBook(b, g))) result.books.push(g.googleVolumeId ? { ...mergeBook({ gb: g }), key: `gb_${g.googleVolumeId}` } : mergeBook({ ol: g }));
        }
        emit();
    }));
    await Promise.all(tasks);
    // Google results that Hardcover also returned are dropped in favour of Hardcover.
    result.books = result.books.filter((b, i, all) => b.verified || !all.some((o, j) => j !== i && o.verified && sameBook(o, b)));
    return result;
}

/** Add search cards, replacing derived ones that have the same id with the richer version. */
function mergeCards(list, extra, idOf) {
    for (const x of extra) {
        const i = list.findIndex((y) => idOf(y) && idOf(y) === idOf(x));
        if (i === -1) list.push(x); else list[i] = { ...list[i], ...x };
    }
}

/** Full details for one book, merged across sources. */
export async function bookDetails(key, known = null) {
    if (key.startsWith('hc_') && hardcoverAvailable()) {
        try {
            const data = await hc('bookById', { id: Number(key.slice(3)) }, 7 * DAY);
            const hcBook = fromHardcoverBook(data?.books?.[0]);
            if (hcBook) {
                const isbn = hcBook.isbn13 || known?.isbn13;
                const [gb, ol] = isbn ? await Promise.all([settle(googleByIsbn(isbn)), (!hcBook.coverUrl ? settle(openLibraryByIsbn(isbn)) : null)]) : [null, null];
                return mergeBook({ hc: hcBook, gb, ol });
            }
        } catch { /* fall through to what we know */ }
    }
    // Open Library / ISBN-keyed books: look up by ISBN (Hardcover first), keep the key
    const isbn = key.startsWith('isbn_') ? key.slice(5) : key.startsWith('ol_') ? known?.isbn13 : null;
    if (isbn) {
        const found = await settle(lookupIsbn(isbn));
        if (found) return { ...known, ...found, key };
    }
    if (key.startsWith('gb_')) {
        const gb = await settle(googleVolume(key.slice(3)));
        if (gb) {
            const ol = gb.isbn13 && !gb.coverUrl ? await settle(openLibraryByIsbn(gb.isbn13)) : null;
            return mergeBook({ gb, ol });
        }
    }
    return known;
}

/** Barcode or typed ISBN → merged book, or null when no source knows it. */
export async function lookupIsbn(raw) {
    const isbn = toIsbn13(raw);
    if (!isbn) throw new SourceError('invalid_isbn', 'That is not a valid book barcode or ISBN.');
    let hcBook = null;
    if (hardcoverAvailable()) {
        try {
            const data = await hc('editionByIsbn', { isbn13: isbn, isbn10: isbn13to10(isbn) || '0000000000' }, 30 * DAY);
            const ed = data?.editions?.[0];
            if (ed?.book) hcBook = { ...fromHardcoverBook(ed.book), isbn13: isbn, pageCount: ed.pages || ed.book.pages || null };
        } catch { /* offline or Hardcover down: try the others */ }
    }
    const [gb, ol] = await Promise.all([settle(googleByIsbn(isbn)), settle(openLibraryByIsbn(isbn))]);
    if (!hcBook && !gb && !ol) return null;
    const merged = mergeBook({ hc: hcBook, gb, ol });
    merged.isbn13 = merged.isbn13 || isbn;
    return merged;
}

export async function authorDetails(hardcoverId) {
    const data = await hc('authorById', { id: hardcoverId }, 3 * DAY);
    const a = data?.authors?.[0];
    if (!a) return null;
    const books = [];
    for (const c of a.contributions || []) {
        if (c.contribution && !/^author$/i.test(c.contribution)) continue;
        if (c.book?.canonical_id) continue;
        const b = fromHardcoverBook(c.book);
        if (b && !b.compilation && !books.some((x) => x.hardcoverId === b.hardcoverId)) books.push({ ...b, key: `hc_${b.hardcoverId}`, verified: true });
    }
    return { ...authorFromHardcover(a), books };
}

export async function findAuthorByName(name) {
    if (!hardcoverAvailable()) return null;
    const data = await hc('searchAuthors', { q: name, n: 3 }, 7 * DAY);
    const doc = hits(data)[0];
    return doc ? Number(doc.id) : null;
}

export async function upcomingForAuthors(ids, since, year, { priority = 'background' } = {}) {
    const data = await hc('authorBooks', { ids, since, year }, 12 * 60 * MIN, { priority });
    return (data?.books || []).map(fromHardcoverBook).filter(Boolean).map((b) => ({ ...b, key: `hc_${b.hardcoverId}`, verified: true }));
}

export async function seriesBooks(ids, { priority = 'interactive' } = {}) {
    const data = await hc('seriesBooks', { ids }, DAY, { priority });
    return (data?.series || []).map((s) => ({
        id: s.id, name: s.name, total: s.primary_books_count || s.books_count, completed: s.is_completed, author: s.author,
        books: (s.book_series || []).map((bs) => {
            const b = fromHardcoverBook(bs.book);
            return b && { ...b, key: `hc_${b.hardcoverId}`, verified: true, series: { id: s.id, name: s.name, position: bs.position } };
        }).filter(Boolean),
    }));
}

export async function booksByIds(ids, { priority = 'background' } = {}) {
    if (!ids.length || !hardcoverAvailable()) return [];
    const data = await hc('booksByIds', { ids: ids.slice(0, 30) }, DAY, { priority });
    return (data?.books || []).map(fromHardcoverBook).filter(Boolean).map((b) => ({ ...b, key: `hc_${b.hardcoverId}`, verified: true }));
}
