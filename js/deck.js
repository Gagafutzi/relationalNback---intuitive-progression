"use strict";

/* ============================================================
   10. RESPONSE DECK
   ============================================================ */

/* Groups shown on the deck, in order. Position splits per reference frame. */
function deckGroups() {
  const groups = [];
  STREAM_KEYS.forEach(k => {
    const m = cfg.streams[k];
    if (m !== 'identity' && m !== 'relational') return;
    const spec = STREAMS[k];

    if (k === 'position' && m === 'relational' && cfg.meta) {
      /* One group per frame the relation is asked in, exactly as the first-order
         judgement splits — at quinary both are live on the same trial and two
         answers have to be statable at once. */
      const both = cfg.frame === 'both';
      if (cfg.frame === 'cube' || both)
        groups.push({ key:'position', label:'Move vs. previous move ↺' + (both ? ' · cube' : ''),
                      color: spec.color, channels: spec.meta });
      if (cfg.frame === 'screen' || both)
        groups.push({ key:'position2', label:'Move vs. previous move ↺ · screen',
                      color:'#9ccc65', channels: spec.metaScreen });
    } else if (k === 'position' && m === 'relational') {
      const both = cfg.frame === 'both';
      if (cfg.frame === 'cube' || both)
        groups.push({ key:'position', label:'Position' + (both ? ' · cube' : ''),
                      color: spec.color,
                      /* Coordinate axes are judged inside the position judgement,
                         so their poles have to be answerable here. */
                      channels: spec.relational.concat(coordChannels()) });
      if (cfg.frame === 'screen' || both)
        groups.push({ key:'position2', label:'Position' + (both ? ' · screen' : ' · screen'),
                      color:'#9ccc65', channels: spec.relationalScreen });
    } else {
      groups.push({ key:k, label: spec.label + (m === 'relational' ? ' ↔' : ' ='),
                    color: spec.color, channels: spec[m] });
    }
  });
  return groups;
}

/* Custom bind wins, then the built-in default, then the pool. The pool pass is the
   runtime guarantee: whatever the user configures, no two live buttons share a key. */
function assignKeys(groups) {
  const used = new Set(), map = new Map();
  const all = groups.flatMap(g => g.channels);
  const claim = (c, k) => { if (k && !used.has(k)) { used.add(k); map.set(c.id, k); } };

  all.forEach(c => claim(c, keyBinds[c.id]));
  all.forEach(c => { if (!map.has(c.id)) claim(c, c.key); });
  /* The pool pass skips keys an app shortcut owns. The keydown handler checks the
     deck first, so a key handed out here would silently kill the shortcut — and
     unlike a bind the user chose, nobody asked for it. A deliberate bind on either
     side may still collide; both editors flag that rather than preventing it.
     The unreserved fallback only matters if the pool is exhausted, where a button
     with no key at all is the worse outcome. */
  const reserved = reservedActionKeys();
  all.forEach(c => { if (!map.has(c.id)) claim(c,
    KEY_POOL.find(k => !used.has(k) && !reserved.has(k)) ||
    KEY_POOL.find(k => !used.has(k))); });
  return map;
}

/* KeyboardEvent.key spells the non-printing keys as words, and uppercasing them the
   way a letter is uppercased gave key caps reading ENTER and ESCAPE. */
const KEY_NAMES = {
  ' ':'Spc', enter:'Enter', escape:'Esc', backspace:'Bksp', delete:'Del', tab:'Tab',
  arrowleft:'←', arrowright:'→', arrowup:'↑', arrowdown:'↓',
  home:'Home', end:'End', pageup:'PgUp', pagedown:'PgDn', insert:'Ins',
};
const keyLabel = k => !k ? '—' : KEY_NAMES[k] || k.toUpperCase();

/* ---- The compass pad ----
   The same keys laid out where they point: north above, west to the left, and a
   corner between each pair of neighbours.

   The corners are the reason for it. A move runs on every axis at once, and each
   axis is its own question, so a move north-west is answered by pressing North AND
   West. On a keyboard that is two fingers coming down together; on a phone it was
   two taps in a row with one thumb, each a reach across a row of six keys that
   gave no hint which one was which way. A corner is that pair as one target, in
   the place the move went.

   Only the groups with all four of a compass's points get one. Whatever else the
   group carries — Above/Below, near/far, the poles of a coordinate axis, a rank —
   is a pair of opposites, and stands beside the compass as a column with its
   positive end on top. */
