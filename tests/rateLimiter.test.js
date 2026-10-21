import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, parseRateLimit } from '../js/lib/rateLimiter.js';
import { keyboardInset } from '../js/keyboard.js';

function clock(start = 0) { let t = start; return { now: () => t, advance: (ms) => { t += ms; } }; }

test('burst of 10, then refills at one per second', () => {
    const c = clock();
    const l = createLimiter({ now: c.now });
    for (let i = 0; i < 10; i++) assert.ok(l.tryTake('interactive'), `request ${i + 1}`);
    assert.equal(l.tryTake('interactive'), false, '11th request in the same instant is held back');
    c.advance(1000);
    assert.ok(l.tryTake('interactive'));
    assert.equal(l.tryTake('interactive'), false);
});

test('background work keeps a reserve of 5 for interactive use', () => {
    const c = clock();
    const l = createLimiter({ now: c.now });
    let bg = 0;
    while (l.tryTake('background')) bg++;
    assert.equal(bg, 6, 'background stops once only 4 tokens would be left');
    let fg = 0;
    while (l.tryTake('interactive')) fg++;
    assert.equal(fg, 4, 'interactive can still use the reserve');
    assert.ok(l.waitMs('background') >= 4000);
});

test('sync with Hardcover and block after a 429', () => {
    const c = clock();
    const l = createLimiter({ now: c.now });
    l.sync(2, 0);
    assert.ok(l.available() <= 2);
    l.block(30);
    assert.equal(l.tryTake('interactive'), false);
    c.advance(29000);
    assert.equal(l.tryTake('interactive'), false);
    c.advance(2000);
    assert.ok(l.tryTake('interactive'));
    l.sync(0, 12);
    assert.ok(l.blockedFor() > 11000);
});

test('parse the RateLimit header', () => {
    assert.deepEqual(parseRateLimit('"Free";r=8;t=0, "daily";r=4231;t=51234'), { remaining: 8, reset: 0 });
    assert.deepEqual(parseRateLimit('"Free";r=0;t=7, "daily";r=4000;t=100'), { remaining: 0, reset: 7 });
    assert.deepEqual(parseRateLimit('"Free";r=8;t=0, "daily";r=3;t=99'), { remaining: 3, reset: 0 }, 'daily cap applies');
    assert.deepEqual(parseRateLimit('"daily";r=0;t=3600'), { remaining: 0, reset: 3600 }, 'daily used up');
    assert.equal(parseRateLimit(null), null);
});

test('keyboard inset from the visual viewport', () => {
    assert.equal(keyboardInset({ innerHeight: 874, vvHeight: 874 }), 0);
    assert.equal(keyboardInset({ innerHeight: 874, vvHeight: 538, vvOffsetTop: 0 }), 336);
    assert.equal(keyboardInset({ innerHeight: 874, vvHeight: 538, vvOffsetTop: 40 }), 296, 'page scrolled up under the keyboard');
    assert.equal(keyboardInset({ innerHeight: 874, vvHeight: 900 }), 0, 'never negative');
    assert.equal(keyboardInset({}), 0);
});
