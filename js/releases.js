// Release radar: looks up new and upcoming books from followed authors and
// series. Runs on app open at most once a day (or when asked) and writes
// newly found books to the library with status "upcoming".

import { store } from './store.js';
import { upcomingForAuthors, seriesBooks, hardcoverAvailable } from './api.js';
import { todayIso, toIso, parseDay } from './lib/dates.js';
import { reconcileOverride } from './lib/merge.js';
import { metaOf } from './actions.js';

const DAY = 86400000;
let running = null;

const chunk = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export function lastChecked() {
    return store.settings.lastReleaseCheck ? new Date(store.settings.lastReleaseCheck) : null;
}

export function checkReleases({ force = false } = {}) {
    if (running) return running;
    running = run(force).finally(() => { running = null; });
    return running;
}

async function run(force) {
    if (!hardcoverAvailable()) return { added: 0, updated: 0, skipped: 'unavailable' };
    const last = lastChecked();
    if (!force && last && Date.now() - last.getTime() < DAY) return { added: 0, updated: 0, skipped: 'recent' };

    const today = todayIso();
    const since = toIso(parseDay(today) - 30 * DAY);
    const year = Number(today.slice(0, 4));
    const authorIds = [...store.authors.values()].filter((a) => a.followed && a.hardcoverId).map((a) => a.hardcoverId);
    const followedSeries = [...store.series.values()].filter((s) => s.followed && s.id);

    const found = new Map();
    for (const ids of chunk(authorIds, 50)) {
        for (const b of await upcomingForAuthors(ids, since, year, { priority: 'background' })) if (!b.compilation) found.set(b.key, b);
    }
    for (const ids of chunk(followedSeries.map((s) => s.id), 50)) {
        for (const s of await seriesBooks(ids, { priority: 'background' })) {
            const seriesDoc = followedSeries.find((x) => x.id === s.id);
            const key = `hc_${s.id}`;
            await store.save('series', key, {
                total: s.total || null, completed: !!s.completed,
                books: s.books.map((b) => ({ key: b.key, title: b.title, position: b.series.position, releaseDate: b.releaseDate, datePrecision: b.datePrecision, coverUrl: b.coverUrl || null })),
                checkedAt: new Date().toISOString(),
            });
            for (const b of s.books) {
                const isFuture = !b.releaseDate || b.releaseDate >= since;
                if (isFuture && (b.series.position || 0) > (seriesDoc?.maxPositionRead || 0)) found.set(b.key, b);
            }
        }
    }

    let added = 0, updated = 0;
    const ops = [];
    const now = new Date().toISOString();
    for (const [key, b] of found) {
        const existing = store.get('books', key);
        if (!existing) {
            ops.push({ collection: 'books', key, patch: { ...metaOf(b), status: 'upcoming', discoveredAt: now, isNew: true, addedAt: now } });
            added++;
            continue;
        }
        const patch = {};
        if (b.releaseDate && (b.releaseDate !== existing.releaseDate || b.datePrecision !== existing.datePrecision)) {
            patch.releaseDate = b.releaseDate;
            patch.datePrecision = b.datePrecision;
        }
        const decision = reconcileOverride(existing, b);
        if (decision === 'clear') patch.releaseDateOverride = null;
        if (decision === 'ask' && existing.pendingDate?.date !== b.releaseDate) patch.pendingDate = { date: b.releaseDate, foundAt: now };
        if (Object.keys(patch).length) { ops.push({ collection: 'books', key, patch }); updated++; }
    }
    if (ops.length) await store.batch(ops);
    await store.saveSettings({ lastReleaseCheck: now, lastReleaseFound: added });
    return { added, updated };
}