const COMPASS = {
  /* `letters`: spell the corner out of the two letters it joins, each in its own
     axis colour — NW, as the slot readout and the gizmo spell it. */
  position:  { n:'north', s:'south', e:'east', w:'west', letters: true },
  position2: { n:'s-north', s:'s-south', e:'s-east', w:'s-west' },
  glyph:     { n:'glyph-north', s:'glyph-south', e:'glyph-east', w:'glyph-west' },
};
const DIAGONAL_ARROWS = { nw:'↖', ne:'↗', sw:'↙', se:'↘' };

/* A coarse primary pointer is a finger, and a finger is what the compass is for. A
   touch laptop reports a fine primary pointer and keeps the row its keyboard
   matches. */
const coarsePointer = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;

function padLayout() {
  if (cfg.pad === 'row' || cfg.pad === 'compass') return cfg.pad;
  return coarsePointer && coarsePointer.matches ? 'compass' : 'row';
}

/* A tablet that gains or loses its keyboard changes what Auto means. */
if (coarsePointer && coarsePointer.addEventListener)
  coarsePointer.addEventListener('change', () => {
    if (cfg.pad === 'auto' || !cfg.pad) { buildDeck(); renderPadHint(); }
  });

const PAD_HINT = {
  row:     'One key per direction, in a row — the layout the keyboard binds match.',
  compass: 'Directions where they point, with a corner for each diagonal: one tap answers both of its axes.',
};
function renderPadHint() {
  const el = $('padLayoutHint');
  if (!el) return;
  const now = padLayout();
  el.textContent = (cfg.pad === 'auto' || !cfg.pad)
    ? `Auto picked ${now === 'compass' ? 'the compass' : 'the row'} for this screen. ` + PAD_HINT[now]
    : PAD_HINT[now];
}

/* Press-on-pointerdown, with the visual travel a phone actually gets. Shared by a
   single key and a corner so the two can never drift apart in how a tap lands. */
function wireKey(b, act) {
  /* pointerdown, not click: on touch a click is only dispatched when the finger
     LIFTS, plus whatever the browser spends deciding the tap was not the first
     half of a double-tap. That delay pushed answers given near the end of an
     interval across the boundary, where they were graded against the next
     trial. preventDefault suppresses the compatibility click that would
     otherwise arrive a second time. */
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    b.classList.add('down');
    act();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
    b.addEventListener(ev, () => b.classList.remove('down')));
  /* detail === 0 means the click came from Enter/Space on a focused button, not
     from a pointer — the only clicks left to honour. */
  b.addEventListener('click', e => { if (e.detail === 0) act(); });
}

function makeKey(c, g, key) {
  const b = document.createElement('button');
  b.className = 'rbtn';
  b.dataset.channel = c.id;
  b.style.setProperty('--btn-color', c.color || g.color);
  b.title = `${g.label}: ${c.label}`;
  b.innerHTML = `<span class="glyph">${c.glyph}</span>` +
                `<span class="kbd">${keyLabel(key)}</span>`;
  wireKey(b, () => press(c.id));
  return b;
}

/* A corner: two channels from one tap. No key cap — the keyboard already presses
   both by pressing both. Untinted, so the four points stay the loudest keys on the
   pad; the letters carry the axis colours instead. */
function makeCorner(chs, glyph, g) {
  const ids = chs.map(c => c.id);
  const b = document.createElement('button');
  b.className = 'rbtn corner' + (/<span/.test(glyph) ? ' spelled' : '');
  b.dataset.combo = ids.join(' ');
  b.title = `${g.label}: ${chs.map(c => c.label).join(' + ')}`;
  b.setAttribute('aria-label', b.title);
  b.innerHTML = `<span class="glyph">${glyph}</span>`;
  wireKey(b, () => pressCorner(ids, b));
  return b;
}

function buildCompass(g, spec, byId, keyFor) {
  const pad = document.createElement('div');
  pad.className = 'btns pad';
  const grid = document.createElement('div');
  grid.className = 'compass';

  const corner = (v, h) => {
    const A = byId[spec[v]], B = byId[spec[h]];
    const glyph = spec.letters
      ? [A, B].map(c => `<span style="color:${c.color || g.color}">${c.glyph}</span>`).join('')
      : DIAGONAL_ARROWS[v + h];
    return makeCorner([A, B], glyph, g);
  };
  /* The middle is the move that did not happen, which nothing answers. */
  const hub = document.createElement('div');
  hub.className = 'pad-hub';
  hub.setAttribute('aria-hidden', 'true');

  [corner('n', 'w'), keyFor(byId[spec.n]), corner('n', 'e'),
   keyFor(byId[spec.w]), hub,              keyFor(byId[spec.e]),
   corner('s', 'w'), keyFor(byId[spec.s]), corner('s', 'e')]
    .forEach(el => grid.appendChild(el));
  pad.appendChild(grid);

  const points = new Set([spec.n, spec.s, spec.e, spec.w]);
  const rest = g.channels.filter(c => !points.has(c.id));
  for (let i = 0; i < rest.length; i += 2) {
    const col = document.createElement('div');
    col.className = 'pole-col';
    rest.slice(i, i + 2).forEach(c => col.appendChild(keyFor(c)));
    pad.appendChild(col);
  }
  /* How many key-widths the pad is across. buildDeck adds these up. */
  pad.dataset.cols = 3 + Math.ceil(rest.length / 2);
  return pad;
}

