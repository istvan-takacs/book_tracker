// Search ranking: re-ranks candidates from your library, Hardcover and
// Google Books so results come back in the order a reader expects.
// Order of importance: text match quality → which field matched → personal
// relevance (your library, authors you follow) → popularity.

import { matchField, normalize, tokens, correctQuery } from './text.js';
import { sameBook } from './merge.js';

const MIN_SCORE = 0.4;

/** "mistborn 2", "book 3", "#3" → 3 */
export function seriesPositionHint(query) {
    const m = /(?:#|\bbook\s+|\bvol(?:ume)?\.?\s+|\s)(\d{1,2})\s*$/i.exec(query || '');
    return m ? Number(m[1]) : null;
}

function stripPositionHint(query) {
    return (query || '').replace(/(?:#|\bbook\s+|\bvol(?:ume)?\.?\s+|\s)\d{1,2}\s*$/i, '').trim() || query;
}

const popularity = (n) => Math.min(1, Math.log10((n || 0) + 1) / 5);

function best(...scores) {
    return scores.reduce((a, b) => (b.score > a.score ? b : a), { score: 0, kind: 'none' });
}

export function scoreBook(query, book, ctx = {}) {
    const q = stripPositionHint(query);
    const author = (book.authors || []).map((a) => a.name).join(' ');
    const series = book.series?.name || '';
    const title = matchField(q, book.title);
    const combined = matchField(q, `${book.title} ${author} ${series}`);
    const fields = best(
        title,
        { ...matchField(q, series), score: matchField(q, series).score * 0.82 },
        { ...matchField(q, author), score: matchField(q, author).score * 0.75 },
        { ...combined, score: combined.kind === 'tokens' ? combined.score * 0.95 : combined.score * 0.7 },
    );
    let score = fields.score;
    const hint = seriesPositionHint(query);
    if (hint && book.series?.position === hint) score += 0.12;
    if (ctx.libraryKeys?.has(book.key)) score += 0.12;
    if (book.authors?.some((a) => ctx.followedAuthors?.has(normalize(a.name)))) score += 0.06;
    score += 0.06 * popularity(book.readersCount);
    if (book.compilation) score -= 0.05;
    return { score, text: fields.score, kind: fields.kind };
}

export function scoreAuthor(query, author, ctx = {}) {
    const names = [author.name, ...(author.alternateNames || [])];
    const m = best(...names.map((n) => matchField(query, n)));
    let score = m.score;
    if (ctx.followedAuthors?.has(normalize(author.name))) score += 0.08;
    score += 0.04 * popularity(author.booksCount * 50);
    return { score, text: m.score, kind: m.kind };
}

export function scoreSeries(query, s, ctx = {}) {
    const q = stripPositionHint(query);
    const name = matchField(q, s.name);
    const withAuthor = matchField(q, `${s.name} ${s.authorName || ''}`);
    const m = best(name, { ...withAuthor, score: withAuthor.kind === 'tokens' ? withAuthor.score * 0.97 : withAuthor.score * 0.7 });
    let score = m.score;
    if (ctx.followedSeries?.has(s.id)) score += 0.08;
    score += 0.04 * popularity(s.readersCount);
    return { score, text: m.score, kind: m.kind };
}

/** Keep one result per work: prefer the library copy, then the most popular. */
export function collapseEditions(books) {
    const out = [];
    for (const b of books) {
        const i = out.findIndex((x) => sameBook(x, b));
        if (i === -1) { out.push(b); continue; }
        const keep = out[i];
        const better = (b.inLibrary && !keep.inLibrary) || (!!b.inLibrary === !!keep.inLibrary && (b.readersCount || 0) > (keep.readersCount || 0));
        if (better) out[i] = { ...b, _score: Math.max(b._score ?? 0, keep._score ?? 0) };
    }
    return out;
}

/**
 * Rank all candidates. Returns grouped results plus an optional spelling
 * correction ("Showing results for …") when nothing matched well.
 */
export function rankResults(query, { books = [], authors = [], series = [] } = {}, ctx = {}) {
    const scoredAuthors = authors
        .map((a) => { const r = scoreAuthor(query, a, ctx); return { ...a, _score: r.score, _text: r.text }; })
        .filter((a) => a._text >= MIN_SCORE)
        .sort((x, y) => y._score - x._score);
    const scoredSeries = series
        .map((s) => { const r = scoreSeries(query, s, ctx); return { ...s, _score: r.score, _text: r.text }; })
        .filter((s) => s._text >= MIN_SCORE)
        .sort((x, y) => y._score - x._score);

    // Boosts reorder genuine matches; they never rescue a weak text match.
    let scoredBooks = books.map((b) => { const r = scoreBook(query, b, ctx); return { ...b, inLibrary: ctx.libraryKeys?.has(b.key) || b.inLibrary, _score: r.score, _text: r.text }; });
    scoredBooks = collapseEditions(scoredBooks.filter((b) => b._text >= MIN_SCORE));

    // A strong series match lists that series' books first, in reading order.
    const topSeries = scoredSeries[0];
    const seriesFocus = topSeries && topSeries._score >= 0.85 ? normalize(topSeries.name) : null;
    // A strong author match keeps that author's books above loose title matches.
    const topAuthor = scoredAuthors[0];
    const authorFocus = topAuthor && topAuthor._score >= 0.85 ? normalize(topAuthor.name) : null;
    const hint = seriesPositionHint(query);
    scoredBooks.sort((a, b) => {
        const inA = seriesFocus && normalize(a.series?.name) === seriesFocus;
        const inB = seriesFocus && normalize(b.series?.name) === seriesFocus;
        if (inA && inB) {
            // "mistborn 2" asks for book 2: it comes first, then reading order.
            const hitA = hint && a.series.position === hint;
            const hitB = hint && b.series.position === hint;
            if (hitA !== hitB) return hitA ? -1 : 1;
            return (a.series.position ?? 99) - (b.series.position ?? 99);
        }
        if (inA !== inB) return inA ? -1 : 1;
        const byA = authorFocus && a.authors?.some((x) => normalize(x.name) === authorFocus);
        const byB = authorFocus && b.authors?.some((x) => normalize(x.name) === authorFocus);
        if (byA !== byB) return byA ? -1 : 1;
        return b._score - a._score;
    });

    const top = Math.max(scoredAuthors[0]?._score ?? 0, scoredSeries[0]?._score ?? 0, scoredBooks[0]?._score ?? 0);
    let correction = null;
    if (top < 0.75) {
        const vocab = new Set();
        for (const b of books) for (const t of tokens(`${b.title} ${(b.authors || []).map((a) => a.name).join(' ')} ${b.series?.name || ''}`)) vocab.add(t);
        for (const a of authors) for (const t of tokens(a.name)) vocab.add(t);
        for (const s of series) for (const t of tokens(s.name)) vocab.add(t);
        correction = correctQuery(query, [...vocab]);
    }

    // Which group leads the "All" view: an exact author or series beats books.
    const lead = scoredAuthors[0]?._score >= 0.9 && scoredAuthors[0]._score >= (scoredBooks[0]?._score ?? 0) - 0.05 ? 'authors'
        : seriesFocus ? 'series' : 'books';

    return { authors: scoredAuthors, series: scoredSeries, books: scoredBooks, correction, lead };
}
