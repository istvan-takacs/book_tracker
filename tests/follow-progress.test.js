import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followDefault, resolveFollow, followHint } from '../js/lib/follow.js';
import { describe, toFraction, formatDuration, availableModes, stepFor } from '../js/lib/progress.js';

test('follow defaults: on for 6+, off for 5 or lower, override wins', () => {
    assert.equal(followDefault(6), true);
    assert.equal(followDefault(5), false);
    assert.equal(followDefault(null), false);
    assert.equal(resolveFollow(3, true), true);
    assert.equal(resolveFollow(9, false), false);
    assert.match(followHint(4, false), /5 or lower/);
    assert.match(followHint(4, true), /yourself/);
});

test('progress stays in step across page, percent and audio time', () => {
    const book = { pages: 388, audioSeconds: 680 * 60 };
    const d = describe(212 / 388, book);
    assert.equal(d.page, 212);
    assert.equal(d.percent, 55);
    assert.equal(formatDuration(d.audioSeconds), '6 h 12 min');
    assert.equal(toFraction('page', 194, book), 0.5);
    assert.equal(toFraction('time', 340 * 60, book), 0.5);
    assert.equal(toFraction('percent', 150), 1, 'clamped');
    assert.deepEqual(availableModes(book), ['page', 'percent', 'time']);
    assert.deepEqual(availableModes({ pages: 300 }), ['page', 'percent']);
    assert.equal(stepFor('time', book), 300 / (680 * 60));
    assert.equal(formatDuration(45 * 60), '45 min');
});