function buildDeck() {
  deckEl.innerHTML = '';
  state.keyIndex = {};
  const groups = deckGroups();
  const keys = assignKeys(groups);
  const compass = padLayout() === 'compass';
  /* On the root, because the cube is sized there: a pad three keys tall takes
     height the stage has to give back. */
  document.documentElement.classList.toggle('pad-compass', compass);

  groups.forEach(g => {
    const group = document.createElement('div');
    group.className = 'deck-group';
    group.dataset.stream = g.key;
    group.style.borderColor = g.color + '55';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = g.label;
    group.appendChild(title);

    const keyFor = c => {
      const key = keys.get(c.id);
      state.keyIndex[key] = c.id;
      return makeKey(c, g, key);
    };
    const byId = Object.fromEntries(g.channels.map(c => [c.id, c]));
    const spec = compass && COMPASS[g.key];
    /* The meta deck shares the position group's key, and has no points at all. */
    if (spec && [spec.n, spec.s, spec.e, spec.w].every(id => byId[id])) {
      group.appendChild(buildCompass(g, spec, byId, keyFor));
    } else {
      const btns = document.createElement('div');
      btns.className = 'btns';
      g.channels.forEach(c => btns.appendChild(keyFor(c)));
      group.appendChild(btns);
    }
    deckEl.appendChild(group);
  });
  /* Key-widths across every pad on the deck, so the stylesheet can share the
     screen's width out among them: one compass with the coordinate axes standing
     beside it, or both frames' compasses side by side, rather than each pad sized
     as if it had the screen to itself and the deck stacking them off the bottom. */
  const cols = [...deckEl.querySelectorAll('.pad')].reduce((s, p) => s + +p.dataset.cols, 0);
  if (cols) deckEl.style.setProperty('--pad-cols', cols);
  else deckEl.style.removeProperty('--pad-cols');
}

/* Highlight the cued deck group and name it in the HUD. The cue has to be visible
   the whole block — it is an instruction to hold, not a momentary signal. */
function renderPriorityCue() {
  deckEl.querySelectorAll('.deck-group').forEach(g =>
    g.classList.toggle('priority', g.dataset.stream === state.priorityStream));
  const el = $('hudPriority');
  if (!el) return;
  if (state.priorityStream && state.running) {
    el.innerHTML = `focus: <b>${labelFor(state.priorityStream)}</b>`;
    el.style.display = '';
  } else el.style.display = 'none';
}

/* Grace window for a response that lands just after the stimulus changed. No press
   this soon can be a reaction to the NEW trial — a relational judgment needs half a
   second at the very least — so it belongs to the interval that just closed.
   Without this, an answer given near the end of an interval was scored against the
   trial that replaced it, and a correct answer flashed red. */
const LATE_PRESS_GRACE = 260;
const graceMs = () => Math.min(LATE_PRESS_GRACE, cfg.interval * 0.25);

/* ---- Move trace ----
   Only the meta-relation channels get one. Every other stream asks an independent
   question — miss a colour and the next colour question is unaffected — but meta
   compares this move against the move you reported last time, so an error there
   takes the anchor with it and the rest of the block is guesswork. This hands the
   anchor back. */
const META_CHANNEL_IDS = new Set(
  (STREAMS.position.meta || []).concat(STREAMS.position.metaScreen || []).map(c => c.id));

/* Deliberately left up through the FOLLOWING trial, not flashed and cleared. The
   direction it draws is the one the next trial has to be judged against, so the
   moment it is most useful is after the next stimulus has already appeared. */
