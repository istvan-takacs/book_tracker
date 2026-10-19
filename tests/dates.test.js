import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precisionOf, fromGooglePublished, formatRelease, relativeDays, timeframe, effectiveRelease, daysBetween, formatDay } from '../js/lib/dates.js';

const TODAY = '2026-10-19';

test('precision: day, year-only, and future placeholder dates', () => {
    assert.deepEqual(precisionOf({ date: '2026-10-22' }, TODAY), { date: '2026-10-22', precision: 'day' });
    assert.deepEqual(precisionOf({ year: 2027 }, TODAY), { date: '2027-01-01', precision: 'year' });
    assert.deepEqual(precisionOf({ date: '2027-12-31' }, TODAY), { date: '2027-12-31', precision: 'year' });
    assert.deepEqual(precisionOf({ date: '2021-01-01' }, TODAY), { date: '2021-01-01', precision: 'day' }, 'past 1 Jan is a real date');
    assert.deepEqual(precisionOf({}, TODAY), { date: null, precision: 'none' });
});

test('Google publishedDate precision', () => {
    assert.equal(fromGooglePublished('2027').precision, 'year');
    assert.equal(fromGooglePublished('2027-03').precision, 'month');
    assert.deepEqual(fromGooglePublished('2027-03-14'), { date: '2027-03-14', precision: 'day' });
});

test('labels use full words', () => {
    assert.equal(formatRelease({ date: '2026-10-22', precision: 'day' }, TODAY), 'Thursday 22 October');
    assert.equal(formatRelease({ date: '2027-02-03', precision: 'day' }, TODAY), 'Wednesday 3 February 2027');
    assert.equal(formatRelease({ date: '2027-03-01', precision: 'month' }, TODAY), 'Expected March 2027');
    assert.equal(formatRelease({ date: '2027-01-01', precision: 'year' }, TODAY), 'Expected some time in 2027');
    assert.equal(formatDay('2026-10-05', TODAY, { weekday: false }), '5 October');
});

test('relative days', () => {
    assert.equal(relativeDays(0), 'today');
    assert.equal(relativeDays(1), 'tomorrow');
    assert.equal(relativeDays(3), 'in 3 days');
    assert.equal(relativeDays(107), 'in 15 weeks');
    assert.equal(relativeDays(-14), '2 weeks ago');
    assert.equal(relativeDays(-1), 'yesterday');
    assert.equal(daysBetween('2026-10-19', '2027-02-03'), 107);
});

test('timeline buckets', () => {
    assert.equal(timeframe({ date: '2026-10-22', precision: 'day' }, TODAY), 'thisWeek');
    assert.equal(timeframe({ date: '2026-10-29', precision: 'day' }, TODAY), 'thisMonth');
    assert.equal(timeframe({ date: '2026-11-02', precision: 'day' }, TODAY), 'later');
    assert.equal(timeframe({ date: '2026-10-05', precision: 'day' }, TODAY), 'recent');
    assert.equal(timeframe({ date: '2026-08-01', precision: 'day' }, TODAY), 'past');
    assert.equal(timeframe({ date: '2027-01-01', precision: 'year' }, TODAY), 'later');
});

test('a manual release date always wins', () => {
    const book = { releaseDate: '2027-01-01', datePrecision: 'year', releaseDateOverride: { date: '2027-04-15' } };
    assert.deepEqual(effectiveRelease(book), { date: '2027-04-15', precision: 'day', manual: true });
    assert.deepEqual(effectiveRelease({ releaseDate: '2027-01-01', datePrecision: 'year' }), { date: '2027-01-01', precision: 'year', manual: false });
});
