/* Presentation only: the tested exercise engine owns selection, checking and navigation. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  function fatal(error) {
    $('fatal').textContent = 'De oefengegevens konden niet worden geladen. Open index.html vanuit de volledige projectmap. Details: ' + error.message;
    $('fatal').hidden = false;
    $('start-button').disabled = true;
    $('start-screen').hidden = true;
    $('exercise-screen').hidden = true;
  }
  try {
    const data = globalThis.SPANISH_TRAINER_DATA;
    const usingDemo = data?.metadata?.scope === 'test_subset' && data.demo?.fixtureOnly === true;
    if (!usingDemo && data?.metadata?.scope !== 'full') throw new Error('De volledige werkwoordendatabase ontbreekt.');
    const setup = usingDemo ? data.demo : {
      forms: data.EXERCISE_FORMS, contexts: data.sentences, constructions: data.constructions,
      defaultFormIds: Object.keys(data.EXERCISE_FORMS).filter(id => data.EXERCISE_FORMS[id].exerciseEnabled)
    };
    const forms = setup.forms;
    if (!usingDemo && setup.contexts.some(g => g.contexts.some(c => c.fixtureOnly))) throw new Error('Testcontexten in productiegegevens.');
    const engine = SpanishTrainerExercises.createEngine({dataset: {metadata:data.metadata,verbs:data.verbs}, forms, contexts: setup.contexts, constructions: setup.constructions});
    document.body.dataset.mode = usingDemo ? 'demo' : 'production';
    if (usingDemo) {
      document.querySelector('.demo-tag').textContent = 'Testversie';
      document.querySelector('.demo-notice p').textContent = 'Je oefent met een kleine, gecontroleerde testset. De volledige oefeninhoud staat op de hoofdpagina.';
      document.querySelector('.pill').textContent = 'Testoefening';
    }
    let session = null, selection = {start: 0, end: 0};
    const input = $('answer'), dialog = $('help-dialog');
    const persons = {'1s':'yo','2s':'tú','3s':'él / ella / usted','1p':'nosotros / nosotras','2p':'vosotros / vosotras','3p':'ellos / ellas / ustedes','3s_formal':'usted','3p_formal':'ustedes'};
    const contextById = new Map(setup.contexts.flatMap(g => g.contexts.map(c => [c.id, c])));
    const checkboxes = new Map();
    function option(fid, checked, parent) {
      const label = document.createElement('label'); label.className = 'check-card';
      const check = document.createElement('input'); check.type = 'checkbox'; check.name = 'form'; check.value = fid; check.checked = checked;
      const span = document.createElement('span'); span.className = 'form-label';
      const es = document.createElement('span'); es.textContent = forms[fid].labelEs; es.lang = 'es';
      const nl = document.createElement('small'); nl.textContent = forms[fid].labelNl || ''; nl.lang = 'nl';
      span.append(es, nl);
      label.append(check, span); parent.append(label); checkboxes.set(fid, check);
    }
    setup.defaultFormIds.forEach(fid => option(fid, true, $('main-forms')));
    const possible = engine.availability({includeFixtures: usingDemo});
    for (const [mood, title] of [['indicative','Indicativo / condicional'],['subjunctive','Subjuntivo'],['imperative','Imperativo'],['nonfinite','Niet-persoonsgebonden'],['construction','Constructies']]) {
      const section = document.createElement('section'), heading = document.createElement('h3'); heading.textContent = title; section.append(heading);
      const grid = document.createElement('div'); grid.className = 'time-grid'; section.append(grid);
      const ids = possible.filter(x => x.selectable && forms[x.formId].mood === mood && !setup.defaultFormIds.includes(x.formId)).map(x => x.formId);
      ids.forEach(fid => option(fid, false, grid));
      if (!ids.length) { const p = document.createElement('p'); p.className = 'field-note'; p.textContent = 'Nog geen oefeningen.'; section.append(p); }
      $('extra-groups').append(section);
    }
    function options() {
      return {includeFixtures: usingDemo,
        formIds: [...checkboxes].filter(([,c]) => c.checked && !c.disabled).map(([id]) => id),
        categories: [...document.querySelectorAll('input[name="category"]:checked')].map(c => c.value)};
    }
    function updateSelection() {
      const opts = options();
      const availability = engine.availability({includeFixtures: usingDemo, categories: opts.categories});
      for (const {formId, selectable} of availability) if (checkboxes.has(formId)) {
        const c = checkboxes.get(formId); c.disabled = !selectable;
        c.parentElement.title = selectable ? '' : 'Geen oefeningen bij deze werkwoordselectie.';
      }
      const available = engine.select(options()).length > 0;
      $('start-button').disabled = !available;
      $('selection-message').textContent = available ? 'Je kunt beginnen. Neem de tijd voor elke zin.' :
        opts.categories.length === 1 && opts.categories[0] === 'irregular' && !availability.some(x => x.selectable) ?
          'Voor onregelmatige werkwoorden zijn nog geen gecontroleerde oefeningen beschikbaar.' :
          'Kies minstens één beschikbare vorm en een werkwoordcategorie.';
    }
    function render(state, fresh = false) {
      if (state.status !== 'active') throw new Error(state.message);
      $('exercise-title').textContent = forms[state.item.formId].labelEs;
      $('exercise-title-nl').textContent = forms[state.item.formId].labelNl || '';
      const [before, after] = state.item.spanishTemplate.split('{{answer}}');
      const blank = document.createElement('span'); blank.className = 'blank'; blank.textContent = '_____'; blank.setAttribute('aria-label', 'vul de werkwoordvorm in');
      $('sentence').replaceChildren(document.createTextNode(before), blank, document.createTextNode(after));
      $('infinitive').textContent = data.verbs[state.item.verbId].infinitive;
      const pronoun = persons[state.item.slotId];
      $('pronoun').textContent = pronoun || '';
      $('pronoun-line').hidden = !pronoun;
      $('feedback').textContent = state.feedback?.message || '';
      $('feedback').dataset.status = state.feedback?.status || '';
      input.setAttribute('aria-invalid', String(!!state.feedback && state.feedback.status !== 'correct'));
      $('next-button').disabled = !state.canNext;
      $('reveal').hidden = !state.revealed;
      // Never put the hidden translation in the DOM until the user asks for it.
      $('correct-answer').textContent = state.revealed?.acceptedAnswers.join(' / ') || '';
      $('translation').textContent = state.revealed?.translationNl || '';
      $('cycle-message').textContent = state.message;
      if (fresh) { input.value = ''; selection = {start:0,end:0}; input.focus(); }
    }
    $('selection-form').addEventListener('change', updateSelection);
    $('selection-form').addEventListener('submit', event => {
      event.preventDefault();
      if ($('start-button').disabled) return;
      try {
        session = engine.createSession(options());
        $('start-screen').hidden = true; $('exercise-screen').hidden = false;
        render(session.state(), true);
      } catch (error) { fatal(error); }
    });
    $('answer-form').addEventListener('submit', event => {
      event.preventDefault();
      if (session) render(session.check(input.value));
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && event.isComposing) event.preventDefault(); });
    $('show-button').addEventListener('click', () => render(session.showAnswer()));
    $('next-button').addEventListener('click', () => { if (session.state().canNext) render(session.next(), true); });
    $('back-button').addEventListener('click', () => {
      session = null; $('exercise-screen').hidden = true; $('start-screen').hidden = false;
      $('translation').textContent = ''; $('correct-answer').textContent = ''; $('reveal').hidden = true;
      updateSelection(); $('start-title').tabIndex = -1; $('start-title').focus();
    });
    function saveSelection() { selection = {start:input.selectionStart ?? input.value.length, end:input.selectionEnd ?? input.value.length}; }
    for (const type of ['select','keyup','click','input','blur']) input.addEventListener(type, saveSelection);
    for (const char of ['á','é','í','ó','ú','ñ','ü']) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = char;
      button.setAttribute('aria-label', char + ' invoegen');
      button.addEventListener('pointerdown', event => { event.preventDefault(); });
      button.addEventListener('click', () => {
        input.focus(); input.setRangeText(char, selection.start, selection.end, 'end'); saveSelection();
      });
      $('accents').append(button);
    }
    $('info-button').addEventListener('click', () => {
      const state = session.state(), help = session.help(), verb = data.verbs[help.verbId];
      const c = contextById.get(state.item.contextId);
      const regular = verb.isIrregularVerb === false && help.exerciseKind !== 'construction';
      const reference = data.regularHelp?.[verb.group]?.[help.formId];
      const useEndings = regular && reference;
      const table = document.createElement('table'), caption = document.createElement('caption');
      const captionEs = document.createElement('span'); captionEs.lang = 'es';
      captionEs.textContent = help.labelEs + ' · ' + (useEndings ? '-' + verb.group : verb.infinitive);
      const captionNl = document.createElement('small'); captionNl.lang = 'nl'; captionNl.className = 'term-nl';
      captionNl.textContent = forms[help.formId].labelNl || '';
      caption.append(captionEs, captionNl); table.append(caption);
      const thead = document.createElement('thead'), head = document.createElement('tr');
      const headings = [help.exerciseKind === 'nonfinite' ? 'Vorm' : 'Persoon', useEndings ? 'Uitgang / opbouw' : 'Vervoeging'];
      if (useEndings && verb.isReflexive) headings.push('Volledige reflexieve vorm');
      for (const text of headings) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = text; head.append(th); }
      thead.append(head); table.append(thead);
      const tbody = document.createElement('tbody');
      for (const row of help.rows) {
        const tr = document.createElement('tr'), th = document.createElement('th'); th.scope = 'row'; th.lang = 'es'; th.textContent = persons[row.slotId] || '—'; tr.append(th);
        let values = row.accepted;
        if (useEndings) {
          const variants = reference[row.slotId ?? 'value'];
          const selected = c.variantByFormId?.[help.formId];
          values = selected ? variants[selected] : Object.values(variants).flat();
        }
        const td = document.createElement('td'); td.lang = 'es'; td.textContent = [...new Set(values)].join(' / '); tr.append(td);
        if (useEndings && verb.isReflexive) { const full = document.createElement('td'); full.lang = 'es'; full.textContent = row.accepted.join(' / '); tr.append(full); }
        tbody.append(tr);
      }
      table.append(tbody); $('help-content').replaceChildren(table); dialog.showModal(); $('close-help').focus();
    });
    const grammarDialog = $('grammar-dialog');
    $('grammar-button').addEventListener('click', () => {
      if (!session) return;
      const fid = session.state().item.formId, note = data.grammar?.forms[fid];
      $('grammar-title').textContent = forms[fid].labelEs;
      $('grammar-title').lang = 'es';
      $('grammar-term').textContent = forms[fid].labelNl || '';
      $('grammar-content').replaceChildren(...(note?.paragraphs || ['Voor deze vorm is nog geen uitleg uit het grammaticaboek beschikbaar.']).map(text => {
        const p = document.createElement('p'); p.textContent = text; return p;
      }));
      $('grammar-source').textContent = note ? 'In eigen woorden, naar ' + data.grammar.source.author + ', ' + data.grammar.source.title + ', § ' + note.references.join(', ') + '.' : '';
      grammarDialog.showModal(); $('close-grammar').focus();
    });
    function bindDialog(modal, closeId, openerId) {
      $(closeId).addEventListener('click', () => modal.close());
      modal.addEventListener('close', () => {
        // Native dialog restores the opener. Do not steal focus from a subsequent action
        // when the asynchronous close event arrives after the user already moved on.
        if (document.activeElement === document.body || modal.contains(document.activeElement)) $(openerId).focus();
      });
      modal.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const controls = [...modal.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
        const first = controls[0], last = controls[controls.length - 1];
        if ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        }
      });
    }
    bindDialog(dialog, 'close-help', 'info-button');
    bindDialog(grammarDialog, 'close-grammar', 'grammar-button');
    updateSelection();
  } catch (error) { fatal(error); }
})();
