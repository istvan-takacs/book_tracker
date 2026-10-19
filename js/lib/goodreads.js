// Goodreads "Export library" CSV → book records ready for matching.

import { toIsbn13 } from './isbn.js';

/** RFC 4180 CSV parser: quoted fields, escaped quotes, newlines inside quotes. */
export function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    const src = text.replace(/^﻿/, '');
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (quoted) {
            if (c === '"') {
                if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
            } else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && src[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.some((v) => v !== '')) rows.push(row);
            row = [];
        } else field += c;
    }
    row.push(field);
    if (row.some((v) => v !== '')) rows.push(row);
    return rows;
}

export function csvToObjects(text) {
    const [header, ...rows] = parseCsv(text);
    if (!header) return [];
    return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** "2024/09/14" → "2024-09-14" */
function gDate(s) {
    const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(s || '');
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

function format(binding) {
    const b = (binding || '').toLowerCase();
    if (/audio|audible|mp3|cd/.test(b)) return 'audio';
    if (/kindle|ebook|e-book|nook|kobo|digital/.test(b)) return 'ebook';
    return 'print';
}

const SHELF = { read: 'read', 'currently-reading': 'reading', 'to-read': 'want' };

/** "Mistborn: The Final Empire (Mistborn, #1)" → series hint for matching. */
export function seriesFromTitle(title) {
    const m = /\(([^()#]+),\s*#(\d+(?:\.\d+)?)\)\s*$/.exec(title || '');
    return m ? { name: m[1].trim(), position: Number(m[2]) } : null;
}

export function cleanTitle(title) {
    return (title || '').replace(/\s*\([^()]*#\d+(?:\.\d+)?\)\s*$/, '').trim();
}

/** One Goodreads row → a partial book record (metadata is filled in by matching later). */
export function mapRow(row) {
    const exclusive = (row['Exclusive Shelf'] || '').toLowerCase();
    const shelves = (row['Bookshelves'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    const status = SHELF[exclusive] || (/(dnf|did-not-finish|abandoned)/.test(exclusive) || shelves.some((s) => /^(dnf|did-not-finish|abandoned)$/i.test(s)) ? 'dnf' : 'want');
    const stars = Number(row['My Rating']) || 0;
    const rating = stars > 0 ? stars * 2 : null;
    const finishedAt = gDate(row['Date Read']);
    const readCount = Math.max(Number(row['Read Count']) || 0, status === 'read' ? 1 : 0);
    const fmt = format(row['Binding']);
    const reads = [];
    if (status === 'read') {
        // Goodreads keeps only the latest read date; earlier re-reads get no dates.
        for (let i = 1; i < readCount; i++) reads.push({ startedAt: null, finishedAt: null, rating: null, formats: [fmt] });
        reads.push({ startedAt: null, finishedAt: finishedAt || gDate(row['Date Added']), rating, formats: [fmt] });
    }
    return {
        goodreadsId: row['Book Id'] || null,
        title: cleanTitle(row['Title']),
        seriesHint: seriesFromTitle(row['Title']),
        authors: [row['Author'], ...(row['Additional Authors'] || '').split(',')].map((n) => n?.trim()).filter(Boolean).map((name) => ({ id: null, name })),
        isbn13: toIsbn13(row['ISBN13']) || toIsbn13(row['ISBN']),
        pageCount: Number(row['Number of Pages']) || null,
        publisher: row['Publisher'] || null,
        status,
        rating,
        reads,
        review: row['My Review'] || null,
        owned: Number(row['Owned Copies']) > 0,
        customShelves: shelves.filter((s) => !SHELF[s] && !/^(dnf|did-not-finish|abandoned)$/i.test(s)),
        addedAt: gDate(row['Date Added']),
    };
}

export function importGoodreads(text) {
    const objects = csvToObjects(text);
    if (objects.length && !('Exclusive Shelf' in objects[0])) throw new Error('This does not look like a Goodreads export (no "Exclusive Shelf" column).');
    const books = objects.map(mapRow).filter((b) => b.title);
    const summary = { total: books.length, read: 0, reading: 0, want: 0, dnf: 0 };
    for (const b of books) summary[b.status]++;
    return { books, summary };
}
