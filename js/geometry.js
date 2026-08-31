"use strict";

/* ============================================================
   6. CUBE + GIZMO GEOMETRY
   ============================================================ */

/* Six outward-facing planes, so content is legible from any viewing angle. */
function addFaces(parent, size, cls, html) {
  const rot = ['rotateY(0deg)','rotateY(180deg)','rotateY(90deg)',
               'rotateY(-90deg)','rotateX(90deg)','rotateX(-90deg)'];
  return rot.map(r => {
    const f = document.createElement('div');
    f.className = cls;
    f.style.transform = `${r} translateZ(${size / 2}px)`;
    if (html != null) f.innerHTML = html;
    parent.appendChild(f);
    return f;
  });
}

/* How readable each depth layer is. A dense cube in perspective projects a front
   cell and a back cell to nearly the same place, which is the single biggest reason
   positions are hard to read. */
const LAYOUT_HINT = {
  dense:  'The true cube. Most faithful, but front and back layers overlap on screen.',
  spaced: 'Cells shrunk apart on a viewing angle solved so that no two slots overlap while the cube is still. Depth-tinted. Rotation still works, and overlap returns while it turns.',
};

/* ---- Solving the static view ----
   A cube lattice under perspective normally has collisions — an isometric view is the
   worst case, since (X+Z) lands on the same screen x for many cells. Rather than guess
   an angle, search for the one that maximises the MINIMUM pairwise screen distance
   between slot centres. That distance then dictates how large a cell can be drawn
   before neighbours touch.

   Projection under rotateX(a) rotateY(b), matching the CSS transform order:
     sx = X·cos b + Z·sin b
     sy = X·sin a·sin b + Y·cos a − Z·sin a·cos b                                    */
function projectLattice(dim, a, b) {
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const pts = [];
  for (let X = 0; X < dim; X++)
    for (let Y = 0; Y < dim; Y++)
      for (let Z = 0; Z < dim; Z++)
        pts.push([X * cb + Z * sb, X * sa * sb + Y * ca - Z * sa * cb]);
  return pts;
}

/* Every pair of slots differs by some lattice vector, and two pairs sharing a
   difference project to the same screen offset — so the closest pair can be found by
   scanning the difference vectors instead of the pairs. One of each ± pair is enough.
   For a 4-cube that is 171 candidates rather than 2016, which is what makes solving
   an entire circle of views cheap enough to do at build time. */
const deltaCache = {};
function latticeDeltas(dim) {
  if (deltaCache[dim]) return deltaCache[dim];
  const out = [], n = dim - 1;
  for (let X = -n; X <= n; X++)
    for (let Y = -n; Y <= n; Y++)
      for (let Z = -n; Z <= n; Z++) {
        if (!X && !Y && !Z) continue;
        if (X < 0 || (X === 0 && (Y < 0 || (Y === 0 && Z < 0)))) continue;
        out.push([X, Y, Z]);
      }
  return (deltaCache[dim] = out);
}

/* Smallest screen distance between any two slot centres, in lattice-pitch units. */
function minLatticeSep(dim, a, b) {
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  let m = Infinity;
  for (const [X, Y, Z] of latticeDeltas(dim)) {
    const dx = X * cb + Z * sb, dy = X * sa * sb + Y * ca - Z * sa * cb;
    const d = dx * dx + dy * dy;
    if (d < m) m = d;
  }
  return Math.sqrt(m);
}

