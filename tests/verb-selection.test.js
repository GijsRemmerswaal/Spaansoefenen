// Run from the project root with node --test tests/verb-selection.test.js.
const assert = require('node:assert/strict');
const { test } = require('node:test');
for (const file of ['data/forms', 'data/verbs', 'data/sentences', 'data/constructions', 'js/validation', 'js/exercises']) {
  require('../' + file + '.js');
}
const data = globalThis.SPANISH_TRAINER_DATA;
const forms = data.EXERCISE_FORMS;
const engine = SpanishTrainerExercises.createEngine({
  dataset: {metadata: data.metadata, verbs: data.verbs}, forms, contexts: data.sentences, constructions: data.constructions
});
const present = 'indicative.present';

test('each ending and combinations select the union of the corresponding playable verbs', () => {
  const all = engine.availableVerbIds();
  const groups = {};
  for (const [ending, example] of [['ar', 'hablar'], ['er', 'comer'], ['ir', 'vivir']]) {
    groups[ending] = engine.availableVerbIds({conjugationGroups: [ending]});
    assert.ok(groups[ending].includes(example));
    assert.deepEqual(groups[ending], all.filter(id => id.normalize('NFD').replace(/\p{M}/gu, '').replace(/se$/u, '').endsWith(ending)));
  }
  assert.ok(groups.ar.includes('levantarse') && groups.ar.includes('acostarse'));
  assert.deepEqual(new Set(engine.availableVerbIds({conjugationGroups: ['ar', 'ir']})), new Set([...groups.ar, ...groups.ir]));
  assert.deepEqual(new Set(all), new Set(Object.values(groups).flat()));
});

test('accented and reflexive infinitives use their base ending even with missing group metadata', () => {
  const ids = ['oír', 'reír', 'sentirse'];
  const verbs = {}, contexts = [];
  for (const id of ids) {
    verbs[id] = {...data.verbs[id], group: null, isIrregularVerb: true};
    contexts.push({verbId: id, contexts: [{id: id + ':test', exerciseKind: 'finite', slotId: '1s',
      spanishBase: 'Yo {{answer}}.', supportedFormIds: [present], translationsNl: {[present]: 'Testzin.'},
      reviewed: true, reviewNote: 'Testcontext', fixtureOnly: true}]});
  }
  const fixture = SpanishTrainerExercises.createEngine({dataset: {metadata: {scope: 'test_subset', schemaVersion: 1}, verbs}, forms, contexts});
  assert.deepEqual(fixture.availableVerbIds({conjugationGroups: ['ir']}), []);
  assert.deepEqual(fixture.availableVerbIds({conjugationGroups: ['ir'], includeFixtures: true}), ids);
  assert.deepEqual(fixture.availableVerbIds({conjugationGroups: ['er', 'ar'], includeFixtures: true}), []);
});

test('the picker follows playable sentences and tense coverage', () => {
  const ids = engine.availableVerbIds({formIds: [present]});
  assert.deepEqual(new Set(ids), new Set(engine.select({formIds: [present]}).map(item => item.verbId)));
  assert.ok(Object.hasOwn(data.verbs, 'acceder') && !ids.includes('acceder'));
  assert.ok(ids.includes('llamarse'));
  assert.ok(!engine.availableVerbIds({formIds: ['indicative.preterite']}).includes('llamarse'));
});

test('individual verbs intersect with tense, regularity and ending', () => {
  const opts = {formIds: [present], categories: ['irregular'], conjugationGroups: ['ir'], verbIds: ['pedir', 'ir', 'hablar', 'vivir', 'ser']};
  const items = engine.select(opts);
  assert.deepEqual(new Set(items.map(i => i.verbId)), new Set(['ir', 'pedir']));
  assert.ok(items.every(i => i.formId === present));
  assert.deepEqual(new Set(engine.availableVerbIds({...opts, categories: ['regular']})), new Set(['vivir']));
  assert.ok(engine.availableVerbIds({...opts, verbIds: undefined}).length > 2);
});

test('empty filters and unavailable combinations cannot start or advance a session', () => {
  for (const opts of [{formIds: []}, {categories: []}, {conjugationGroups: []}, {verbIds: []},
    {verbIds: ['acceder']}, {categories: ['irregular'], verbIds: ['hablar']}]) {
    const session = engine.createSession(opts);
    assert.deepEqual(engine.availableVerbIds(opts), []);
    assert.equal(session.state().status, 'empty');
    assert.equal(session.state().canNext, false);
    assert.deepEqual(session.next(), session.state());
  }
});

test('filtered sessions check answers, exhaust each shuffled round and avoid immediate repeats', () => {
  const opts = {formIds: [present], verbIds: ['hablar', 'comer']};
  const pool = engine.select(opts);
  const session = engine.createSession(opts, () => 0);
  const first = session.state().item.id;
  const seen = new Set();
  let last;
  for (const _ of pool) {
    const {item} = session.state();
    assert.ok(!seen.has(item.id));
    seen.add(item.id);
    assert.ok(session.next().navigationBlocked);
    assert.equal(session.check('???').feedback.status, 'incorrect');
    const [answer] = engine.resolveExerciseAnswer(item.id);
    assert.equal(session.check(answer).feedback.status, 'correct');
    assert.ok(session.showAnswer().revealed.translationNl);
    assert.ok(session.help().rows.length);
    last = item.id;
    session.next();
  }
  assert.deepEqual(seen, new Set(pool.map(i => i.id)));
  assert.ok(session.state().cycleRestarted);
  assert.notEqual(session.state().item.id, last);
  assert.notEqual(engine.createSession(opts, () => 0.99).state().item.id, first);
  assert.equal(SpanishTrainerExercises.compareAnswer('oi', ['oí']).status, 'accent_only');
});

test('a session counts each presented exercise once, on its first correct check or reveal', () => {
  const options = {formIds: [present], verbIds: ['hablar']};
  const session = engine.createSession(options);
  assert.equal(session.state().completedCount, 0);
  assert.equal(session.next().completedCount, 0);
  for (let count = 1; count <= 3; count++) {
    const [answer] = engine.resolveExerciseAnswer(session.state().item.id);
    assert.equal(session.check('???').completedCount, count - 1);
    assert.equal(session.check('').completedCount, count - 1);
    assert.equal(session.check(answer).completedCount, count);
    assert.equal(session.check(answer).completedCount, count);
    assert.equal(session.showAnswer().completedCount, count);
    assert.equal(session.next().completedCount, count);
  }
  assert.equal(session.showAnswer().completedCount, 4);
  assert.equal(session.showAnswer().completedCount, 4);
  const [revealedAnswer] = session.state().revealed.acceptedAnswers;
  assert.equal(session.check(revealedAnswer).completedCount, 4);
  assert.equal(engine.createSession(options).state().completedCount, 0);
});
