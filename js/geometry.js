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

/* ---- Fitting the drawing to the box it is given ----
 *
 * The stage has to reserve the footprint of the whole DRAWING — lattice, arrows
 * and letter badges together — because the badges reach well past the cube and a
 * stage sized to the cube alone clips them. That multiplier used to be a table of
 * hand-measured constants in CSS, one per combination of layout, rotation and
 * gizmo, and every one of them carried slack: a number nobody could tighten
 * without re-measuring by eye. On a phone the slack came straight out of the
 * lattice, because there the box is fixed and the cube is the box divided by the
 * multiplier.
 *
 * So it is solved instead. Everything drawn is at a known point in cube space, the
 * viewing angles are known (and for a turning cube, sampled over the whole turn),
 * and the projection is the same one the rest of this file already uses. Project
 * the corners of the lattice and the four corners of every badge, take the widest
 * and tallest the set ever gets, and that IS the footprint — no reserve, no guess.
 *
 * Two things the old constants could not do fall out of it for free: the badges
 * are placed just clear of the lattice rather than at a fixed generous radius, and
 * the footprint is returned as a width and a height separately, so a stage that is
 * wider than it is tall can be filled in both directions.
 */

/* Matches .scene's `perspective`. A cube face swung toward the viewer is drawn
   larger than one swung away, by as much as a fifth at these sizes, so a footprint
   computed orthographically comes out too small exactly where it matters. */
const PERSP = 1400;

/* rotateX(a) rotateY(b) applied to a cube-space point, matching the CSS order. */
function rotPoint(p, a, b) {
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const x1 = p[0] * cb + p[2] * sb;
  const z1 = -p[0] * sb + p[2] * cb;
  return [x1, p[1] * ca - z1 * sa, p[1] * sa + z1 * ca];
}

/* Where a cube-space point lands on screen, and how much the perspective divide
   magnifies anything drawn there — a badge at that depth is scaled by the same `s`. */
function screenPoint(p, a, b) {
  const q = rotPoint(p, a, b);
  const s = PERSP / Math.max(PERSP - q[2], PERSP * 0.2);
  return { x: q[0] * s, y: q[1] * s, s };
}

/* Length on screen of a unit step along `v`. Orthographic on purpose: this is how
   much an axis is foreshortened, not where it ends up. */
function screenDirLen(v, a, b) {
  const q = rotPoint(v, a, b);
  return Math.hypot(q[0], q[1]);
}

/* Every attitude the cube is held at, as (pitch, yaw) pairs.
   `rolled` marks the solved spin, whose outer rotateZ turns the finished picture in
   its own plane — so its footprint is a circle, not the box of any one frame. */
function viewSamples(dim) {
  const D = Math.PI / 180;
  const solvedSpin = cfg.rotation && cfg.spinPath !== 'free';
  if (solvedSpin) {
    const sv = solveSpinView(dim), list = [];
    for (let ay = 0; ay < 360; ay += 4) list.push([sv.ax * D, ay * D]);
    return { list, rolled: true, tumble: false };
  }
  if (cfg.rotation) {
    /* The free tumble sweeps pitch and yaw together, one turn of each. */
    const list = [];
    for (let t = 0; t < 1; t += 1 / 72) list.push([(-30 + 360 * t) * D, 360 * t * D]);
    return { list, rolled: false, tumble: true };
  }
  const sv = (cfg.layout || 'dense') === 'spaced'
    ? solveStaticView(dim)
    : { ax: -24, ay: -28 };            // the resting transform in scene.css
  return { list: [[sv.ax * D, sv.ay * D]], rolled: false, tumble: false };
}

/* Lattice pitch, cell edge and half-extent for a cube box of `size` px. Pulled out
   of buildCube so the footprint can be solved without building anything. */
function latticeMetrics(dim, size) {
  const layout = cfg.layout || 'dense';
  const solvedSpin = cfg.rotation && cfg.spinPath !== 'free';
  const off = (dim - 1) / 2;
  let step = size / dim, cellSize = step;
  if (layout === 'spaced') {
    const v = solvedSpin ? solveSpinView(dim) : solveStaticView(dim);
    const span = (cfg.rotation && !solvedSpin) ? (dim - 1) * Math.sqrt(3)
                                               : Math.max(v.w, v.h);
    step = size / span;
    cellSize = Math.min(step * SPREAD_CELL, v.sep * step * MAX_CELL_PER_GAP);
  }
  return { step, cellSize, half: off * step + cellSize / 2 };
}

/* The whole drawing, solved: how long each arm has to be, how big a badge to draw,
   and the width and height the result needs, as multiples of `size`. */
