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

/* ---------- The compass pad ----------
 *
 * A move may run on every axis at once, and the deck asks about each axis on its
 * own, so most answers are two or three buttons. With a keyboard that is a chord.
 * On a phone it is two or three taps, in sequence, against a clock, on a row of
 * six keys where the neighbour of the right one is always the opposite direction
 * on the same axis.
 *
 * So on a phone the four flat directions are laid out where they point, and the
 * corners between them are keys too: NE is north and east in one tap. The third
 * axis stands beside the pad as a pair, above over below, which is the one place
 * up and down can sit without being read as north and south. Coordinate axes are
 * more pairs beside it, because each of them is one more up/down/neither.
 *
 * The corners are taps, not channels. Each presses its two directions exactly as
 * tapping both would, so nothing is scored, stored or keyed differently — a
 * corner is a shortcut on the glass and nothing else. Off a phone the corners and
 * the pad's wrappers drop out in CSS and the row is the row it always was.
 *
 * Every deck whose first-order judgement is a direction gets one: the cube frame,
 * the screen frame (toward and away from you in the pair), and the glyph stream's
 * set map (rank up and down).
 */
const COMPASS_SPECS = [
  { n:'north',       s:'south',       e:'east',       w:'west',       up:'above',    down:'below' },
  { n:'s-north',     s:'s-south',     e:'s-east',     w:'s-west',     up:'s-near',   down:'s-far' },
  { n:'glyph-north', s:'glyph-south', e:'glyph-east', w:'glyph-west', up:'glyph-up', down:'glyph-down' },
];

/**
 * The pad for one deck group, or null when the group is not a set of directions.
 *
 * `cells` maps each of the eight compass slots to the channel ids it presses —
 * one for an edge, two for a corner, the vertical first — and `pairs` holds every
 * other channel two at a time, the third axis first. A pure function of the
 * channel list, so the checks can ask it what a phone would show without a DOM.
 */
function compassOf(channels) {
  const has = new Set(channels.map(c => c.id));
  const spec = COMPASS_SPECS.find(s => ['n', 's', 'e', 'w'].every(k => has.has(s[k])));
  if (!spec) return null;
  const cells = {
    n: [spec.n], s: [spec.s], e: [spec.e], w: [spec.w],
    nw: [spec.n, spec.w], ne: [spec.n, spec.e],
    sw: [spec.s, spec.w], se: [spec.s, spec.e],
  };
  const flat = new Set([spec.n, spec.s, spec.e, spec.w]);
  const rest = channels.map(c => c.id).filter(id => !flat.has(id));
  /* The third axis leads whatever else is in the group, so it sits against the pad. */
  rest.sort((a, b) => ([spec.up, spec.down].indexOf(b) >= 0) - ([spec.up, spec.down].indexOf(a) >= 0));
  const pairs = [];
  for (let i = 0; i < rest.length; i += 2) pairs.push(rest.slice(i, i + 2));
  return { cells, pairs };
}

/* Two flat arrows make a diagonal one. Anything else — N and W — is spelled out. */
const CORNER_ARROWS = { '↑←':'↖', '↑→':'↗', '↓←':'↙', '↓→':'↘' };

/* Halfway between two channel colours, for the rim of the corner between them. */
function mixColour(a, b) {
  const A = rgbOf(a), B = rgbOf(b);
  return `rgb(${A.map((v, i) => Math.round((v + B[i]) / 2)).join(',')})`;
}

/* Shared by every key on the deck, corners included, so a corner cannot answer
   later than an edge. */
function wireKey(b, fire) {
  /* pointerdown, not click: on touch a click is only dispatched when the finger
     LIFTS, plus whatever the browser spends deciding the tap was not the first
     half of a double-tap. That delay pushed answers given near the end of an
     interval across the boundary, where they were graded against the next
     trial. preventDefault suppresses the compatibility click that would
     otherwise arrive a second time. */
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    b.classList.add('down');
    fire();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
    b.addEventListener(ev, () => b.classList.remove('down')));
  /* detail === 0 means the click came from Enter/Space on a focused button, not
     from a pointer — the only clicks left to honour. */
  b.addEventListener('click', e => { if (e.detail === 0) fire(); });
}

