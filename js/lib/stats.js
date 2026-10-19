// Reading statistics. Every number here is derived from `reads[]` entries,
// so re-reads count once per finished read.

import { parseDay, daysBetween } from './dates.js';

/** Flatten books into finished reads within `year` (or every year when null). */
export function finishedReads(books, year = null) {
    const out = [];
    for (const book of books) {
        for (const r of book.reads || []) {
            if (!r.finishedAt) continue;
            if (year && r.finishedAt.slice(0, 4) !== String(year)) continue;
            out.push({ book, read: r });
        }
    }
    return out;
}

const avg = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

export function computeStats(books, { year = null, minTasteBooks = 3 } = {}) {
    const reads = finishedReads(books, year);
    const ratings = reads.map((x) => x.read.rating).filter((r) => r != null);
    const pages = reads.map((x) => x.book.pageCount).filter(Boolean);

    const perMonth = Array(12).fill(0);
    for (const { read } of reads) perMonth[Number(read.finishedAt.slice(5, 7)) - 1]++;

    const ratingDistribution = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, 0]));
    for (const r of ratings) ratingDistribution[r]++;

    const formats = { print: 0, ebook: 0, audio: 0, mixed: 0 };
    for (const { read } of reads) {
        const f = read.formats?.length ? read.formats : [];
        for (const x of f) if (x in formats) formats[x]++;
        if (f.length > 1) formats.mixed++;
    }

    const durations = reads
        .filter(({ read }) => read.startedAt && read.finishedAt)
        .map(({ read }) => daysBetween(read.startedAt, read.finishedAt) + 1)
        .filter((d) => d > 0);

    const byAuthor = new Map();
    for (const { book, read } of reads) {
        const name = book.authors?.[0]?.name;
        if (!name) continue;
        const e = byAuthor.get(name) || { name, count: 0, ratings: [] };
        e.count++;
        if (read.rating != null) e.ratings.push(read.rating);
        byAuthor.set(name, e);
    }
    const topAuthors = [...byAuthor.values()]
        .map((e) => ({ name: e.name, count: e.count, average: round1(avg(e.ratings)) }))
        .sort((a, b) => b.count - a.count || (b.average ?? 0) - (a.average ?? 0))
        .slice(0, 5);

    const moodCounts = new Map();
    for (const { read } of reads) for (const m of read.moods || []) moodCounts.set(m, (moodCounts.get(m) || 0) + 1);
    const moods = [...moodCounts.entries()].map(([mood, count]) => ({ mood, count })).sort((a, b) => b.count - a.count);

    return {
        books: reads.length,
        pages: pages.reduce((s, v) => s + v, 0),
        averageRating: round1(avg(ratings)),
        perMonth,
        ratingDistribution,
        formats,
        averageLength: pages.length ? Math.round(avg(pages)) : null,
        averageDaysToFinish: durations.length ? Math.round(avg(durations)) : null,
        topAuthors,
        moods,
        tastes: tastes(reads, minTasteBooks),
    };
}

const SCALE_LABELS = {
    pace: { slow: 'Slow-paced', medium: 'Medium pace', fast: 'Fast-paced' },
    tone: { light: 'Light', balanced: 'Balanced tone', dark: 'Dark' },
    drivenBy: { plot: 'Plot-driven', both: 'Plot and character', characters: 'Character-driven' },
};

/** "What you rate highest": average rating per mood or scale value, on ≥ min books. */
export function tastes(reads, min = 3) {
    const groups = new Map();
    const add = (label, rating) => {
        const g = groups.get(label) || [];
        g.push(rating);
        groups.set(label, g);
    };
    for (const { read } of reads) {
        if (read.rating == null) continue;
        for (const m of read.moods || []) add(m, read.rating);
        for (const [k, v] of Object.entries(read.scales || {})) {
            const label = SCALE_LABELS[k]?.[v];
            if (label) add(label, read.rating);
        }
    }
    return [...groups.entries()]
        .filter(([, rs]) => rs.length >= min)
        .map(([label, rs]) => ({ label, average: round1(avg(rs)), count: rs.length }))
        .sort((a, b) => b.average - a.average || b.count - a.count);
}

/** Goal progress: how far ahead (+) or behind (−) of an even pace you are. */
export function goalProgress(readCount, goal, today) {
    if (!goal) return null;
    const year = Number(today.slice(0, 4));
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year + 1, 0, 1);
    const fraction = (parseDay(today) - start + 86400000) / (end - start);
    const expected = Math.round(goal * fraction);
    return {
        read: readCount,
        goal,
        percent: Math.min(100, Math.round((readCount / goal) * 100)),
        expected,
        aheadBy: readCount - expected,
        done: readCount >= goal,
    };
}