/* Widest the lattice ever projects, so the result can be scaled to fit the stage. */
function projectedExtent(dim, a, b) {
  const pts = projectLattice(dim, a, b);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

const staticViewCache = {};
let staticView = null;      // solved angle in force for the current build, if any

function solveStaticView(dim) {
  if (staticViewCache[dim]) return staticViewCache[dim];
  let best = { sep: -1, ax: -24, ay: -28 };
  /* Coarse sweep then refine. A few thousand candidates is milliseconds and only
     ever runs once per cube dimension. */
  for (let ax = -46; ax <= -8; ax += 2)
    for (let ay = -68; ay <= -12; ay += 2) {
      const sep = minLatticeSep(dim, ax * Math.PI / 180, ay * Math.PI / 180);
      if (sep > best.sep) best = { sep, ax, ay };
    }
  for (let ax = best.ax - 2; ax <= best.ax + 2; ax += 0.5)
    for (let ay = best.ay - 2; ay <= best.ay + 2; ay += 0.5) {
      const sep = minLatticeSep(dim, ax * Math.PI / 180, ay * Math.PI / 180);
      if (sep > best.sep) best = { sep, ax, ay };
    }
  Object.assign(best, projectedExtent(dim, best.ax * Math.PI / 180, best.ay * Math.PI / 180));
  return (staticViewCache[dim] = best);
}

/* ---- Solving the spin ----
   No full tumble can stay readable. Sweep the pitch through a turn and the view
   passes down each lattice axis in turn; there the slots collapse onto one another
   exactly — separation zero, whole columns on a single point. The old keyframes did
   precisely that, hitting a total collapse a third of the way through every turn.

   Yawing at a FIXED pitch can avoid it, but only at the right pitch: a yaw circle at
   0°, ±45° or ±90° still collapses. So the pitch is solved once per cube size — the
   tilt whose entire yaw circle holds the slot centres furthest apart.

   The answer has a tidy shape. The binding pair is the vertical neighbour, separated
   by cos(pitch) no matter where the yaw is; tilting further apart the horizontal
   axes squashes the vertical one. The optimum is the balance point, and it lands at
   -71.6° for a 3-cube (0.32 of a lattice pitch) and -76.0° for a 4-cube (0.24).
   For reference the flat default view, -24°/-28°, separates by only 0.06. */
/* Cell edge as a fraction of the lattice pitch in the exploded layout, and the most
   a cell may exceed the tightest gap between slot centres. The cap never binds for
   the cube sizes on offer (it would need a gap below 0.13 of a pitch); it is there so
   a larger cube could not quietly reach the point where two slots sit on top of one
   another. */
const SPREAD_CELL = 0.40, MAX_CELL_PER_GAP = 3;

const spinViewCache = {};
let spinView = null;        // solved turntable in force for the current build, if any

function solveSpinView(dim) {
  if (spinViewCache[dim]) return spinViewCache[dim];
  const ring = (ax, step) => {
    const a = ax * Math.PI / 180;
    let m = Infinity;
    for (let ay = 0; ay < 360; ay += step) {
      const s = minLatticeSep(dim, a, ay * Math.PI / 180);
      if (s < m) m = s;
    }
    return m;
  };
  /* Negative pitch only: the cube is looked at from above throughout the app, and
     the positive mirror is the same view seen from below. */
  let best = { sep: -1, ax: -60 };
  for (let ax = -88; ax <= -2; ax += 1) { const s = ring(ax, 3); if (s > best.sep) best = { sep: s, ax }; }
  for (let ax = best.ax - 1; ax <= best.ax + 1; ax += 0.1) {
    const s = ring(ax, 0.5); if (s > best.sep) best = { sep: s, ax };
  }
  best.ax = Math.round(best.ax * 100) / 100;   // the 0.1° sweep leaves float dust
  best.sep = ring(best.ax, 0.25);      // honest figure at the chosen tilt

  /* Extent is taken over the whole turn, not at one yaw — scaling to a single frame
     would let the cube grow past the stage as it came round. */
  let w = 0, h = 0;
  for (let ay = 0; ay < 360; ay += 1) {
    const e = projectedExtent(dim, best.ax * Math.PI / 180, ay * Math.PI / 180);
    w = Math.max(w, e.w); h = Math.max(h, e.h);
  }
  best.w = w; best.h = h;
  return (spinViewCache[dim] = best);
}

function buildCube(dim) {
  const layout = cfg.layout || 'dense';
  /* Set BEFORE the lattice is measured. On a phone the stage footprint is what the
     screen affords and --cube-size is derived from it, so these classes decide the
     width that `size` is about to read — flipping them afterwards builds the cube at
     the previous size. */
  document.documentElement.classList.toggle('spread-stage', layout === 'spaced');
  document.documentElement.classList.toggle('gizmo-off', cfg.gizmo === 'off');
  /* Only the solved path tilts steeply and rolls; the free tumble keeps the resting
     footprint. Both have to be settled before the lattice reads its own width. */
  const solvedSpin = cfg.rotation && cfg.spinPath !== 'free';
  document.documentElement.classList.toggle('spin-stage', solvedSpin);
  document.documentElement.classList.toggle('tumble-stage', cfg.rotation && !solvedSpin);

  gridCube.innerHTML = '';
  state.cells = [];
  const size = gridCube.clientWidth || 240;
  const off = (dim - 1) / 2;

  let step = size / dim;
  let cellSize = step;

  /* Solved whenever the cube spins, layout aside: the gizmo arms are aimed at it too. */
  spinView = solvedSpin ? solveSpinView(dim) : null;

  if (layout === 'spaced') {
    /* Spread the lattice out and size the cells from the solved separation, so no two
       slots touch at the viewing angle actually held. Scaled to fill the space
       available rather than to a fixed step, so a bigger cube uses the room it is
       given. While spinning the figures come from the tightest moment of the whole
       turn, which is what keeps the slots apart at every frame rather than at one. */
    const v = spinView || solveStaticView(dim);
    /* The free tumble shows the lattice from every angle, including the one that lays
       its long diagonal across the screen — the static outline is not what has to fit.
       The 3D diameter is an exact bound that holds at every angle, so the figure keeps
       a constant size instead of swelling past its box on the way round, which is what
       the original did. */
    const span = (cfg.rotation && !solvedSpin)
      ? (dim - 1) * Math.sqrt(3)
      : Math.max(v.w, v.h);
    step = size / span;
    /* Sized against the lattice PITCH, not against the tightest projected gap. Tying
       the cell to the gap made it collapse whenever the view got tight — a turning
       cube shrank its slots to half the size a still one has, to buy a guarantee of
       no overlap at all that nobody asked for. SPREAD_CELL is exactly what the old
       gap-derived formula produced at the resting angle, so a still cube is unchanged
       to the pixel; what changes is that a turning one no longer shrinks to meet its
       worst moment.

       Slots may now overlap in part when the view is tightest. They can never
       coincide: on the solved path the centres are held at least 0.32 of a pitch
       apart (0.24 on a 4-cube), which the cap below keeps a real fraction of the cell
       — so every slot always shows an offset of its own. On the free tumble the
       centres do meet, which is that option's whole nature. */
    cellSize = Math.min(step * SPREAD_CELL, v.sep * step * MAX_CELL_PER_GAP);
    /* Cleared whenever the cube moves. buildGizmo lengthens each arm by the inverse of
       its foreshortening at this angle, which is only meaningful if the angle is
       actually held: under a free tumble the same rod swings side-on and reaches its
       full 3D length across the screen, which is how the original threw its badges
       clean outside the stage. */
    staticView = cfg.rotation ? null : v;
  } else {
    staticView = null;
  }

  for (let x = 0; x < dim; x++)
    for (let y = 0; y < dim; y++)
      for (let z = 0; z < dim; z++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.style.width = cell.style.height = cellSize + 'px';
        cell.style.left = cell.style.top = `calc(50% - ${cellSize / 2}px)`;
        cell.style.transform =
          `translate3d(${(x-off)*step}px, ${(y-off)*step}px, ${(z-off)*step}px)`;
        const faces = addFaces(cell, cellSize, 'cell-face', '');
        if (layout === 'spaced') {
          /* Depth cue by brightness, not hue — the six axis colours already own the
             hue channel, and a magenta far-layer reads as the violet A axis. */
          const t = dim > 1 ? z / (dim - 1) : 0;
          const col = `hsla(215, 30%, ${52 + t * 34}%, ${0.20 + t * 0.45})`;
          faces.forEach(f => { f.style.setProperty('--depth-edge', col); });
        }
        gridCube.appendChild(cell);
        state.cells.push({ el: cell, x, y, z });
      }

  state.builtSize = size;
  buildCubeFrame(size);
  buildGuides(size);
  buildMoveArrow(size);
  buildGizmo();
  applyCellVis();
  applyRotation();
}

/* Outer wireframe box. Once the lattice is faded or hidden there is nothing left to
   give the space scale, so the bounds have to be drawn explicitly. */
function buildCubeFrame(size) {
  const frame = document.createElement('div');
  frame.className = 'cube-frame';
  ['rotateY(0deg)','rotateY(180deg)','rotateY(90deg)',
   'rotateY(-90deg)','rotateX(90deg)','rotateX(-90deg)'].forEach(r => {
    const f = document.createElement('div');
    f.className = 'frame-face';
    f.style.transform = `${r} translateZ(${size / 2}px)`;
    frame.appendChild(f);
  });
  gridCube.appendChild(frame);
}

/* Three rails through the active slot, one per axis, each running the full width of
   the cube. The gradient runs between the two axis colours, so a rail reads as
   "this slot sits here on the West→East line". */
const RAIL_AXES = [
  { orient: '',                 grad: ['#fcc419', '#51cf66'] },  // X: W → E
  { orient: 'rotateZ(90deg)',   grad: ['#4dabf7', '#ff6b6b'] },  // Y: N → S
  { orient: 'rotateY(-90deg)',  grad: ['#ff922b', '#cc5de8'] },  // Z: B → A
];

function buildGuides(size) {
  const g = document.createElement('div');
  g.className = 'guides';
  state.rails = [];
  RAIL_AXES.forEach(ax => {
    const pair = [0, 90].map(roll => {
      const r = document.createElement('div');
      r.className = 'rail';
      r.style.width = size + 'px';
      r.style.left = `calc(50% - ${size / 2}px)`;
      r.style.top = 'calc(50% - 2px)';
      r.style.background = `linear-gradient(to right, ${ax.grad[0]}, ${ax.grad[1]})`;
      g.appendChild(r);
      return { el: r, roll, orient: ax.orient };
    });
    state.rails.push(pair);
  });
  gridCube.appendChild(g);
}

/* ---- Move arrow ----
   The direction the sequence is currently travelling, drawn through the middle of
   the lattice after a wrong meta-relation. Built like a gizmo arm — crossed planes
   so it never vanishes edge-on, a letter badge kept upright — but it lives inside
   gridCube rather than in the gizmo, so it turns with the lattice and reads as a
   vector THROUGH the cube instead of another label around the outside.

   Anchored to the cube's centre, deliberately, not to the cell that was lit. It has
   to stay up for the trial after the mistake, and by then a different cell is lit;
   an arrow still pinned to the old slot would be pointing out of nowhere. Centred,
   it is unmistakably a direction rather than a path between two cells. */
function buildMoveArrow(size) {
  /* Sized off the cube, not fixed: the gizmo arm for the same axis runs along the
     very same line in the very same colour, so the only thing separating the two is
     weight. A 2px arm against a 5px arrow read as one slightly thicker arm. */
  const L = size * 0.72, HEAD = size * 0.17, BADGE = 21;
  const THICK = Math.max(7, size * 0.035);
  const wrap = document.createElement('div');
  wrap.className = 'move-arrow';

  [0, 90].forEach(roll => {
    const s = document.createElement('div');
    s.className = 'ma-shaft';
    s.style.width = L + 'px';
    s.style.height = THICK + 'px';
    s.style.top = `${-THICK / 2}px`;
    s.style.transform = `rotateX(${roll}deg)`;
    wrap.appendChild(s);

    const h = document.createElement('div');
    h.className = 'ma-head';
    h.style.width = HEAD + 'px';
    h.style.height = HEAD * 0.92 + 'px';
    h.style.top = `${-HEAD * 0.46}px`;
    h.style.left = L + 'px';
    h.style.transform = `rotateX(${roll}deg)`;
    wrap.appendChild(h);
  });

  const badge = document.createElement('div');
  badge.className = 'ma-badge';
  badge.style.width = badge.style.height = BADGE + 'px';
  badge.style.left = `${L + HEAD * 0.7}px`;
  badge.style.top = `${-BADGE / 2}px`;
  wrap.appendChild(badge);

  gridCube.appendChild(wrap);
  state.moveArrow = { wrap, badge, L, size };
  /* A resize rebuilds the lattice mid-trial. Put the arrow back rather than letting
     the rebuild silently swallow the one piece of feedback the player is relying on
     to answer the trial in front of them. */
  if (state.moveArrowAxis && state.traceUntil != null)
    showMoveArrow(state.moveArrowAxis);
}

function showMoveArrow(axisId) {
  const ma = state.moveArrow, ax = AXIS[axisId];
  if (!ma || !ax) return;
  state.moveArrowAxis = axisId;
  /* translateX runs along the LOCAL x, which AXIS_ORIENT has already aimed down the
     axis — so this backs the tail up half a length and leaves the arrow centred on
     the cube while still pointing the right way. */
  ma.wrap.style.transform = `${AXIS_ORIENT[axisId]} translateX(${-ma.L / 2}px)`;
  ma.wrap.style.color = ax.color;
  ma.badge.innerHTML = '';
  /* The badge sizes itself from the element buildMoveArrow already sized, so the
     faces cannot drift out of the box they sit in when the cube changes size. */
  const bs = parseFloat(ma.badge.style.width) || 21;
  const faces = addFaces(ma.badge, bs, 'ma-badge-face', ax.letter);
  faces.forEach(f => { f.style.color = ax.color; f.style.borderColor = ax.color; });
  /* Undo the arm's rotation on the badge only, so the letter stays the right way up
     however the arrow is pointing. */
  ma.badge.style.transform = invertOrient(axisId);
  ma.wrap.classList.add('show');
}

function hideMoveArrow() {
  if (state.moveArrow) state.moveArrow.wrap.classList.remove('show');
  state.moveArrowAxis = null;
  state.traceUntil = null;
}

/* Slide the rails onto the lit cell. Translate first, then orient, so each rail
   pivots about the slot centre rather than the cube centre. */
function positionGuides(cellIdx) {
  if (!state.rails) return;
  const dim = cfg.dim, size = gridCube.clientWidth || 240;
  const cs = size / dim, off = (dim - 1) / 2;
  const c = state.cells[cellIdx];
  const p = [(c.x - off) * cs, (c.y - off) * cs, (c.z - off) * cs];
  /* Each rail spans its own axis, so it is only offset along the other two. */
  const offsets = [[0, p[1], p[2]], [p[0], 0, p[2]], [p[0], p[1], 0]];
  state.rails.forEach((pair, i) => {
    const [tx, ty, tz] = offsets[i];
    pair.forEach(r => {
      r.el.style.transform =
        `translate3d(${tx}px, ${ty}px, ${tz}px) ${r.orient} rotateX(${r.roll}deg)`;
    });
  });
}

const CELL_VIS_HINT = {
  lattice:  'Every cell drawn faintly. Most spatial context, hardest to read at a glance.',
  contrast: 'Inactive cells nearly invisible; the lit slot is opaque and glows.',
  guides:   'Adds three coloured rails through the lit slot, one per axis — read its position straight off them.',
  solo:     'Only the lit cell and the cube outline. Clearest, but you supply the lattice from memory.',
};

function applyCellVis() {
  ['lattice','contrast','guides','solo'].forEach(v =>
    gridCube.classList.toggle('vis-' + v, cfg.cellVis === v));
  /* Sync the control here too, so cube, hint and select can never disagree. */
  const sel = $('cellVis'), h = $('cellVisHint');
  if (sel) sel.value = cfg.cellVis;
  if (h) h.textContent = CELL_VIS_HINT[cfg.cellVis] || '';
}

function buildGizmo() {
  gizmoEl.innerHTML = '';
  const cubeSize = gridCube.clientWidth || 240;
  const HEAD = cubeSize * 0.10, BADGE = 26;

  /* How far one cube unit travels on screen along each axis at the solved static
     view. The angle that best separates the slots foreshortens the depth axis to
     roughly half of X, which drops the A/B badges right on top of the lattice —
     so each arm is lengthened in inverse proportion to its own foreshortening. */
  let proj = null, reach = 0.68, cap = 1.45;
  if (spinView) {
    /* Yaw carries X and Z each through their flattest moment, |sin pitch|, while the
       vertical axis is held at |cos pitch| for the whole turn. Solving against those
       worst cases is what stops the A/B badges sinking into the lattice halfway
       through every revolution — at a 72° tilt the vertical axis is squashed to a
       third, so its arm has to reach three times as far in cube space to land at the
       same screen radius. */
    const p = spinView.ax * Math.PI / 180;
    const flat = Math.abs(Math.sin(p)), steep = Math.abs(Math.cos(p));
    proj = { x: flat, y: steep, z: flat };
    /* The lattice is compact on screen at this tilt, so a shorter radius already
       clears it — and the cap has to allow the reach the squashed axis needs. */
    reach = 0.66; cap = 2.10;
  } else if (staticView) {
    const a = staticView.ax * Math.PI / 180, b = staticView.ay * Math.PI / 180;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    proj = { x: Math.hypot(cb, sa * sb), y: Math.abs(ca), z: Math.hypot(sb, sa * cb) };
  }
  const armLength = ax => {
    if (!proj) return cubeSize * 0.62;
    const k = ax.vec[0] ? 'x' : ax.vec[1] ? 'y' : 'z';
    /* Puts every badge at the same screen radius, clear of the lattice's half-extent.
       A foreshortened axis reaches further in cube space to get there. */
    return Math.min(cubeSize * cap, (cubeSize * reach) / Math.max(proj[k], 0.18));
  };

  AXES.forEach(ax => {
    const L = armLength(ax);
    const arm = document.createElement('div');
    arm.className = 'arm';
    arm.dataset.axis = ax.id;
    arm.style.color = ax.color;
    arm.style.transform = AXIS_ORIENT[ax.id];   // local +X now points along this axis

    /* Shaft: two planes crossed at 90° about the arm, so it never vanishes edge-on. */
    [0, 90].forEach(roll => {
      const s = document.createElement('div');
      s.className = 'shaft';
      s.style.width = L + 'px';
      s.style.background = ax.color;
      s.style.transform = `rotateX(${roll}deg)`;
      arm.appendChild(s);

      const h = document.createElement('div');
      h.className = 'head';
      h.style.width = HEAD + 'px';
      h.style.height = HEAD * 0.85 + 'px';
      h.style.top = `${-HEAD * 0.425}px`;
      h.style.left = L + 'px';
      h.style.background = ax.color;
      h.style.transform = `rotateX(${roll}deg)`;
      arm.appendChild(h);
    });

    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.style.width = badge.style.height = BADGE + 'px';
    badge.style.left = `${L + HEAD}px`;
    badge.style.top = `${-BADGE / 2}px`;
    badge.style.transform = invertOrient(ax.id);   // keep the letter upright
    const faces = addFaces(badge, BADGE, 'badge-face', ax.letter);
    faces.forEach(f => { f.style.color = ax.color; f.style.border = `1px solid ${ax.color}`; });
    arm.appendChild(badge);

    gizmoEl.appendChild(arm);
  });
  applyGizmoMode();
}

function invertOrient(id) {
  return ({
    east: '', west: 'rotateY(-180deg)', south: 'rotateZ(-90deg)',
    north: 'rotateZ(90deg)', above: 'rotateY(90deg)', below: 'rotateY(-90deg)',
  })[id];
}

function applyGizmoMode() {
  gizmoEl.classList.toggle('hidden', cfg.gizmo === 'off');
  gizmoEl.classList.toggle('letters-only', cfg.gizmo === 'letters');
  /* Redundant when buildCube set it a moment ago, but this runs on its own too. */
  document.documentElement.classList.toggle('gizmo-off', cfg.gizmo === 'off');
}

function flashArm(axisId) {
  const arm = gizmoEl.querySelector(`.arm[data-axis="${axisId}"]`);
  if (!arm) return;
  arm.classList.add('flash');
  setTimeout(() => arm.classList.remove('flash'), 200);
}

function applyRotation() {
  cubeWrapper.style.setProperty('--spin-speed', cfg.spin + 's');
  /* The keyframes read the pitch from here, so it has to be in place before the
     animation starts. */
  const freeSpin = cfg.spinPath === 'free';
  const sv = cfg.rotation && !freeSpin ? solveSpinView(cfg.dim) : null;
  cubeWrapper.style.setProperty('--spin-pitch', (sv ? sv.ax : -30) + 'deg');
  cubeWrapper.classList.toggle('free-spin', freeSpin);
  /* Restart rather than retarget: a running animation does not re-read a custom
     property it already sampled, so a changed tilt would otherwise never take.
     Only when it CHANGED, though — applyRotation runs at the end of every rebuild,
     and restarting on each one snapped the cube back to the top of its turn every
     time anything touched the layout. */
  const spinKey = cfg.rotation ? `${freeSpin ? 'tumble' : 'spin'}:${sv ? sv.ax : ''}` : '';
  if (spinKey !== state.spinKey) {
    state.spinKey = spinKey;
    cubeWrapper.classList.remove('spinning');
    void cubeWrapper.offsetWidth;
    cubeWrapper.classList.toggle('spinning', cfg.rotation);
  }

  /* The solved angle is what makes the spaced layout non-overlapping, so it has to be
     applied — the CSS default of -24°/-28° is not the solution. */
  if (!cfg.rotation && staticView)
    cubeWrapper.style.transform = `rotateX(${staticView.ax}deg) rotateY(${staticView.ay}deg)`;
  else
    cubeWrapper.style.transform = '';
}

/* ============================================================
   7. REFERENCE FRAME
   ============================================================ */

/* Live rotation matrix of the spinning wrapper. getComputedStyle returns the
   interpolated matrix mid-animation, so this is exact rather than re-derived. */
function currentMatrix() {
  const t = getComputedStyle(cubeWrapper).transform;
  if (!t || t === 'none') return null;
  try { return new DOMMatrixReadOnly(t); } catch (e) { return null; }
}

function projectScreen(d, matrix) {
  if (!matrix) return d;
  const p = matrix.transformPoint({ x: d[0], y: d[1], z: d[2], w: 0 });
  return [p.x, p.y, p.z];
}

function normalise(v) {
  const m = Math.hypot(v[0], v[1], v[2]);
  return m < 1e-6 ? [0, 0, 0] : [v[0]/m, v[1]/m, v[2]/m];
}

