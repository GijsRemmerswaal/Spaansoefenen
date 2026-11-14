/* Classic script: shared browser/offline validation contract. No DOM or network. */
(function (global) {
  'use strict';
  const fail = (ok, message) => { if (!ok) throw new Error(message); };
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const text = x => typeof x === 'string' && x.trim().length > 0;
  const normalize = x => x.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const unique = xs => new Set(xs).size === xs.length;
  const statuses = ['valid', 'missing_source', 'unverified', 'defective', 'not_applicable'];
  function entry(e) {
    fail(object(e) && statuses.includes(e.status) && Array.isArray(e.accepted), 'Invalid slot status');
    fail(e.accepted.every(text) && unique(e.accepted.map(normalize)), 'Empty/duplicate accepted forms');
    fail(e.status === 'valid' ? e.accepted.length > 0 : e.accepted.length === 0 && text(e.reason), 'Status/answers mismatch');
    if (['defective', 'not_applicable'].includes(e.status)) fail(text(e.evidence), 'Missing applicability evidence');
  }
  function registry(forms) {
    fail(object(forms), 'Missing registry');
    const mandatory = {
      indicative: ['present', 'preterite', 'imperfect', 'present_perfect', 'future', 'pluperfect', 'future_perfect', 'conditional', 'conditional_perfect', 'preterite_anterior'],
      subjunctive: ['present', 'imperfect', 'present_perfect', 'pluperfect', 'future', 'future_perfect'],
      imperative: ['affirmative', 'negative'],
      nonfinite: ['infinitive', 'gerund', 'participle', 'compound_infinitive', 'compound_gerund']
    };
    for (const [mood, names] of Object.entries(mandatory)) for (const name of names) {
      const f = forms[mood + '.' + name];
      fail(f && f.mood === mood && f.exerciseKind === (['indicative', 'subjunctive'].includes(mood) ? 'finite' : mood), 'Required form missing/mistyped');
    }
    const persons = ['1s', '2s', '3s', '1p', '2p', '3p'];
    const commands = ['2s', '3s_formal', '1p', '2p', '3p_formal'];
    for (const [id, f] of Object.entries(forms)) {
      fail(f.formId === id && ['finite', 'imperative', 'nonfinite', 'construction'].includes(f.exerciseKind), 'Unknown form/kind');
      fail(text(f.labelEs) && text(f.mood) && text(f.helpDisplayType), 'Missing form metadata');
      fail(['exerciseEnabled', 'isCompound', 'isHistorical'].every(k => typeof f[k] === 'boolean'), 'Invalid form flags');
      fail(Array.isArray(f.slotIds) && f.slotIds.every(text) && unique(f.slotIds), 'Invalid slot registry');
      fail(Array.isArray(f.variantIds) && f.variantIds.length && f.variantIds.every(text) && unique(f.variantIds), 'Invalid variants');
      if (f.exerciseKind === 'finite') fail(same(f.slotIds, persons), 'Finite slots');
      if (f.exerciseKind === 'imperative') fail(same(f.slotIds, commands), 'Imperative slots');
      if (f.exerciseKind === 'nonfinite') fail(f.slotIds.length === 0, 'Nonfinite cannot have persons');
    }
  }
  function verbs(data, forms) {
    registry(forms);
    fail(object(data), 'Missing verbs');
    const expected = Object.keys(forms).filter(id => forms[id].exerciseKind !== 'construction');
    for (const [id, v] of Object.entries(data)) {
      fail(v.id === id && v.infinitive === id, 'Verb identity');
      fail(typeof v.isReflexive === 'boolean' && [true, false, null].includes(v.isIrregularVerb) && text(v.regularityEvidence), 'Verb classification');
      fail(object(v.forms) && same(Object.keys(v.forms), expected), 'Unknown/missing form');
      for (const [fid, slots] of Object.entries(v.forms)) {
        const f = forms[fid];
        fail(object(slots) && same(Object.keys(slots), f.slotIds.length ? f.slotIds : ['value']), 'Unexpected/missing slot');
        for (const e of Object.values(slots)) {
          entry(e);
          fail(object(e.variants) && same(Object.keys(e.variants), f.variantIds), 'Missing variants');
          const accepted = [];
          for (const variant of Object.values(e.variants)) {
            entry(variant);
            fail(text(variant.sourcePath) && text(variant.evidence), 'Missing provenance');
            accepted.push(...variant.accepted);
          }
          fail(same(e.accepted.map(normalize), [...new Set(accepted.map(normalize))]), 'Variant union mismatch');
        }
      }
    }
  }
  function constructions(records, data, forms) {
    fail(Array.isArray(records), 'Invalid constructions');
    const ids = new Set();
    const allowed = ['id', 'verbId', 'formId', 'slotId', 'status', 'accepted', 'reason', 'evidence', 'reviewed', 'fixtureOnly'];
    for (const r of records) {
      fail(object(r) && Object.keys(r).every(k => allowed.includes(k)), 'Unknown construction field');
      const f = forms[r.formId];
      fail(text(r.id) && !ids.has(r.id), 'Duplicate construction'); ids.add(r.id);
      fail(Object.hasOwn(data, r.verbId) && f?.exerciseKind === 'construction', 'Unknown construction reference');
      fail(f.slotIds.length ? f.slotIds.includes(r.slotId) : !Object.hasOwn(r, 'slotId'), 'Construction slot');
      entry(r);
      fail(r.reviewed === true && text(r.evidence) && typeof r.fixtureOnly === 'boolean', 'Unreviewed construction');
    }
  }
  function contexts(groups, data, forms, records = []) {
    fail(Array.isArray(groups), 'Invalid context groups');
    constructions(records, data, forms);
    const seen = new Set(), owners = new Set(), items = [];
    const allowed = ['id', 'exerciseKind', 'slotId', 'spanishBase', 'spanishByFormId', 'supportedFormIds', 'translationsNl', 'variantByFormId', 'constructionByFormId', 'reviewed', 'reviewNote', 'fixtureOnly'];
    for (const group of groups) {
      fail(object(group) && same(Object.keys(group), ['verbId', 'contexts']), 'Group must contain only verbId and contexts');
      fail(Object.hasOwn(data, group.verbId) && !owners.has(group.verbId), 'Unknown/duplicate context owner');
      owners.add(group.verbId);
      fail(Array.isArray(group.contexts), 'Missing contexts');
      for (const c of group.contexts) {
        fail(object(c) && Object.keys(c).every(k => allowed.includes(k)), 'Forbidden context field');
        fail(text(c.id) && c.id.startsWith(group.verbId + ':') && !seen.has(c.id), 'Context identity/owner mismatch'); seen.add(c.id);
        fail(c.reviewed === true && text(c.reviewNote) && typeof c.fixtureOnly === 'boolean', 'Unreviewed context');
        fail(Array.isArray(c.supportedFormIds) && c.supportedFormIds.length && unique(c.supportedFormIds), 'Invalid supported forms');
        fail(object(c.translationsNl) && same(Object.keys(c.translationsNl), c.supportedFormIds), 'Missing/extra NL translation');
        for (const key of ['spanishByFormId', 'variantByFormId', 'constructionByFormId']) {
          fail(c[key] === undefined || object(c[key]) && Object.keys(c[key]).every(id => c.supportedFormIds.includes(id)), 'Unknown override form');
        }
        for (const fid of c.supportedFormIds) {
          const f = forms[fid];
          fail(f && c.exerciseKind === f.exerciseKind, 'Unknown/mismatched exercise kind');
          fail(f.slotIds.length ? f.slotIds.includes(c.slotId) : !Object.hasOwn(c, 'slotId'), 'Invalid context slot');
          const template = c.spanishByFormId?.[fid] ?? c.spanishBase;
          fail(text(template) && template.split('{{answer}}').length === 2 && !template.replace('{{answer}}', '').includes('{{'), 'Exactly one answer placeholder required');
          fail(text(c.translationsNl[fid]), 'Empty NL translation');
          let e;
          if (f.exerciseKind === 'construction') {
            e = records.find(r => r.id === c.constructionByFormId?.[fid]);
            fail(e && e.verbId === group.verbId && e.formId === fid && e.slotId === c.slotId, 'Construction binding mismatch');
            fail(c.fixtureOnly || !e.fixtureOnly, 'Fixture construction in production');
            fail(!c.variantByFormId, 'Construction variants belong in separate explicit records');
          } else {
            fail(!c.constructionByFormId, 'Construction binding on verb form');
            e = data[group.verbId].forms[fid][c.slotId ?? 'value'];
            const variant = c.variantByFormId?.[fid];
            if (variant !== undefined) {
              fail(f.variantIds.includes(variant), 'Unknown variant');
              e = e.variants[variant];
            }
          }
          fail(e?.status === 'valid' && e.accepted.length > 0, 'Unavailable answer');
          const item = {id: c.id + '/' + fid, verbId: group.verbId, contextId: c.id,
            exerciseKind: f.exerciseKind, formId: fid, spanishTemplate: template,
            acceptedAnswers: [...e.accepted], translationNl: c.translationsNl[fid],
            enabled: f.exerciseEnabled, fixtureOnly: c.fixtureOnly};
          if (f.slotIds.length) item.slotId = c.slotId;
          items.push(item);
        }
      }
    }
    return items;
  }
  function validate(dataset, forms, groups = [], records = []) {
    fail(dataset.metadata?.schemaVersion === 1 && ['test_subset', 'full'].includes(dataset.metadata.scope), 'Unsupported dataset');
    verbs(dataset.verbs, forms);
    if (dataset.metadata.scope === 'test_subset') fail(groups.every(g => g.contexts.every(c => c.fixtureOnly === true)), 'Test subset cannot contain production contexts');
    return contexts(groups, dataset.verbs, forms, records);
  }
  function available(items, data, {includeFixtures = false, categories = ['regular', 'irregular']} = {}) {
    return items.filter(i => i.enabled && (includeFixtures || !i.fixtureOnly) &&
      data[i.verbId].isIrregularVerb !== null && categories.includes(data[i.verbId].isIrregularVerb ? 'irregular' : 'regular'));
  }
  global.SpanishTrainerValidation = Object.freeze({validate, registry, verbs, contexts, constructions, available});
})(globalThis);
