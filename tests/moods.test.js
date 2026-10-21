import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestMoods, genreMoods, suggestionNote, MOODS } from '../js/lib/moods.js';
import { tagsInCategory } from '../js/lib/normalize.js';

test('fantasy and thriller books get different suggestions', () => {
    const fantasy = suggestMoods({ genres: ['Fantasy', 'Epic Fantasy'] }).map((s) => s.mood);
    const thriller = suggestMoods({ genres: ['Thriller', 'Crime'] }).map((s) => s.mood);
    assert.ok(fantasy.includes('epic') && fantasy.includes('adventurous'));
    assert.ok(thriller.includes('tense') && thriller.includes('twisty'));
    assert.notDeepEqual(fantasy, thriller);
});

test('community moods come first, then genre, then your own history; de-duplicated', () => {
    const history = [
        { key: 'a', genres: ['Fantasy'], reads: [{ moods: ['political', 'epic'] }, { moods: ['political'] }] },
        { key: 'b', genres: ['Romance'], reads: [{ moods: ['steamy'] }] },
    ];
    const s = suggestMoods({ key: 'x', communityMoods: ['Adventurous', 'Hopeful'], genres: ['Fantasy'] }, { history });
    assert.deepEqual(s.slice(0, 2), [{ mood: 'adventurous', source: 'readers' }, { mood: 'hopeful', source: 'readers' }]);
    assert.ok(s.some((x) => x.mood === 'epic' && x.source === 'genre'));
    assert.ok(s.some((x) => x.mood === 'political' && x.source === 'you'), 'moods you used on other fantasy books');
    assert.ok(!s.some((x) => x.mood === 'steamy'), 'romance-only history is not suggested for fantasy');
    assert.equal(new Set(s.map((x) => x.mood)).size, s.length);
    assert.ok(s.length <= 8);
});

test('mood names are normalised and notes describe the source', () => {
    assert.equal(suggestMoods({ communityMoods: ['Slow Burn'] })[0].mood, 'slow-burn');
    assert.equal(suggestionNote([{ source: 'readers' }, { source: 'genre' }]), 'From Hardcover readers and its genres');
    assert.equal(suggestionNote([{ source: 'genre' }]), 'Moods that fit its genres');
    assert.equal(suggestionNote([]), null);
    assert.ok(genreMoods(['Science Fiction']).includes('thought-provoking'));
    assert.ok(!genreMoods(['Science Fiction']).includes('informative'), 'science fiction is not non-fiction');
    assert.ok(genreMoods(['Popular Science']).includes('informative'));
    assert.ok(MOODS.Feel.length + MOODS.Style.length >= 25);
});

test('cached_tags: keyed-by-category and flat-list shapes, ordered by count', () => {
    const keyed = { Mood: [{ tag: 'Hopeful', count: 3 }, { tag: 'Dark', count: 40 }], Genre: [{ tag: 'Fantasy', count: 90 }], 'Content Warning': [{ tag: 'Violence', count: 5 }] };
    assert.deepEqual(tagsInCategory(keyed, 'Mood'), ['Dark', 'Hopeful']);
    assert.deepEqual(tagsInCategory(keyed, 'Content Warning'), ['Violence']);
    const flat = [{ tag: 'Tense', category: 'Mood', count: 2 }, { tag: 'Thriller', category: 'Genre', count: 9 }, { tag: 'Twisty', category: 'mood', count: 7 }];
    assert.deepEqual(tagsInCategory(flat, 'Mood'), ['Twisty', 'Tense']);
    assert.deepEqual(tagsInCategory(JSON.stringify(flat), 'Genre'), ['Thriller']);
    assert.deepEqual(tagsInCategory({ Moods: ['Cosy'] }, 'Mood'), ['Cosy']);
    assert.deepEqual(tagsInCategory(null, 'Mood'), []);
});
