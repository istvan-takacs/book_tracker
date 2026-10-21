// Mood suggestions for the finish sheet, ranked for the book at hand:
// what Hardcover readers tagged it with, then moods that fit its genres,
// then moods you have used on books sharing a genre with it.

import { normalize } from './text.js';

export const MOODS = {
    Feel: ['adventurous', 'challenging', 'cosy', 'dark', 'emotional', 'funny', 'hopeful', 'informative', 'inspiring',
        'lighthearted', 'mysterious', 'reflective', 'relaxing', 'romantic', 'sad', 'tense'],
    Style: ['atmospheric', 'chilling', 'epic', 'fast-paced', 'gritty', 'haunting', 'heartwarming', 'slow-burn',
        'thought-provoking', 'twisty', 'whimsical'],
};

/** Genre keyword → moods that usually fit. Matched against normalised genre names. */
export const GENRE_HINTS = [
    [/fantasy|magic|dragons?/, ['epic', 'adventurous', 'atmospheric']],
    [/science fiction|sci fi|scifi|space opera|cyberpunk/, ['thought-provoking', 'adventurous', 'mysterious']],
    [/dystopi|post apocalyptic/, ['dark', 'tense', 'thought-provoking']],
    [/thriller|suspense/, ['tense', 'twisty', 'fast-paced']],
    [/mystery|detective|crime|noir/, ['mysterious', 'twisty', 'tense']],
    [/horror|gothic|ghost/, ['dark', 'chilling', 'haunting']],
    [/romance|romantic|love/, ['romantic', 'heartwarming', 'emotional']],
    [/literary|literature|classics?/, ['reflective', 'emotional', 'challenging']],
    [/historical|history/, ['atmospheric', 'reflective', 'informative']],
    // "science" alone, but not "science fiction"
    [/non ?fiction|science(?! ?fiction)|business|self help|psychology|philosophy/, ['informative', 'thought-provoking', 'inspiring']],
    [/memoir|biography|autobiography/, ['reflective', 'inspiring', 'emotional']],
    [/humou?r|comedy|satire|funny/, ['funny', 'lighthearted', 'whimsical']],
    [/young adult|ya\b|coming of age/, ['emotional', 'adventurous', 'hopeful']],
    [/children|middle grade/, ['whimsical', 'lighthearted', 'adventurous']],
    [/war|military/, ['dark', 'gritty', 'tense']],
    [/poetry/, ['reflective', 'emotional', 'atmospheric']],
    [/cosy|cozy/, ['cosy', 'relaxing', 'heartwarming']],
    [/grimdark/, ['dark', 'gritty', 'epic']],
];

const clean = (m) => normalize(m).replace(/\s+/g, '-').replace(/^-|-$/g, '');

export function genreMoods(genres = []) {
    const out = [];
    for (const g of genres) {
        const n = normalize(g);
        for (const [re, moods] of GENRE_HINTS) if (re.test(n)) out.push(...moods);
    }
    return out;
}

/**
 * Up to `limit` suggestions as { mood, source }, where source is
 * 'readers' | 'genre' | 'you'. `history` is the library (books with reads).
 */
export function suggestMoods(book, { history = [], limit = 8 } = {}) {
    const seen = new Set();
    const out = [];
    const add = (mood, source) => {
        const m = clean(mood);
        if (!m || seen.has(m) || out.length >= limit) return;
        seen.add(m);
        out.push({ mood: m, source });
    };
    for (const m of book?.communityMoods || []) add(m, 'readers');
    for (const m of genreMoods(book?.genres || [])) add(m, 'genre');
    // moods you used on books that share a genre with this one, most used first
    const genres = new Set((book?.genres || []).map(normalize));
    if (genres.size) {
        const counts = new Map();
        for (const b of history) {
            if (b.key === book.key || !(b.genres || []).some((g) => genres.has(normalize(g)))) continue;
            for (const r of b.reads || []) for (const m of r.moods || []) counts.set(m, (counts.get(m) || 0) + 1);
        }
        for (const [m] of [...counts].sort((a, b) => b[1] - a[1])) add(m, 'you');
    }
    return out;
}

/** "from Hardcover readers" / "fits its genres" note for the suggestions heading. */
export function suggestionNote(suggestions) {
    const sources = new Set(suggestions.map((s) => s.source));
    if (sources.has('readers') && sources.has('genre')) return 'From Hardcover readers and its genres';
    if (sources.has('readers')) return 'From Hardcover readers';
    if (sources.has('genre')) return 'Moods that fit its genres';
    if (sources.has('you')) return 'Moods you used on similar books';
    return null;
}
