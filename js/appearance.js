"use strict";

/* ============================================================
   11a. APPEARANCE (own file: shared by the deck, the gizmo and the settings panel)

   Stored under its OWN localStorage key. A background photo is orders of magnitude
   bigger than everything else the app saves, and sharing a key with the training
   history would mean one large image could evict a tester's block data.
   ============================================================ */

const APPEAR_KEY = 'rnb.appearance.v1';

/* Each theme is a full set of surface tokens, not a hue shift. `muted` and `input`
   are in here rather than fixed on :root because the dimmer themes need a brighter
   secondary text to stay readable, and the lighter ones need the reverse — a single
   global value looked washed out at one end of the range and shouty at the other.

   All of them are dark. The scene is built on luminous marks against a dark ground —
   the lit cell, the gizmo badges, the glows — and a light ground would need every one
   of those re-derived rather than re-tinted, so it is a separate job, not a row here. */
const THEMES = {
  midnight: { bg:'#0b0d10', glow:'#121728', panel:'#141820', panel2:'#0f1218',
              text:'#e6ebff', muted:'rgba(230,235,255,.55)', input:'#0e121a',
              border:'rgba(180,200,255,.45)', borderIn:'rgba(180,200,255,.18)',
              accent:'#4d7fd6' },
  slate:    { bg:'#12151a', glow:'#1e2530', panel:'#1b2029', panel2:'#161a22',
              text:'#e8ecf2', muted:'rgba(232,236,242,.56)', input:'#12161d',
              border:'rgba(200,212,228,.42)', borderIn:'rgba(200,212,228,.16)',
              accent:'#7f9bc4' },
  void:     { bg:'#000000', glow:'#0a0a0f', panel:'#0d0d0f', panel2:'#070708',
              text:'#e9e9ee', muted:'rgba(233,233,238,.52)', input:'#0a0a0c',
              border:'rgba(255,255,255,.34)', borderIn:'rgba(255,255,255,.13)',
              accent:'#9aa0ff' },
  nebula:   { bg:'#0d0a14', glow:'#221340', panel:'#191428', panel2:'#120f1c',
              text:'#ece6ff', muted:'rgba(236,230,255,.56)', input:'#150f22',
              border:'rgba(214,190,255,.44)', borderIn:'rgba(214,190,255,.17)',
              accent:'#b07dff' },
  forest:   { bg:'#080f0c', glow:'#0f2119', panel:'#101a16', panel2:'#0b1310',
              text:'#e2f2e9', muted:'rgba(226,242,233,.55)', input:'#0b1511',
              border:'rgba(180,235,205,.40)', borderIn:'rgba(180,235,205,.15)',
              accent:'#4fc98a' },
  abyss:    { bg:'#04121a', glow:'#062a3a', panel:'#0a1d27', panel2:'#06141d',
              text:'#dff2fb', muted:'rgba(223,242,251,.56)', input:'#06171f',
              border:'rgba(150,220,245,.42)', borderIn:'rgba(150,220,245,.16)',
              accent:'#3fc6e8' },
  ember:    { bg:'#140b08', glow:'#331508', panel:'#1f120d', panel2:'#160c08',
              text:'#ffeade', muted:'rgba(255,234,222,.56)', input:'#1a0f0a',
              border:'rgba(255,190,150,.40)', borderIn:'rgba(255,190,150,.15)',
              accent:'#ff8551' },
  graphite: { bg:'#0f0f10', glow:'#1a1a1c', panel:'#181819', panel2:'#111112',
              text:'#ececee', muted:'rgba(236,236,238,.50)', input:'#131314',
              border:'rgba(255,255,255,.28)', borderIn:'rgba(255,255,255,.11)',
              accent:'#b9bfc7' },
  plum:     { bg:'#130910', glow:'#2e0f28', panel:'#1e1019', panel2:'#150a11',
              text:'#fbe4f3', muted:'rgba(251,228,243,.55)', input:'#1a0d15',
              border:'rgba(245,180,225,.40)', borderIn:'rgba(245,180,225,.15)',
              accent:'#ef6fb5' },
  sepia:    { bg:'#12100a', glow:'#241f10', panel:'#1c1810', panel2:'#141109',
              text:'#f3ead6', muted:'rgba(243,234,214,.55)', input:'#16130c',
              border:'rgba(235,215,165,.38)', borderIn:'rgba(235,215,165,.14)',
              accent:'#d8ae5c' },
  ocean:    { bg:'#071018', glow:'#0b2440', panel:'#0e1a28', panel2:'#09121c',
              text:'#dfeaf8', muted:'rgba(223,234,248,.56)', input:'#0a1420',
              border:'rgba(160,200,245,.42)', borderIn:'rgba(160,200,245,.16)',
              accent:'#5aa9f0' },
  moss:     { bg:'#0e1108', glow:'#1c2410', panel:'#161b0e', panel2:'#0f1309',
              text:'#e9f2d8', muted:'rgba(233,242,216,.55)', input:'#11160a',
              border:'rgba(200,230,150,.38)', borderIn:'rgba(200,230,150,.14)',
              accent:'#a8cf5c' },
};