function traceMove(trial) {
  /*
   * Every axis the move ran on, not the one it ran on.
   *
   * A move may now combine axes, and the trace used to give up on those — it
   * asked for a single cardinal and got null. Losing the anchor is exactly when
   * the trace is needed, and a diagonal is exactly the move that loses it, so
   * the case it skipped was the case it was for.
   *
   * The arrow still draws one axis, since it is a rotation of one arm and a
   * diagonal has none; the arms flash for all of them, which is what says the
   * move was more than one.
   */
  const names = moveNames(trial && trial.pair
    ? moveVectorOf(trial.pair[0], trial.pair[1]) : null);
  if (!names.length) return;
  showMoveArrow(names[0]);
  state.traceUntil = state.trial + 1;
  /* The gizmo arms for the same axes, once, so the eye is handed from the arrow
     inside the lattice out to the labels that name it. */
  names.forEach(flashArm);
}

/* `quiet` holds the error sound back for a caller that will make one itself. */
function pressFeedback(channelId, ok, trial, quiet) {
  const btn = deckEl.querySelector(`[data-channel="${channelId}"]`);
  if (AXIS[channelId]) flashArm(channelId);
  if (!ok && !quiet) signalWrong('fa');
  if (cfg.feedback !== 'off' && btn) {
    btn.classList.add(ok ? 'hit' : 'miss');
    setTimeout(() => btn.classList.remove('hit', 'miss'), 260);
  }
  /* Suppressed under test conditions whatever the switch says — the trace is the
     loudest feedback in the app and "None" has to mean none. */
  if (!ok && cfg.moveTrace && cfg.feedback !== 'off' && META_CHANNEL_IDS.has(channelId))
    traceMove(trial);
}

/* Returns whether the press was right, or null when it was not taken at all. */
function press(channelId, quiet) {
  if (!state.running) return null;

  /* Tested before the `cued` guard: on a retro-cue trial the window for the NEW
     trial is still shut, but a late answer to the trial that just closed is
     perfectly legitimate and must not be swallowed. */
  const snap = state.lastSnap;
  if (snap && state.tickAt && performance.now() - state.tickAt < graceMs() &&
      !snap.presses.has(channelId) &&
      snap.judgments.some(j => j.options.includes(channelId))) {
    applyInterval(snap, -1);
    snap.presses.add(channelId);
    applyInterval(snap, 1);

    const ok = snap.judgments.some(j => j.correct.includes(channelId));
    state.presses_log.push({
      t: snap.trial, ch: channelId, ok, late: true,
      rt: snap.stimAt ? Math.round(performance.now() - snap.stimAt) : null,
    });
    pressFeedback(channelId, ok, snap.trial_, quiet);
    return ok;
  }

  if (state.presses.has(channelId)) return null;
  if (!state.cued) return null;   // retro-cue trial: no answering before the cue
  state.presses.add(channelId);

  const j = state.judgments.find(x => x.options.includes(channelId));
  const ok = !!(j && j.correct.includes(channelId));

  /* Logged regardless of the feedback setting — RT cannot be reconstructed later. */
  state.presses_log.push({
    t: state.trial, ch: channelId, ok,
    rt: state.stimAt ? Math.round(performance.now() - state.stimAt) : null,
  });

  pressFeedback(channelId, ok, state.currentTrial, quiet);
  return ok;
}

/* Both halves of a diagonal from one tap. Each is pressed exactly as its own key
   would be — scored, logged and flashed on that key — so a corner adds no judgement
   of its own, and the half that was wrong is the key that lights red. What it does
   add is one verdict on the corner itself and one buzz: two wrong halves are one
   slip of the thumb, and two error sounds a frame apart read as a glitch. */
function pressCorner(ids, btn) {
  const said = ids.map(id => press(id, true)).filter(ok => ok != null);
  if (!said.length) return;
  const ok = said.every(Boolean);
  if (!ok) signalWrong('fa');
  if (cfg.feedback !== 'off') {
    btn.classList.add(ok ? 'hit' : 'miss');
    setTimeout(() => btn.classList.remove('hit', 'miss'), 260);
  }
}

function revealAnswers() {
  if (cfg.feedback !== 'reveal') return;
  const correct = new Set();
  state.judgments.forEach(j => j.correct.forEach(id => {
    correct.add(id);
    const btn = deckEl.querySelector(`[data-channel="${id}"]`);
    if (btn) { btn.classList.add('reveal'); setTimeout(() => btn.classList.remove('reveal'), 500); }
    if (AXIS[id]) flashArm(id);
  }));
  /* A corner was the answer when both of its halves were. */
  deckEl.querySelectorAll('[data-combo]').forEach(btn => {
    if (!btn.dataset.combo.split(' ').every(id => correct.has(id))) return;
    btn.classList.add('reveal');
    setTimeout(() => btn.classList.remove('reveal'), 500);
  });
}