function buildDeck() {
  deckEl.innerHTML = '';
  state.keyIndex = {};
  const groups = deckGroups();
  const keys = assignKeys(groups);
  let anyCompass = false;

  groups.forEach(g => {
    const group = document.createElement('div');
    group.className = 'deck-group';
    group.dataset.stream = g.key;
    group.style.borderColor = g.color + '55';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = g.label;
    group.appendChild(title);

    const btns = document.createElement('div');
    btns.className = 'btns';
    const made = {};
    g.channels.forEach((c, i) => {
      const key = keys.get(c.id);
      state.keyIndex[key] = c.id;

      const b = document.createElement('button');
      b.className = 'rbtn';
      b.dataset.channel = c.id;
      b.style.setProperty('--btn-color', c.color || g.color);
      /* The row's order, held by the key rather than by where it sits in the DOM —
         the compass moves the keys into a pad and pairs, and off a phone those
         dissolve back into one row that has to read N S E W A B as it always did. */
      b.style.order = i;
      b.title = `${g.label}: ${c.label}`;
      b.innerHTML = `<span class="glyph">${c.glyph}</span>` +
                    `<span class="kbd">${keyLabel(key)}</span>`;
      wireKey(b, () => press(c.id));
      made[c.id] = b;
      btns.appendChild(b);
    });

    const pad = compassOf(g.channels);
    if (pad) {
      anyCompass = true;
      btns.classList.add('compass');
      /* How many pairs stand beside the pad, so the columns can narrow to keep them
         on one line (responsive.css) rather than orphan the last one underneath. */
      btns.style.setProperty('--pairs', pad.pairs.length);
      const chan = Object.fromEntries(g.channels.map(c => [c.id, c]));
      const grid = document.createElement('div');
      grid.className = 'pad';
      Object.entries(pad.cells).forEach(([slot, ids]) => {
        if (ids.length === 1) {
          made[ids[0]].dataset.slot = slot;
          grid.appendChild(made[ids[0]]);
          return;
        }
        const [v, h] = ids.map(id => chan[id]);
        const arrow = CORNER_ARROWS[v.glyph + h.glyph];
        const b = document.createElement('button');
        b.className = 'rbtn corner' + (arrow ? ' arrow' : '');
        b.dataset.slot = slot;
        b.dataset.combo = ids.join(' ');
        b.style.setProperty('--btn-color',
          mixColour(v.color || g.color, h.color || g.color));
        b.title = `${g.label}: ${v.label} + ${h.label}`;
        /* Each half in its own colour where the halves are letters, so the key says
           which two it is; arrows merge into the diagonal they make. */
        const face = arrow ||
          `<span style="color:${v.color || g.color}">${v.glyph}</span>` +
          `<span style="color:${h.color || g.color}">${h.glyph}</span>`;
        b.innerHTML = `<span class="glyph">${face}</span>` +
          `<span class="kbd">${keyLabel(keys.get(v.id))}+${keyLabel(keys.get(h.id))}</span>`;
        wireKey(b, () => pressCombo(ids, b));
        grid.appendChild(b);
      });
      btns.appendChild(grid);
      pad.pairs.forEach(ids => {
        const col = document.createElement('div');
        col.className = 'pair';
        ids.forEach(id => col.appendChild(made[id]));
        btns.appendChild(col);
      });
    }
    group.appendChild(btns);
    deckEl.appendChild(group);
  });
  /* On the root, because the stage is sized there: a pad is three rows where the
     row was one, and the cube gives back the height on a phone (responsive.css). */
  document.documentElement.classList.toggle('deck-compass', anyCompass);
  measureDock();
}

