/* Offline exercise core. Load validation.js first; no DOM, storage or conjugation. */
(function (global) {
  'use strict';
  const require = (ok, message) => { if (!ok) throw new Error(message); };
  const copy = value => JSON.parse(JSON.stringify(value));
  const normalize = value => value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
  const acute = value => value.replace(/[áéíóú]/gu, c => ({á:'a', é:'e', í:'i', ó:'o', ú:'u'})[c]);
  const feedback = {
    correct: 'Goed!',
    accent_only: 'Bijna goed: controleer je accenttekens.',
    incorrect: 'Nog niet goed. Probeer het opnieuw.'
  };
  function compareAnswer(input, accepted) {
    require(typeof input === 'string', 'Antwoord moet tekst zijn.');
    require(Array.isArray(accepted) && accepted.length > 0 && accepted.every(a => typeof a === 'string' && a.trim()), 'Geen geldige antwoorden beschikbaar.');
    const answer = normalize(input), alternatives = accepted.map(normalize);
    // Check every exact alternative before checking accents: a second alternative may match exactly.
    const status = alternatives.includes(answer) ? 'correct' : alternatives.some(a => acute(a) === acute(answer)) ? 'accent_only' : 'incorrect';
    return {status, message: feedback[status]};
  }
  function randomIndex(length, random) {
    const value = random();
    require(Number.isFinite(value) && value >= 0 && value < 1, 'Toevalsbron moet een getal in [0, 1) leveren.');
    return Math.floor(value * length);
  }
  function shuffled(items, random) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1, random);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function createEngine({dataset, forms, contexts = [], constructions = []}) {
    require(global.SpanishTrainerValidation, 'Laad validation.js eerst.');
    // Own a snapshot: edits to caller-owned configuration cannot change an active exercise.
    const data = copy(dataset), registry = copy(forms), groups = copy(contexts), records = copy(constructions);
    const V = global.SpanishTrainerValidation;
    const items = V.validate(data, registry, groups, records);
    const byId = new Map(items.map(i => [i.id, i]));
    require(byId.size === items.length, 'Dubbele oefening-ID.');
    const contextById = new Map(groups.flatMap(g => g.contexts.map(c => [c.id, c])));
    const kinds = ['finite', 'imperative', 'nonfinite', 'construction'];
    function itemFor(id) {
      require(typeof id === 'string' && byId.has(id), 'Onbekende oefening.');
      return byId.get(id);
    }
    function lookupVerbForm(verbId, formId, slotId, variant) {
      require(Object.hasOwn(data.verbs, verbId) && Object.hasOwn(registry, formId), 'Onbekend werkwoord of vorm.');
      const f = registry[formId];
      require(f.exerciseKind !== 'construction', 'Constructies vereisen een expliciet contextgebonden antwoord.');
      require(f.slotIds.length ? f.slotIds.includes(slotId) : slotId === undefined, 'Ongeldig persoonslot.');
      require(variant === undefined || f.variantIds.includes(variant), 'Onbekende variant.');
      const slot = data.verbs[verbId].forms[formId][slotId ?? 'value'];
      const entry = variant === undefined ? slot : slot.variants[variant];
      return copy({status: entry.status, accepted: entry.accepted, reason: entry.reason});
    }
    function select(options = {}) {
      require(options && typeof options === 'object' && !Array.isArray(options), 'Ongeldige selectie.');
      require(Object.keys(options).every(k => ['formIds', 'categories', 'exerciseKinds', 'includeFixtures'].includes(k)), 'Onbekend selectiefilter.');
      const {formIds = Object.keys(registry), categories = ['regular', 'irregular'], exerciseKinds = kinds, includeFixtures = false} = options;
      for (const [chosen, allowed] of [[formIds, Object.keys(registry)], [categories, ['regular', 'irregular']], [exerciseKinds, kinds]]) {
        require(Array.isArray(chosen) && new Set(chosen).size === chosen.length && chosen.every(x => allowed.includes(x)), 'Onbekende of dubbele filterwaarde.');
      }
      require(typeof includeFixtures === 'boolean', 'Fixturekeuze moet boolean zijn.');
      return copy(V.available(items, data.verbs, {categories, includeFixtures})
        .filter(i => formIds.includes(i.formId) && exerciseKinds.includes(i.exerciseKind)));
    }
    function availability(options = {}) {
      const selected = select(options);
      return Object.values(registry).map(f => ({formId: f.formId, exerciseKind: f.exerciseKind,
        configured: f.exerciseEnabled, selectable: selected.some(i => i.formId === f.formId)}));
    }
    function resolveExerciseAnswer(id) { return [...itemFor(id).acceptedAnswers]; }
    function resolveExerciseHelp(id) {
      const i = itemFor(id), f = registry[i.formId], c = contextById.get(i.contextId);
      const rows = [];
      if (f.exerciseKind === 'construction') {
        for (const r of records) if (r.verbId === i.verbId && r.formId === i.formId && r.status === 'valid' && (i.fixtureOnly || !r.fixtureOnly)) {
          const row = {recordId: r.id, accepted: [...r.accepted]};
          if (f.slotIds.length) row.slotId = r.slotId;
          rows.push(row);
        }
      } else {
        for (const slot of f.slotIds.length ? f.slotIds : [undefined]) {
          const entry = lookupVerbForm(i.verbId, i.formId, slot, c.variantByFormId?.[i.formId]);
          if (entry.status === 'valid') {
            const row = {accepted: entry.accepted};
            if (slot !== undefined) row.slotId = slot;
            rows.push(row);
          }
        }
      }
      return {verbId: i.verbId, formId: i.formId, exerciseKind: i.exerciseKind, labelEs: f.labelEs,
        displayType: 'stored_forms', rows};
    }
    function createSession(options = {}, random = Math.random) {
      require(typeof random === 'function', 'Ongeldige toevalsbron.');
      const pool = select(options);
      let queue = [], current = null, unlocked = false, revealed = false, result = null, cycleRestarted = false;
      function advance() {
        const previous = current?.id;
        cycleRestarted = queue.length === 0 && current !== null;
        if (!queue.length) {
          queue = shuffled(pool, random);
          if (queue.length > 1 && queue[0].id === previous) {
            const j = 1 + randomIndex(queue.length - 1, random);
            [queue[0], queue[j]] = [queue[j], queue[0]];
          }
        }
        current = queue.shift() ?? null;
        unlocked = false; revealed = false; result = null;
      }
      function state() {
        if (!current) return {status: 'empty', canNext: false, message: 'Geen oefeningen beschikbaar voor deze selectie.', cycleRestarted: false};
        const {acceptedAnswers, translationNl, ...prompt} = current;
        const view = {status: 'active', item: prompt, canNext: unlocked, feedback: result,
          cycleRestarted, message: cycleRestarted ? 'Nieuwe willekeurige oefenronde gestart.' : ''};
        if (revealed) view.revealed = {acceptedAnswers, translationNl};
        return copy(view);
      }
      function check(input) {
        require(current, 'Geen actieve oefening.');
        result = compareAnswer(input, current.acceptedAnswers);
        if (result.status === 'correct') unlocked = true;
        return state();
      }
      function showAnswer() {
        require(current, 'Geen actieve oefening.');
        revealed = true; unlocked = true;
        return state();
      }
      function next() {
        if (!current) return state();
        if (!unlocked) return {...state(), navigationBlocked: true};
        advance();
        return state();
      }
      function help() {
        require(current, 'Geen actieve oefening.');
        return resolveExerciseHelp(current.id);
      }
      advance();
      return Object.freeze({state, check, showAnswer, next, help});
    }
    return Object.freeze({select, availability, lookupVerbForm, resolveExerciseAnswer, resolveExerciseHelp, createSession});
  }
  global.SpanishTrainerExercises = Object.freeze({createEngine, compareAnswer});
})(globalThis);
