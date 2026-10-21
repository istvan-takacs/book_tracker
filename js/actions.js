// Everything the reader can do, in one place. Each action updates the store
// and, where it changes something they might regret, offers Undo.

import { store } from './store.js';
import { toast } from './ui.js';
import { todayIso } from './lib/dates.js';
import { normalize } from './lib/text.js';
import { resolveFollow } from './lib/follow.js';
import { importGoodreads as parseGoodreads } from './lib/goodreads.js';
import { sameBook } from './lib/merge.js';
import { isFinished } from './lib/stats.js';
import { lookupIsbn, searchAll } from './api.js';

export const SHELF_LABELS = { want: 'TBR', reading: 'Reading', read: 'Read', dnf: 'DNF', upcoming: 'Upcoming' };

const META_FIELDS = ['hardcoverId', 'googleVolumeId', 'slug', 'isbn13', 'title', 'subtitle', 'authors', 'series', 'releaseDate', 'datePrecision',
    'coverUrl', 'description', 'pageCount', 'audioSeconds', 'narrator', 'publisher', 'firstPublished', 'genres', 'communityMoods',
    'contentWarnings', 'rating', 'ratingsCount', 'readersCount', 'verified', 'sources', 'similarIds', 'editions', 'manual'];

/** Book metadata worth keeping in Firestore; `rating` from sources is stored as communityRating. */
export function metaOf(meta) {
    const out = {};
    for (const f of META_FIELDS) if (meta?.[f] !== undefined && meta[f] !== null) out[f] = meta[f];
    if ('rating' in out) { out.communityRating = out.rating; delete out.rating; }
    if (out.editions) out.editions = out.editions.slice(0, 10);
    return out;
}

export const authorKey = (a) => (a?.id ? `hc_${a.id}` : `name_${normalize(a?.name).replace(/ /g, '-')}`);
export const seriesKey = (s) => (s?.id ? `hc_${s.id}` : s?.name ? `name_${normalize(s.name).replace(/ /g, '-')}` : null);

function snapshot(key) {
    const b = store.get('books', key);
    return b ? structuredClone(b) : null;
}

function undoTo(key, before) {
    return () => store.put('books', key, before);
}

/** Add or move a book to a shelf. */
export async function setShelf(meta, status, { quiet = false } = {}) {
    const key = meta.key;
    const before = snapshot(key);
    const now = new Date().toISOString();
    const patch = { ...(before ? {} : metaOf(meta)), status, addedAt: before?.addedAt || now, updatedAt: now };
    if (status === 'reading') {
        const reads = [...(before?.reads || [])];
        const last = reads[reads.length - 1];
        if (!last || isFinished(last) || last.abandonedAt) reads.push({ startedAt: todayIso(), finishedAt: null, rating: null, formats: [store.settings.defaultFormat || 'print'] });
        patch.reads = reads;
        patch.progress = before?.status === 'reading' ? before.progress : { fraction: 0, mode: before?.progress?.mode || null, updatedAt: now };
    }
    if (status === 'dnf') {
        const reads = [...(before?.reads || [])];
        const last = reads[reads.length - 1];
        if (last && !isFinished(last)) reads[reads.length - 1] = { ...last, abandonedAt: todayIso(), stoppedAt: before?.progress?.fraction ?? null };
        patch.reads = reads;
    }
    await store.save('books', key, patch);
    if (!quiet) toast(`${before ? 'Moved' : 'Added'} ${meta.title} to ${SHELF_LABELS[status]}`, { undo: undoTo(key, before) });
}

export async function removeBook(key) {
    const before = snapshot(key);
    if (!before) return;
    await store.remove('books', key);
    toast(`Removed ${before.title} from your library`, { undo: () => store.put('books', key, before) });
}