function solveDrawing(dim, size) {
  const m = latticeMetrics(dim, size);
  const views = viewSamples(dim);
  const S = m.half;

  const corners = [];
  for (const x of [-S, S]) for (const y of [-S, S]) for (const z of [-S, S])
    corners.push([x, y, z]);

  let latR = 0, hx = 0, hy = 0;
  for (const [a, b] of views.list) for (const c of corners) {
    const p = screenPoint(c, a, b);
    latR = Math.max(latR, Math.hypot(p.x, p.y));
    hx = Math.max(hx, Math.abs(p.x));
    hy = Math.max(hy, Math.abs(p.y));
  }

  const HEAD = size * 0.10;
  /* Proportional, with a floor that keeps the letter legible on a small cube. A
     fixed 26px badge was a fifth of the whole footprint once the cube was phone
     sized, and it is the footprint that decides how big the cube may be. */
  const BADGE = Math.round(Math.min(28, Math.max(16, size * 0.105)));
  /* Where a badge has to sit: just outside the furthest the lattice ever reaches,
     in any direction, plus a gap so the two never touch. The old fixed 0.68 × size
     was well beyond that in the directions where the lattice is narrow. */
  const clear = latR + Math.max(7, size * 0.05);

  const L = {};
  AXES.forEach(ax => {
    if (views.tumble) {
      /* Under a free tumble the same rod swings side-on and reaches its full length
         across the screen, so lengthening it against foreshortening throws the badge
         clean off the stage. The arm is the clearance radius and no more. */
      L[ax.id] = clear;
      return;
    }
    /* A foreshortened axis has to reach further in cube space to land at the same
       screen radius, and the figure that matters is its WORST moment of the turn —
       otherwise the badges sink into the lattice halfway through every revolution. */
    let worst = Infinity;
    for (const [a, b] of views.list)
      worst = Math.min(worst, screenDirLen(ax.vec, a, b));
    L[ax.id] = Math.min(size * 2.1, clear / Math.max(worst, 0.18));
  });

  if (cfg.gizmo !== 'off') {
    let R = latR;
    for (const [a, b] of views.list) AXES.forEach(ax => {
      const d = L[ax.id] + HEAD + BADGE / 2;            // badge centre, along the arm
      const p = screenPoint([ax.vec[0] * d, ax.vec[1] * d, ax.vec[2] * d], a, b);
      /* The badge is turned back upright, so it is an axis-aligned square on screen,
         scaled by the perspective at its own depth. */
      const pad = BADGE * 0.5 * p.s;
      hx = Math.max(hx, Math.abs(p.x) + pad);
      hy = Math.max(hy, Math.abs(p.y) + pad);
      R = Math.max(R, Math.hypot(p.x, p.y) + pad * Math.SQRT2);
    });
    if (views.rolled) hx = hy = R;
  } else if (views.rolled) {
    hx = hy = latR;
  }

  return { ...m, L, HEAD, BADGE, kx: 2 * hx / size, ky: 2 * hy / size };
}

/* Fit mode: the stage is handed the space the header and the dock leave over and
   the cube is solved from it, rather than the cube being guessed from the viewport
   and the stage sized around it. Used wherever the screen is small enough that a
   guess would waste space that the player needs — every phone, and any short window.
 
   Two passes because the badge has a minimum size in px, so the footprint is not
   quite proportional to the cube; one round of feedback settles it. */
function fitStage() {
  const box = cubeStage.getBoundingClientRect();
  const w = box.width, h = box.height;
  if (!w || !h) return;
  const scale = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--cube-scale')) || 1;
  let size = Math.min(w, h) / 1.7;
  for (let i = 0; i < 2; i++) {
    const d = solveDrawing(cfg.dim, size);
    size = Math.min(w / d.kx, h / d.ky);
  }
  /* Rounded, so the resize observer this feeds cannot chase a fractional pixel
     back and forth between two builds. */
  size = Math.max(90, Math.round(size * Math.min(scale, 1)));
  document.documentElement.style.setProperty('--cube-size', size + 'px');
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

  /* Solved whenever the cube spins, layout aside: the gizmo arms are aimed at it too. */
  spinView = solvedSpin ? solveSpinView(dim) : null;

  /* In fit mode the cube is solved from the box the stage was handed, so that has to
     happen before the lattice reads its own width — and after the classes above,
     which are what the footprint is solved against. */
  if (document.documentElement.classList.contains('fit-stage')) fitStage();

  gridCube.innerHTML = '';
  state.cells = [];
  const size = gridCube.clientWidth || 240;
  const off = (dim - 1) / 2;

  /* One solve for the whole drawing: the lattice takes its pitch and cell edge from
     it, buildGizmo takes its arm lengths, and the stage takes the footprint. */
  const drawing = solveDrawing(dim, size);
  drawing.builtFor = size;
  state.drawing = drawing;
  document.documentElement.style.setProperty('--stage-kx', drawing.kx.toFixed(4));
  document.documentElement.style.setProperty('--stage-ky', drawing.ky.toFixed(4));

  const step = drawing.step, cellSize = drawing.cellSize;

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
       the original did. (Both figures come from latticeMetrics now, so the cube the
       footprint was solved against and the cube that gets built are the same one.)

       Sized against the lattice PITCH, not against the tightest projected gap. Tying
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
  /* Arm lengths, head and badge all come from the same solve that sized the stage,
     so what is drawn and what was reserved for it can never disagree. */
  const drawing = (state.drawing && state.drawing.builtFor === cubeSize)
    ? state.drawing : solveDrawing(cfg.dim, cubeSize);
  const HEAD = drawing.HEAD, BADGE = drawing.BADGE;

  AXES.forEach(ax => {
    const L = drawing.L[ax.id];
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

