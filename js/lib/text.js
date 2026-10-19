// Text normalisation and fuzzy matching, shared by search ranking, merge
// matching and the Goodreads importer. Pure functions only.

const ARTICLES = /^(the|a|an)\s+/;

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalize(str) {
    if (!str) return '';
    return String(str)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9#]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

export function stripArticle(str) {
    return normalize(str).replace(ARTICLES, '');
}

export function tokens(str) {
    const n = normalize(str);
    return n ? n.split(' ') : [];
}

/** Optimal string alignment distance (Damerau–Levenshtein with adjacent transpositions). */
export function editDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev2 = null;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                v = Math.min(v, prev2[j - 2] + 1);
            }
            cur.push(v);
        }
        prev2 = prev;
        prev = cur;
    }
    return prev[b.length];
}

/** 0..1 similarity of two single words. */
export function wordSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const max = Math.max(a.length, b.length);
    return 1 - editDistance(a, b) / max;
}

function trigrams(str) {
    const s = `  ${str} `;
    const set = new Set();
    for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3));
    return set;
}

/** Jaccard overlap of character trigrams, 0..1. Tolerant of missing letters. */
export function trigramSimilarity(a, b) {
    const A = trigrams(normalize(a));
    const B = trigrams(normalize(b));
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    return inter / (A.size + B.size - inter);
}

/**
 * How well a query matches a field, 0..1, with a match kind:
 * exact > prefix > all tokens (each ≥ 0.75 similar) > fuzzy.
 */
export function matchField(query, field) {
    const q = stripArticle(query);
    const f = stripArticle(field);
    if (!q || !f) return { score: 0, kind: 'none' };
    if (q === f) return { score: 1, kind: 'exact' };
    if (f.startsWith(q)) return { score: 0.9, kind: 'prefix' };

    const qt = q.split(' ');
    const ft = f.split(' ');
    const per = qt.map((w) => Math.max(...ft.map((x) => (x.startsWith(w) && w.length >= 3 ? 0.95 : wordSimilarity(w, x)))));
    const avg = per.reduce((s, v) => s + v, 0) / per.length;
    if (per.every((v) => v >= 0.75)) {
        // all words present (allowing typos); reward covering more of the field
        const coverage = Math.min(1, qt.length / ft.length);
        return { score: 0.6 + 0.25 * avg + 0.05 * coverage, kind: 'tokens' };
    }
    const tri = trigramSimilarity(q, f);
    return { score: Math.max(tri, avg * 0.6), kind: 'fuzzy' };
}

/** Best per-token correction of a query against a vocabulary of known words. */
export function correctQuery(query, vocabulary) {
    const words = tokens(query);
    if (!words.length || !vocabulary.length) return null;
    let changed = false;
    const fixed = words.map((w) => {
        if (vocabulary.includes(w) || w.length < 3) return w;
        let best = w, bestSim = 0;
        for (const v of vocabulary) {
            const sim = wordSimilarity(w, v);
            if (sim > bestSim) { bestSim = sim; best = v; }
        }
        if (bestSim >= 0.7 && best !== w) { changed = true; return best; }
        return w;
    });
    return changed ? fixed.join(' ') : null;
}