/*
 * How tall the keys and the run controls are, for the stage to make room for.
 *
 * Measured rather than assumed, because a pad is not the only thing on the deck:
 * both frames are two pads, and every stream the ladder adds is another group.
 * A fixed allowance fitted one pad and let the second push Start, and half the
 * answers, below the bottom of a phone mid-block. The dock's height depends on
 * the width and the deck, never on the stage, so sizing one from the other
 * cannot chase itself. (Guarded: the checks load this file with no document.)
 */
const dockEl = typeof document !== 'undefined' ? document.querySelector('.dock') : null;
function measureDock() {
  if (!dockEl) return;
  const h = Math.round(dockEl.offsetHeight);
  const root = document.documentElement.style;
  if (h && root.getPropertyValue('--dock-h') !== h + 'px') root.setProperty('--dock-h', h + 'px');
}
/* A rotation re-wraps the deck without rebuilding it. */
if (dockEl && typeof ResizeObserver === 'function') new ResizeObserver(measureDock).observe(dockEl);

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

/* `btn` is the key that was tapped when it is not the channel's own — a corner,
   which flashes for both of its halves. `quiet` holds the buzz back for the
   caller to sound once, so a corner wrong on both halves is one mistake heard
   once, as it was one tap. */
function pressFeedback(channelId, ok, trial, btn, quiet) {
  btn = btn || deckEl.querySelector(`[data-channel="${channelId}"]`);
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

/* Returns whether the press was right, or undefined when it was not taken at all —
   a repeat, or a retro trial whose cue is not up yet. */
function press(channelId, btn, quiet) {
  if (!state.running) return;

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
    pressFeedback(channelId, ok, snap.trial_, btn, quiet);
    return ok;
  }

  if (state.presses.has(channelId)) return;
  if (!state.cued) return;        // retro-cue trial: no answering before the cue
  state.presses.add(channelId);

  const j = state.judgments.find(x => x.options.includes(channelId));
  const ok = !!(j && j.correct.includes(channelId));

  /* Logged regardless of the feedback setting — RT cannot be reconstructed later. */
  state.presses_log.push({
    t: state.trial, ch: channelId, ok,
    rt: state.stimAt ? Math.round(performance.now() - state.stimAt) : null,
  });

  pressFeedback(channelId, ok, state.currentTrial, btn, quiet);
  return ok;
}

/* A corner of the compass: both of its directions, exactly as two taps would press
   them, logged as two presses with their own reaction times. The corner itself
   takes the flash — green only if both halves were right. */
function pressCombo(ids, btn) {
  let wrong = false;
  ids.forEach(id => { if (press(id, btn, true) === false) wrong = true; });
  if (wrong) signalWrong('fa');
}

/* The keys to light for a set of correct answers. Where a direction pair has a
   corner on screen the corner is lit instead of its two edges, because on a phone
   the corner is the answer — one key to find, not two to assemble. Hidden corners
   (off a phone) have no layout box, so the row lights its keys as it always did. */
function revealKeys(ids) {
  const want = new Set(ids), out = [];
  deckEl.querySelectorAll('.rbtn.corner').forEach(b => {
    const pair = b.dataset.combo.split(' ');
    if (b.offsetParent && pair.every(id => want.has(id))) {
      out.push(b);
      pair.forEach(id => want.delete(id));
    }
  });
  want.forEach(id => {
    const b = deckEl.querySelector(`[data-channel="${id}"]`);
    if (b) out.push(b);
  });
  return out;
}

function revealAnswers() {
  if (cfg.feedback !== 'reveal') return;
  const ids = state.judgments.flatMap(j => j.correct);
  revealKeys(ids).forEach(btn => {
    btn.classList.add('reveal');
    setTimeout(() => btn.classList.remove('reveal'), 500);
  });
  ids.forEach(id => { if (AXIS[id]) flashArm(id); });
}

