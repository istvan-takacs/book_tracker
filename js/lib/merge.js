// Hybrid merge rules: Hardcover is the source of truth; Google Books, then
// Open Library, only fill gaps. They never overrule Hardcover, with one
// exception: a more precise release date for the same book.

import { stripArticle, wordSimilarity } from './text.js';
import { morePrecise } from './dates.js';

/** Fields that gap-fill from secondary sources when Hardcover has nothing. */
const FILLABLE = ['coverUrl', 'description', 'isbn13', 'pageCount', 'publisher', 'subtitle'];

const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

export function bookKey(meta) {
    if (meta?.hardcoverId) return `hc_${meta.hardcoverId}`;
    if (meta?.googleVolumeId) return `gb_${meta.googleVolumeId}`;
    if (meta?.isbn13) return `isbn_${meta.isbn13}`;
    if (meta?.openLibraryKey) return `ol_${meta.openLibraryKey.split('/').pop()}`;
    return null;
}

function lastName(name) {
    const parts = stripArticle(name || '').split(' ');
    return parts[parts.length - 1] || '';
}

/** Same work? ISBN first, then normalised title plus the first author's surname. */
export function sameBook(a, b) {
    if (!a || !b) return false;
    const isbnsA = new Set([a.isbn13, ...(a.isbns || [])].filter(Boolean));
    if ([b.isbn13, ...(b.isbns || [])].some((i) => i && isbnsA.has(i))) return true;
    const ta = stripArticle((a.title || '').split(':')[0]);
    const tb = stripArticle((b.title || '').split(':')[0]);
    if (!ta || !tb || wordSimilarity(ta, tb) < 0.9) return false;
    const la = lastName(a.authors?.[0]?.name);
    const lb = lastName(b.authors?.[0]?.name);
    return !la || !lb || la === lb;
}

/**
 * Merge source records for one book. `hc` may be null (book unknown to
 * Hardcover): the result is then marked `verified: false`.
 */
export function mergeBook({ hc = null, gb = null, ol = null } = {}) {
    const base = hc || gb || ol;
    if (!base) return null;
    const primary = hc ? 'hardcover' : gb ? 'google' : 'openlibrary';
    const out = { ...base, sources: {}, verified: !!hc };
    for (const k of Object.keys(base)) if (!isEmpty(base[k])) out.sources[k] = primary;

    const fillers = [[gb, 'google'], [ol, 'openlibrary']].filter(([s, name]) => s && name !== primary);
    for (const field of FILLABLE) {
        if (!isEmpty(out[field])) continue;
        for (const [src, name] of fillers) {
            if (!isEmpty(src[field])) { out[field] = src[field]; out.sources[field] = name; break; }
        }
    }

    // A vague Hardcover date may be upgraded by a more precise secondary date
    // for the same book (same year, and same month when Hardcover knows it).
    for (const [src, name] of fillers) {
        if (!src.releaseDate || !morePrecise(src.datePrecision, out.datePrecision || 'none')) continue;
        const sameYear = !out.releaseDate || src.releaseDate.slice(0, 4) === out.releaseDate.slice(0, 4);
        const sameMonth = out.datePrecision !== 'month' || src.releaseDate.slice(0, 7) === out.releaseDate.slice(0, 7);
        if (sameYear && sameMonth) {
            out.releaseDate = src.releaseDate;
            out.datePrecision = src.datePrecision;
            out.sources.releaseDate = name;
        }
    }

    if (gb?.googleVolumeId) out.googleVolumeId = gb.googleVolumeId;
    out.key = bookKey(out);
    return out;
}

/**
 * When Hardcover later reports a different exact date than the user's manual
 * one, the app asks. Returns 'clear' (dates agree), 'ask' or 'keep'.
 */
export function reconcileOverride(book, freshHc) {
    const o = book?.releaseDateOverride?.date;
    if (!o || !freshHc?.releaseDate || freshHc.datePrecision !== 'day') return 'keep';
    return freshHc.releaseDate === o ? 'clear' : 'ask';
}
