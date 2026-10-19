import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankResults, seriesPositionHint, collapseEditions } from '../js/lib/search.js';
import { matchField, correctQuery } from '../js/lib/text.js';

const sanderson = { name: 'Brandon Sanderson', booksCount: 120 };
const authors = [sanderson, { name: 'Brandon Mull', booksCount: 40 }, { name: 'Sandra Brown', booksCount: 90 }];
const series = [
    { id: 1, name: 'Mistborn', authorName: 'Brandon Sanderson', readersCount: 900000 },
    { id: 2, name: 'The Stormlight Archive', authorName: 'Brandon Sanderson', readersCount: 800000 },
    { id: 3, name: 'The First Law', authorName: 'Joe Abercrombie', readersCount: 300000 },
];
const b = (key, title, author, s, pos, readers = 1000, extra = {}) => ({
    key, title, authors: [{ name: author }], series: s ? { name: s, position: pos } : null, readersCount: readers, ...extra,
});
const books = [
    b('hc_1', 'The Way of Kings', 'Brandon Sanderson', 'The Stormlight Archive', 1, 500000),
    b('hc_2', 'Words of Radiance', 'Brandon Sanderson', 'The Stormlight Archive', 2, 400000),
    b('hc_3', 'Mistborn: The Final Empire', 'Brandon Sanderson', 'Mistborn', 1, 600000),
    b('hc_4', 'The Well of Ascension', 'Brandon Sanderson', 'Mistborn', 2, 400000),
    b('hc_5', 'The Hero of Ages', 'Brandon Sanderson', 'Mistborn', 3, 380000),
    b('hc_6', 'The Blade Itself', 'Joe Abercrombie', 'The First Law', 1, 200000),
    b('gb_x', 'The Blade Itself', 'Joe Abercrombie', null, null, 10, { isbn13: '9780575079793' }),
    b('hc_7', 'Mistborn Graphic Novel', 'Brandon Sanderson', 'Mistborn', null, 5000, { compilation: true }),
    b('hc_8', 'The Kings of Wyld', 'Nicholas Eames', 'The Band', 1, 90000),
];
const all = { books, authors, series };

test('author typo: "brandon sandersen" puts Brandon Sanderson first', () => {
    const r = rankResults('brandon sandersen', all);
    assert.equal(r.authors[0].name, 'Brandon Sanderson');
    assert.equal(r.lead, 'authors');
});

test('"mistborn" leads with the series, then books 1–3 in reading order', () => {
    const r = rankResults('mistborn', all);
    assert.equal(r.series[0].name, 'Mistborn');
    assert.equal(r.lead, 'series');
    const order = r.books.filter((x) => x.series?.name === 'Mistborn' && x.series.position).map((x) => x.series.position);
    assert.deepEqual(order.slice(0, 3), [1, 2, 3]);
});

test('heavy typo "wy of kngs" still finds The Way of Kings first', () => {
    const r = rankResults('wy of kngs', all);
    assert.equal(r.books[0].title, 'The Way of Kings');
});

test('author + series words: "abercrombie first law" finds The First Law', () => {
    const r = rankResults('abercrombie first law', all);
    assert.equal(r.series[0].name, 'The First Law');
});

test('"the blade itself" collapses editions into one result', () => {
    const r = rankResults('the blade itself', all);
    const blades = r.books.filter((x) => x.title === 'The Blade Itself');
    assert.equal(blades.length, 1);
    assert.equal(blades[0].key, 'hc_6', 'the popular Hardcover record wins');
});

test('books in your library are boosted', () => {
    const libraryKeys = new Set(['hc_8']);
    const r = rankResults('kings', all, { libraryKeys });
    assert.equal(r.books[0].key, 'hc_8');
});

test('series position hints', () => {
    assert.equal(seriesPositionHint('mistborn 2'), 2);
    assert.equal(seriesPositionHint('stormlight book 3'), 3);
    assert.equal(seriesPositionHint('first law #1'), 1);
    assert.equal(seriesPositionHint('mistborn'), null);
    const r = rankResults('mistborn 2', all);
    assert.equal(r.books[0].title, 'The Well of Ascension');
});

test('spelling correction is offered when nothing matches well', () => {
    assert.equal(correctQuery('ines vhal', ['ines', 'vahl', 'salt', 'courts']), 'ines vahl');
    assert.equal(correctQuery('salt courts', ['salt', 'courts']), null);
    const r = rankResults('stromlight archve', { books: [], authors: [], series });
    assert.equal(r.series[0].name, 'The Stormlight Archive');
});

test('match kinds rank exact > prefix > tokens > fuzzy', () => {
    const exact = matchField('mistborn', 'Mistborn').score;
    const prefix = matchField('mistb', 'Mistborn').score;
    const tok = matchField('kings way', 'The Way of Kings').score;
    const fuzzy = matchField('mstbrn', 'Mistborn').score;
    assert.ok(exact > prefix && prefix > tok && tok > fuzzy, `${exact} ${prefix} ${tok} ${fuzzy}`);
});

test('collapseEditions prefers the library copy', () => {
    const out = collapseEditions([
        { key: 'a', title: 'X', authors: [{ name: 'A B' }], readersCount: 100 },
        { key: 'b', title: 'X', authors: [{ name: 'A B' }], readersCount: 1, inLibrary: true },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].key, 'b');
});

test('personal boosts never rescue an unrelated book', () => {
    const lib = [b('mine', 'A Crown of Brine', 'Ines Vahl', 'The Salt Courts', 2, 10)];
    const r = rankResults('the way of kings', { books: lib, authors: [], series: [] }, { libraryKeys: new Set(['mine']), followedAuthors: new Set(['ines vahl']) });
    assert.equal(r.books.length, 0);
});