const ACCENTS = ['#4d7fd6', '#8ab4ff', '#51cf66', '#ffb74d', '#ff6b6b', '#cc5de8', '#4dd0e1'];

/* Okabe–Ito: six hues that stay distinguishable under the common colour-vision
   deficiencies. The axis colours are semantic (they match the buttons), so the set
   swaps together or not at all. */
const AXIS_PALETTES = {
  default: { north:'#4dabf7', south:'#ff6b6b', east:'#51cf66',
             west:'#fcc419', above:'#cc5de8', below:'#ff922b' },
  cb:      { north:'#56b4e9', south:'#d55e00', east:'#009e73',
             west:'#e69f00', above:'#cc79a7', below:'#f0e442' },
};

const appearance = {
  theme: 'midnight', accent: '#4d7fd6', dim: 68,
  palette: 'default', flat: false, bgFit: 'cover', bg: null,
};

function loadAppearance() {
  try {
    const raw = localStorage.getItem(APPEAR_KEY);
    if (raw) Object.assign(appearance, JSON.parse(raw));
  } catch (e) { /* corrupt or unavailable — defaults are fine */ }
}

function saveAppearance() {
  try {
    localStorage.setItem(APPEAR_KEY, JSON.stringify(appearance));
    return true;
  } catch (e) {
    /* Almost always the image. Drop it rather than losing the other preferences. */
    const had = !!appearance.bg;
    appearance.bg = null;
    try { localStorage.setItem(APPEAR_KEY, JSON.stringify(appearance)); } catch (e2) {}
    if (had) {
      applyAppearance();
      $('bgStatus').innerHTML =
        '<span style="color:#ff6b6b">Image too large to store — it has been cleared. ' +
        'Try a smaller one.</span>';
    }
    return false;
  }
}

/* ---- deriving the rest of the palette ----
   Only a handful of colours are authored. Everything else the scene needs — the
   lattice tint, the lit cell and its glow, the ink that has to stay legible on top
   of it, the HUD's highlight — is computed from the theme's own border hue and from
   the accent, so a warm theme cannot end up with a cold blue cube sitting in it.
   That mismatch was the whole complaint. */