export async function updateProgress(key, fraction, mode) {
    await store.save('books', key, { progress: { fraction, mode, updatedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() });
}

export async function startReread(meta) {
    const before = snapshot(meta.key);
    const reads = [...(before?.reads || []), { startedAt: todayIso(), finishedAt: null, rating: null, formats: [store.settings.defaultFormat || 'print'], reread: true }];
    await store.save('books', meta.key, { ...(before ? {} : metaOf(meta)), status: 'reading', reads, progress: { fraction: 0, mode: before?.progress?.mode || null, updatedAt: new Date().toISOString() } });
    toast(`Started a re-read of ${meta.title}`, { undo: undoTo(meta.key, before) });
}

/**
 * Finish (or re-rate) a read. `followAuthor` / `followSeries` are the reader's
 * explicit choices (true/false) or null for the rating-based default.
 */
export async function finishBook(meta, { rating, startedAt, finishedAt, formats, scales, moods, review, followAuthor = null, followSeries = null, readIndex = null }) {
    const key = meta.key;
    const before = snapshot(key);
    const reads = [...(before?.reads || [])];
    const entry = { startedAt: startedAt || null, finishedAt: finishedAt || null, rating, formats: formats?.length ? formats : ['print'], scales: scales || {}, moods: moods || [] };
    let idx = readIndex ?? reads.findIndex((r) => !isFinished(r) && !r.abandonedAt);
    // editing a read marked 'read in 2019' / 'date unknown' keeps that unless a date is given
    const prev = idx >= 0 && idx != null ? reads[idx] : null;
    if (!entry.finishedAt && !(prev && (prev.finishedYear || prev.dateUnknown))) entry.finishedAt = todayIso();
    if (entry.finishedAt) Object.assign(entry, { finishedYear: null, dateUnknown: false });
    if (idx === -1 || idx == null) { reads.push(entry); idx = reads.length - 1; }
    else reads[idx] = { ...reads[idx], ...entry, startedAt: entry.startedAt || reads[idx].startedAt };
    const latest = [...reads].reverse().find((r) => isFinished(r));
    await store.save('books', key, {
        ...(before ? {} : metaOf(meta)),
        status: 'read', reads, rating: latest?.rating ?? rating,
        review: review ?? before?.review ?? null,
        progress: { fraction: 1, mode: before?.progress?.mode || null, updatedAt: new Date().toISOString() },
        updatedAt: new Date().toISOString(),
    });

    const followed = [];
    const undoFollows = [];
    const authors = (meta.authors || before?.authors || []).slice(0, 2);
    if (resolveFollow(rating, followAuthor)) {
        for (const a of authors) {
            const k = authorKey(a);
            if (store.get('authors', k)?.followed) continue;
            const prev = store.get('authors', k);
            await followAuthorAction(a, { quiet: true, via: key });
            followed.push(a.name);
            undoFollows.push(() => store.put('authors', k, prev));
        }
    }
    const series = meta.series || before?.series;
    const sKey = seriesKey(series);
    if (sKey) {
        const existing = store.get('series', sKey);
        const prevSeries = existing ? structuredClone(existing) : null;
        undoFollows.push(() => store.put('series', sKey, prevSeries));
        const maxPositionRead = Math.max(existing?.maxPositionRead || 0, series.position || 0);
        const follow = resolveFollow(rating, followSeries);
        if (follow || existing) {
            await store.save('series', sKey, { id: series.id || null, name: series.name, authorNames: authors.map((a) => a.name), followed: follow ? true : !!existing?.followed, maxPositionRead, followedVia: existing?.followedVia || key });
            if (follow && !existing?.followed) followed.push(series.name);
        }
    }
    const tail = followed.length ? ` · now following ${followed.join(' and ')}` : '';
    toast(`Rated ${meta.title} ${rating} out of 10${tail}`, { undo: async () => { await undoTo(key, before)(); for (const u of undoFollows) await u(); } });
}

export async function followAuthorAction(author, { quiet = false, via = null } = {}) {
    const key = authorKey(author);
    const existing = store.get('authors', key);
    if (existing?.followed) return;
    await store.save('authors', key, { hardcoverId: author.id || null, name: author.name, followed: true, followedVia: via || existing?.followedVia || null, followedAt: new Date().toISOString() });
    if (!quiet) toast(`Following ${author.name}. Their new books will show in Upcoming.`, { undo: () => store.save('authors', key, { followed: false }) });
}

export async function unfollowAuthor(author) {
    const key = authorKey(author);
    await store.save('authors', key, { hardcoverId: author.id || null, name: author.name, followed: false });
    toast(`Stopped following ${author.name}`, { undo: () => store.save('authors', key, { followed: true }) });
}

export async function setSeriesFollow(series, followed) {
    const key = seriesKey(series);
    if (!key) return;
    await store.save('series', key, { id: series.id || null, name: series.name, followed });
    toast(followed ? `Following ${series.name}` : `Stopped following ${series.name}`, { undo: () => store.save('series', key, { followed: !followed }) });
}

export async function setReleaseDate(meta, { date, sourceUrl = null, note = null }) {
    const before = snapshot(meta.key);
    await store.save('books', meta.key, {
        ...(before ? {} : { ...metaOf(meta), status: 'upcoming', addedAt: new Date().toISOString() }),
        releaseDateOverride: { date, sourceUrl, note, setAt: new Date().toISOString() },
    });
    toast(`Release date set for ${meta.title}`, { undo: undoTo(meta.key, before) });
}

export async function clearReleaseOverride(key) {
    const b = store.get('books', key);
    if (!b) return;
    const { releaseDateOverride, ...rest } = b;
    await store.put('books', key, rest);
}

export async function addManualBook({ title, author, seriesName, position, date, status = 'want' }) {
    const key = `manual_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const meta = {
        key, title, manual: true, verified: false,
        authors: author ? [{ id: null, name: author }] : [],
        series: seriesName ? { id: null, name: seriesName, position: position ? Number(position) : null } : null,
        releaseDate: date || null, datePrecision: date ? 'day' : 'none',
    };
    await store.save('books', key, { ...metaOf(meta), status, addedAt: new Date().toISOString() });
    toast(`Added ${title}`, { undo: () => store.remove('books', key) });
    return key;
}

export async function setGoal(year, goal) {
    await store.saveSettings({ goals: { [year]: goal || null } });
}

export async function saveMoodsVocabulary(mood) {
    const list = store.settings.customMoods || [];
    if (!list.includes(mood)) await store.saveSettings({ customMoods: [...list, mood] });
}

// ─── Goodreads import ───────────────────────────────────────────────

async function pool(items, size, fn, onEach) {
    let i = 0, done = 0;
    const workers = Array.from({ length: size }, async () => {
        while (i < items.length) {
            const idx = i++;
            try { await fn(items[idx], idx); } catch (e) { console.warn('[import]', items[idx]?.title, e); }
            onEach?.(++done, items.length);
        }
    });
    await Promise.all(workers);
}

/** Find Hardcover/Google metadata for an imported row; fall back to the row itself. */
async function matchImported(row) {
    if (row.isbn13) {
        const byIsbn = await lookupIsbn(row.isbn13).catch(() => null);
        if (byIsbn) return byIsbn;
    }
    const q = `${row.title} ${row.authors[0]?.name || ''}`.trim();
    const res = await searchAll(q).catch(() => null);
    const found = res?.books?.find((b) => b.verified && sameBook(b, row)) || res?.books?.find((b) => sameBook(b, row));
    return found || null;
}

export async function importGoodreadsFile(text, { onProgress } = {}) {
    const { books, summary } = parseGoodreads(text);
    const ops = [];
    const authorsSeen = new Map();
    let matched = 0;
    await pool(books, 3, async (row) => {
        const meta = await matchImported(row);
        if (meta) matched++;
        const base = meta ? metaOf(meta) : metaOf({ title: row.title, authors: row.authors, isbn13: row.isbn13, pageCount: row.pageCount, publisher: row.publisher, verified: false, series: row.seriesHint });
        const key = meta?.key || (row.isbn13 ? `isbn_${row.isbn13}` : `gr_${row.goodreadsId}`);
        const existing = store.get('books', key);
        ops.push({
            collection: 'books', key,
            patch: {
                ...base,
                status: existing?.status && existing.status !== 'want' ? existing.status : row.status,
                rating: existing?.rating ?? row.rating,
                reads: existing?.reads?.length ? existing.reads : row.reads,
                review: existing?.review || row.review,
                owned: existing?.owned || row.owned,
                tags: [...new Set([...(existing?.tags || []), ...row.customShelves])],
                addedAt: existing?.addedAt || (row.addedAt ? `${row.addedAt}T12:00:00.000Z` : new Date().toISOString()),
                importedFrom: 'goodreads',
            },
        });
        if (row.status === 'read' && (row.rating ?? 0) >= 6) {
            for (const a of (meta?.authors || row.authors).slice(0, 1)) authorsSeen.set(authorKey(a), a);
        }
    }, onProgress);
    await store.batch(ops);
    await store.saveSettings({ lastImportAt: new Date().toISOString(), lastImportCount: books.length });
    const suggestions = [...authorsSeen.entries()].filter(([k]) => !store.get('authors', k)?.followed).map(([, a]) => a);
    return { summary: { ...summary, matched }, suggestions };
}

export async function followMany(authors) {
    const ops = authors.map((a) => ({ collection: 'authors', key: authorKey(a), patch: { hardcoverId: a.id || null, name: a.name, followed: true, followedAt: new Date().toISOString(), followedVia: 'goodreads-import' } }));
    await store.batch(ops);
    toast(`Following ${ops.length} authors`);
}

// ─── Export ─────────────────────────────────────────────────────────

function download(name, type, text) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportJson() {
    const data = {
        exportedAt: new Date().toISOString(),
        books: Object.fromEntries(store.books), authors: Object.fromEntries(store.authors), series: Object.fromEntries(store.series), settings: store.settings,
    };
    download(`book-tracker-backup-${todayIso()}.json`, 'application/json', JSON.stringify(data, null, 2));
}

export function exportCsv() {
    const cols = ['Title', 'Authors', 'Series', 'Book in series', 'Shelf', 'Your rating (out of 10)', 'Times read', 'Last finished', 'Formats', 'Moods', 'ISBN-13', 'Pages', 'Review'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [...store.books.values()].filter((b) => b.status !== 'upcoming').map((b) => {
        const finished = (b.reads || []).filter((r) => isFinished(r));
        const last = finished[finished.length - 1];
        return [b.title, (b.authors || []).map((a) => a.name).join('; '), b.series?.name, b.series?.position, SHELF_LABELS[b.status] || b.status, b.rating, finished.length,
            last?.finishedAt || last?.finishedYear, [...new Set(finished.flatMap((r) => r.formats || []))].join('; '), [...new Set(finished.flatMap((r) => r.moods || []))].join('; '), b.isbn13, b.pageCount, b.review].map(q).join(',');
    });
    download(`book-tracker-library-${todayIso()}.csv`, 'text/csv', [cols.map(q).join(','), ...rows].join('\r\n'));
}

// ─── Series in bulk ─────────────────────────────────────────────────

/**
 * Mark several books in a series as read in one go (for series read in the
 * past). `year` null means "I don't remember": the reads count all-time only.
 * One Undo restores every book, the series and any new follows.
 */
export async function markSeriesRead(series, books, { rating = null, year = null, formats = ['print'], followSeries = false, followAuthor = false }) {
    if (!books.length) return;
    const now = new Date().toISOString();
    const before = new Map(books.map((b) => [b.key, snapshot(b.key)]));
    const ops = books.map((b) => {
        const prev = store.get('books', b.key);
        const reads = [...(prev?.reads || []), { startedAt: null, finishedAt: null, finishedYear: year || null, dateUnknown: !year, rating, formats, bulk: true }];
        return {
            collection: 'books', key: b.key,
            patch: { ...(prev ? {} : metaOf(b)), status: 'read', rating: rating ?? prev?.rating ?? null, reads, addedAt: prev?.addedAt || now, updatedAt: now },
        };
    });
    const undo = [];
    const sKey = seriesKey(series);
    if (sKey) {
        const prev = store.get('series', sKey);
        undo.push(() => store.put('series', sKey, prev ? structuredClone(prev) : null));
        const maxPositionRead = Math.max(prev?.maxPositionRead || 0, ...books.map((b) => b.series?.position || 0));
        ops.push({ collection: 'series', key: sKey, patch: { id: series.id || null, name: series.name, authorNames: series.author?.name ? [series.author.name] : prev?.authorNames || [], maxPositionRead, followed: followSeries || !!prev?.followed } });
    }
    if (followAuthor && series.author?.name) {
        const aKey = authorKey(series.author);
        const prev = store.get('authors', aKey);
        if (!prev?.followed) {
            undo.push(() => store.put('authors', aKey, prev ? structuredClone(prev) : null));
            ops.push({ collection: 'authors', key: aKey, patch: { hardcoverId: series.author.id || null, name: series.author.name, followed: true, followedAt: now, followedVia: sKey } });
        }
    }
    await store.batch(ops);
    toast(`Marked ${books.length === 1 ? '1 book' : `${books.length} books`} in ${series.name} as read`, {
        undo: async () => {
            for (const [key, doc] of before) await store.put('books', key, doc);
            for (const u of undo) await u();
        },
    });
}

/**
 * Set your rating for a book from a list (Series page, adjust-ratings step).
 * Rates the latest finished read; an unread book becomes "read, date unknown".
 */
export async function rateBookQuick(meta, rating) {
    const key = meta.key;
    const before = snapshot(key);
    const reads = [...(before?.reads || [])];
    let i = -1;
    for (let j = reads.length - 1; j >= 0; j--) if (isFinished(reads[j])) { i = j; break; }
    if (i >= 0) reads[i] = { ...reads[i], rating };
    else reads.push({ startedAt: null, finishedAt: null, dateUnknown: true, rating, formats: [store.settings.defaultFormat || 'print'], bulk: true });
    await store.save('books', key, { ...(before ? {} : { ...metaOf(meta), addedAt: new Date().toISOString() }), status: 'read', rating, reads });
    toast(`Rated ${meta.title} ${rating} out of 10`, { undo: undoTo(key, before) });
}
