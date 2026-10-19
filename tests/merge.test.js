import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBook, sameBook, bookKey, reconcileOverride } from '../js/lib/merge.js';

const hc = {
    hardcoverId: 101, title: 'The Salt Courts', authors: [{ id: 7, name: 'Ines Vahl' }],
    series: { id: 3, name: 'The Salt Courts', position: 1 }, releaseDate: '2021-09-14', datePrecision: 'day',
    isbn13: null, coverUrl: null, description: 'Hardcover blurb', pageCount: 512,
};
const gb = {
    googleVolumeId: 'gb1', title: 'The Salt Courts', authors: [{ id: null, name: 'Ines Vahl' }],
    releaseDate: '2021-10-01', datePrecision: 'day', isbn13: '9780000000002', coverUrl: 'https://g/cover.jpg',
    description: 'Google blurb', pageCount: 530,
};

test('Hardcover wins; gaps fill from Google, with sources recorded', () => {
    const m = mergeBook({ hc, gb });
    assert.equal(m.description, 'Hardcover blurb');
    assert.equal(m.pageCount, 512);
    assert.equal(m.releaseDate, '2021-09-14', 'same precision: Hardcover date kept');
    assert.equal(m.coverUrl, 'https://g/cover.jpg');
    assert.equal(m.isbn13, '9780000000002');
    assert.equal(m.sources.coverUrl, 'google');
    assert.equal(m.sources.title, 'hardcover');
    assert.equal(m.verified, true);
    assert.equal(m.key, 'hc_101');
});

test('Open Library fills what Google lacks', () => {
    const m = mergeBook({ hc: { ...hc, coverUrl: null }, gb: { ...gb, coverUrl: null }, ol: { coverUrl: 'https://ol/c.jpg' } });
    assert.equal(m.coverUrl, 'https://ol/c.jpg');
    assert.equal(m.sources.coverUrl, 'openlibrary');
});

test('a vague Hardcover date is upgraded by a precise one in the same year', () => {
    const vague = { ...hc, releaseDate: '2027-01-01', datePrecision: 'year' };
    const m = mergeBook({ hc: vague, gb: { ...gb, releaseDate: '2027-04-15', datePrecision: 'day' } });
    assert.equal(m.releaseDate, '2027-04-15');
    assert.equal(m.datePrecision, 'day');
    assert.equal(m.sources.releaseDate, 'google');
    const other = mergeBook({ hc: vague, gb: { ...gb, releaseDate: '2028-04-15', datePrecision: 'day' } });
    assert.equal(other.releaseDate, '2027-01-01', 'different year: not the same release');
});

test('a month-precise date only upgrades within the same month', () => {
    const month = { ...hc, releaseDate: '2027-03-01', datePrecision: 'month' };
    assert.equal(mergeBook({ hc: month, gb: { ...gb, releaseDate: '2027-03-12', datePrecision: 'day' } }).releaseDate, '2027-03-12');
    assert.equal(mergeBook({ hc: month, gb: { ...gb, releaseDate: '2027-05-12', datePrecision: 'day' } }).releaseDate, '2027-03-01');
});

test('a Google-only book is unverified', () => {
    const m = mergeBook({ gb });
    assert.equal(m.verified, false);
    assert.equal(m.key, 'gb_gb1');
});

test('sameBook matches by ISBN, then title and surname', () => {
    assert.ok(sameBook({ isbn13: '1' }, { isbns: ['1'] }));
    assert.ok(sameBook({ title: 'The Way of Kings', authors: [{ name: 'Brandon Sanderson' }] }, { title: 'Way of Kings: Book One', authors: [{ name: 'B. Sanderson' }] }));
    assert.ok(!sameBook({ title: 'Mistborn', authors: [{ name: 'Brandon Sanderson' }] }, { title: 'Mistborn', authors: [{ name: 'Someone Else' }] }));
    assert.equal(bookKey({ isbn13: '9' }), 'isbn_9');
});

test('manual date reconciliation', () => {
    const book = { releaseDateOverride: { date: '2027-04-15' } };
    assert.equal(reconcileOverride(book, { releaseDate: '2027-04-15', datePrecision: 'day' }), 'clear');
    assert.equal(reconcileOverride(book, { releaseDate: '2027-05-01', datePrecision: 'day' }), 'ask');
    assert.equal(reconcileOverride(book, { releaseDate: '2027-01-01', datePrecision: 'year' }), 'keep');
});