function rgbOf(c) {
  if (c[0] === '#') {
    const h = c.length === 4
      ? c.slice(1).split('').map(x => x + x).join('')
      : c.slice(1, 7);
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  const m = c.match(/[\d.]+/g) || [0, 0, 0];
  return m.slice(0, 3).map(Number);
}
const rgba = (c, a) => { const [r, g, b] = rgbOf(c); return `rgba(${r},${g},${b},${a})`; };
/* Toward white by t, for the lighter sibling of the accent the HUD reads best in. */
const lighten = (c, t) => {
  const [r, g, b] = rgbOf(c).map(v => Math.round(v + (255 - v) * t));
  return `rgb(${r},${g},${b})`;
};
/* Rec. 709 luma, 0–1. Decides whether text on top of a colour should be dark. */
const luma = c => { const [r, g, b] = rgbOf(c).map(v => v / 255);
                    return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

function applyAppearance() {
  const t = THEMES[appearance.theme] || THEMES.midnight;
  const r = document.documentElement.style;
  r.setProperty('--bg', t.bg);
  r.setProperty('--bg-glow', t.glow);
  r.setProperty('--panel', t.panel);
  r.setProperty('--panel-2', t.panel2);
  r.setProperty('--text', t.text);
  r.setProperty('--muted', t.muted);
  r.setProperty('--input-bg', t.input);
  r.setProperty('--border-outer', t.border);
  r.setProperty('--border-inner', t.borderIn);
  /* Cube structure follows the THEME hue: the lattice and the frame are scenery, and
     they should read as part of the room rather than competing with the signal. */
  r.setProperty('--cell-fill', rgba(t.border, 0.085));
  r.setProperty('--cell-fill-dim', rgba(t.border, 0.028));
  r.setProperty('--cell-edge-dim', rgba(t.border, 0.09));
  r.setProperty('--frame-line', rgba(t.border, 0.26));

  /* The lit cell and every highlight follow the ACCENT, which the theme picks for
     you. Two related hues rather than one: scenery in the theme's, signal in the
     accent's, so the active slot still jumps out of the lattice it sits in. */
  const acc = appearance.accent;
  r.setProperty('--accent', acc);
  r.setProperty('--hi', lighten(acc, 0.42));
  r.setProperty('--accent-glow', rgba(acc, 0.55));
  r.setProperty('--accent-ink', luma(acc) > 0.55 ? '#0a0f14' : '#ffffff');
  r.setProperty('--cell-active', rgba(acc, 0.72));
  r.setProperty('--cell-active-solid', acc);
  r.setProperty('--cell-active-edge', lighten(acc, 0.65));
  r.setProperty('--cell-glow', rgba(acc, 0.8));
  r.setProperty('--cell-ink', luma(acc) > 0.5 ? '#08131a' : '#ffffff');
  r.setProperty('--bg-dim', (appearance.dim / 100).toFixed(2));

  const layer = $('bgLayer');
  layer.classList.toggle('on', !!appearance.bg);
  layer.style.backgroundImage = appearance.bg ? `url(${appearance.bg})` : '';
  layer.style.backgroundSize = appearance.bgFit;
  document.body.classList.toggle('has-bg', !!appearance.bg);

  document.body.classList.toggle('flat', !!appearance.flat);

  /* Axis colours live on the AXES constants because the gizmo and the deck both read
     them, so a palette change has to rebuild both. */
  const pal = AXIS_PALETTES[appearance.palette] || AXIS_PALETTES.default;
  AXES.forEach(a => { a.color = pal[a.id]; });
  STREAMS.position.relational.forEach(c => { c.color = pal[c.id]; });
  if (state.cells.length) { buildGizmo(); buildDeck(); }

  renderAppearanceUI();
}

/* Title case for a theme id. They are all single lowercase words. */
const themeName = id => id[0].toUpperCase() + id.slice(1);

function renderAppearanceUI() {
  /* A grid of previews rather than a dropdown: with a dozen entries, names alone tell
     you nothing, and each swatch can simply be painted in its own tokens. */
  const grid = $('themeGrid');
  if (grid && !grid.children.length) {
    Object.entries(THEMES).forEach(([id, t]) => {
      const b = document.createElement('button');
      b.className = 'theme-swatch';
      b.dataset.t = id;
      b.style.background = `linear-gradient(150deg, ${t.glow}, ${t.bg} 62%)`;
      b.innerHTML = `<span class="tsw-chip" style="background:${t.panel};` +
                    `border-color:${t.border}"></span>` +
                    `<span class="tsw-nm" style="color:${t.text}">${themeName(id)}</span>`;
      /* Adopting the theme's accent is the point of the grid — the lit cell, the HUD
         and the progress bar are all drawn from it, so a theme that did not bring one
         would leave the previous theme's hue sitting in the middle of the new one.
         The accent row below still overrides it afterwards. */
      b.onclick = () => {
        appearance.theme = id;
        appearance.accent = THEMES[id].accent;
        applyAppearance(); saveAppearance();
      };
      grid.appendChild(b);
    });
  }
  if (grid) [...grid.children].forEach(b =>
    b.classList.toggle('on', b.dataset.t === appearance.theme));

  $('accentCustom').value = appearance.accent;
  $('bgDim').value = appearance.dim;
  $('dimVal').textContent = appearance.dim;
  $('axisPalette').value = appearance.palette;
  $('flatMode').checked = !!appearance.flat;
  const row = $('accentRow');
  if (row && !row.children.length) {
    ACCENTS.forEach(c => {
      const b = document.createElement('button');
      b.className = 'swatch-btn'; b.style.background = c; b.dataset.c = c;
      b.onclick = () => { appearance.accent = c; applyAppearance(); saveAppearance(); };
      row.appendChild(b);
    });
  }
  if (row) [...row.children].forEach(b =>
    b.classList.toggle('on', b.dataset.c === appearance.accent));
  if (!appearance.bg) $('bgStatus').textContent =
    'Downscaled and stored separately from your training data, so a large photo can ' +
    'never push out block history.';
}

/* Downscale before storing. A phone photo is several MB as a data URI, which would
   blow the quota on its own; this keeps it to a few hundred KB. */
function setBackgroundFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 1920;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      appearance.bg = cv.toDataURL('image/jpeg', 0.72);
      applyAppearance();
      if (saveAppearance()) {
        $('bgStatus').textContent =
          `${w}×${h}, ${Math.round(appearance.bg.length / 1024)} KB stored.`;
      }
    };
    img.onerror = () => { $('bgStatus').innerHTML =
      '<span style="color:#ff6b6b">Could not read that image.</span>'; };
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
}
