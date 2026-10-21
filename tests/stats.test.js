import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, goalProgress, tastes, finishedReads } from '../js/lib/stats.js';

const read = (finishedAt, rating, extra = {}) => ({ startedAt: null, finishedAt, rating, formats: ['print'], ...extra });
const books = [
    { title: 'A', pageCount: 500, authors: [{ name: 'Ines Vahl' }], reads: [read('2024-09-10', 9), read('2026-03-21', 10, { startedAt: '2026-03-03', formats: ['print', 'audio'], moods: ['dark', 'epic'], scales: { tone: 'dark' } })] },
    { title: 'B', pageCount: 300, authors: [{ name: 'Ines Vahl' }], reads: [read('2026-09-05', 9, { moods: ['dark'], scales: { tone: 'dark' } })] },
    { title: 'C', pageCount: 400, authors: [{ name: 'Kenji Ard' }], reads: [read('2026-04-01', 7, { formats: ['ebook'], moods: ['dark', 'cosy'], scales: { tone: 'dark', pace: 'fast' } })] },
    { title: 'D', pageCount: 200, authors: [{ name: 'Lena Voss' }], reads: [read('2026-05-01', null)] },
    { title: 'E', authors: [{ name: 'X' }], reads: [{ startedAt: '2026-10-01', finishedAt: null }] },
];

test('re-reads count once per finished read, filtered by year', () => {
    assert.equal(finishedReads(books, 2026).length, 4);
    assert.equal(finishedReads(books).length, 5);
});

test('totals, months, ratings and formats for 2026', () => {
    const s = computeStats(books, { year: 2026 });
    assert.equal(s.books, 4);
    assert.equal(s.pages, 1400);
    assert.equal(s.averageRating, 8.7);
    assert.deepEqual(s.perMonth, [0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0]);
    assert.equal(s.ratingDistribution[9], 1);
    assert.equal(s.ratingDistribution[10], 1);
    assert.deepEqual(s.formats, { print: 3, ebook: 1, audio: 1, mixed: 1 });
    assert.equal(s.averageDaysToFinish, 19);
    assert.equal(s.topAuthors[0].name, 'Ines Vahl');
    assert.equal(s.topAuthors[0].average, 9.5);
    assert.equal(s.moods[0].mood, 'dark');
});

test('tastes need at least 3 rated books per mood or scale', () => {
    const t = tastes(finishedReads(books, 2026), 3);
    assert.deepEqual(t.map((x) => x.label), ['dark', 'Dark']);
    assert.equal(t[0].average, 8.7);
});

test('goal progress against an even pace', () => {
    const g = goalProgress(20, 24, '2026-10-19');
    assert.equal(g.expected, 19);
    assert.equal(g.aheadBy, 1);
    assert.equal(g.percent, 83);
    assert.equal(goalProgress(5, 0, '2026-10-19'), null);
});

test('year-only and undated reads (marked in bulk) count correctly', () => {
    const old = [
        { title: 'S1', pageCount: 300, authors: [{ name: 'A' }], reads: [{ finishedAt: null, finishedYear: 2019, rating: 8, formats: ['print'], bulk: true }] },
        { title: 'S2', pageCount: 300, authors: [{ name: 'A' }], reads: [{ finishedAt: null, finishedYear: 2019, rating: 8, formats: ['print'], bulk: true }] },
        { title: 'S3', pageCount: 300, authors: [{ name: 'A' }], reads: [{ finishedAt: null, dateUnknown: true, rating: 7, formats: ['print'], bulk: true }] },
        { title: 'Now', authors: [{ name: 'B' }], reads: [{ startedAt: '2026-10-01', finishedAt: null }] },
    ];
    const y2019 = computeStats(old, { year: 2019 });
    assert.equal(y2019.books, 2);
    assert.deepEqual(y2019.perMonth, Array(12).fill(0), 'no month for year-only reads');
    assert.equal(computeStats(old, { year: 2026 }).books, 0, 'undated reads are not in a specific year');
    assert.equal(computeStats(old).books, 3, 'all-time counts year-only and undated, not reads in progress');
});
