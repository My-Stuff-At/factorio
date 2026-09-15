import { createModel, cruise, formatRate, rateDigits } from './model.ad2f0250.js';

// Recompute the speed table for any combination of thruster quality, leg phase
// and fill. The physics lives in model.mjs and is shared with the build and the
// test suite, so the interactive table cannot drift from the pre-rendered one.
const MODEL = JSON.parse(document.getElementById('model').textContent);
const M = createModel({
  performance: MODEL.performance,
  calibrationFill: MODEL.calibrationFill,
  thrustPerThruster: MODEL.thrustPerThruster,
  qualityScale: MODEL.qualityScale,
});

const FILL_MARKS = [10, Math.round(MODEL.calibrationFill * 100), 80];
const SNAP = 2;

const state = { quality: 'normal', phase: 'baseline', fill: MODEL.calibrationFill };

const num = v => Math.round(v).toLocaleString('en-US');

function render() {
  const { quality, phase, fill } = state;
  const thrustPer = M.thrustAt(fill, quality);
  const delta = MODEL.phaseDelta[phase];

  const speeds = MODEL.widths.map(w =>
    MODEL.thrusterCounts.map(n =>
      cruise({ thrusters: n, width: w, weight: MODEL.weight, thrustPer })));
  const flat = speeds.flat();
  const lo = Math.min(...flat), hi = Math.max(...flat);

  const table = document.getElementById('speed-grid');
  table.querySelectorAll('tbody tr').forEach((tr, r) => {
    tr.querySelectorAll('td').forEach((td, c) => {
      const v = speeds[r][c];
      td.textContent = v > 0 ? num(v + delta) : '—';
      td.classList.toggle('stalled', v <= 0);
      td.style.setProperty('--t', ((v - lo) / (hi - lo || 1)).toFixed(3));
    });
  });

  const per = M.fluidPerSecond(fill, quality);
  const rates = MODEL.thrusterCounts.map(n => n * per);
  const digits = rateDigits(rates);
  document.querySelectorAll('#fuel-row td').forEach((td, c) => {
    td.textContent = formatRate(rates[c], digits);
  });

  document.getElementById('grid-caption').textContent =
    `${MODEL.qualityLabels[quality]} thrusters, ${num(MODEL.tiles)}-tile hull, ` +
    `${Math.round(fill * 100)}% fill. ${MODEL.phaseLabels[phase]}.`;
}

/** wire one tab strip; `key` names both the dataset attribute and the state field */
function wireTabs(id, key) {
  const strip = document.getElementById(id);
  if (!strip) return;
  const buttons = [...strip.querySelectorAll('[role="tab"]')];
  const select = i => {
    buttons.forEach((b, n) => {
      b.setAttribute('aria-selected', String(n === i));
      b.tabIndex = n === i ? 0 : -1;
    });
    state[key] = buttons[i].dataset[key];
    render();
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => select(i));
    b.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const n = (i + d + buttons.length) % buttons.length;
      select(n);
      buttons[n].focus();
    });
  });
}

// The controls are in the markup and visible from first paint; script only
// makes them work. Guarded so the rest of the file still runs if they are absent.
const controls = document.getElementById('controls');
if (controls) {
  wireTabs('quality-tabs', 'quality');
  wireTabs('phase-tabs', 'phase');

  const slider = document.getElementById('fill');
  const out = document.getElementById('fill-value');

  // Snapping applies to DRAGGING ONLY. It exists to make the useful fills easy
  // to hit with a pointer, but applied to every input it also makes the values
  // beside them unreachable - with a +/-2 pull there is no way to select 8% or
  // 42% at all. So a drag snaps, and the fine controls (the buttons, and the
  // arrow keys a focused slider already answers) step by exactly one.
  let dragging = false;
  slider.addEventListener('pointerdown', () => { dragging = true; });
  addEventListener('pointerup', () => { dragging = false; });
  slider.addEventListener('keydown', () => { dragging = false; });

  slider.addEventListener('input', () => {
    // datalist draws the ticks but browsers disagree about snapping to them, so
    // snap here instead.
    let pct = Number(slider.value);
    if (dragging) {
      const near = FILL_MARKS.find(m => Math.abs(m - pct) <= SNAP);
      if (near !== undefined) { pct = near; slider.value = String(pct); }
    }
    out.textContent = pct + '%';
    state.fill = pct / 100;
    syncSteps();
    render();
  });

  const down = document.getElementById('fill-down');
  const up = document.getElementById('fill-up');
  const min = Number(slider.min), max = Number(slider.max);

  /** Grey out a step button once its direction has nowhere left to go. */
  const syncSteps = () => {
    const pct = Number(slider.value);
    down.disabled = pct <= min;
    up.disabled = pct >= max;
  };

  const nudge = d => {
    const pct = Math.min(max, Math.max(min, Number(slider.value) + d));
    if (String(pct) === slider.value) return;
    slider.value = String(pct);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  };
  down.addEventListener('click', () => nudge(-1));
  up.addEventListener('click', () => nudge(1));

  syncSteps();
  render();
}

// An alias id sits on an empty span; the heading to flash is the next element.
const headingFor = id => {
  const el = document.getElementById(id);
  if (!el) return null;
  return el.classList.contains('alias') ? el.nextElementSibling : el;
};

// Restart the animation even when the same anchor is clicked twice, and when
// the section is already in view so nothing scrolls.
const flash = id => {
  const h = headingFor(id);
  if (!h) return;
  h.classList.remove('flash');
  void h.offsetWidth;
  h.classList.add('flash');
  h.addEventListener('animationend', () => h.classList.remove('flash'), { once: true });
};

for (const a of document.querySelectorAll('nav a[href^="#"]')) {
  a.addEventListener('click', () => flash(a.getAttribute('href').slice(1)));
}
addEventListener('hashchange', () => flash(location.hash.slice(1)));
if (location.hash) flash(location.hash.slice(1));

// Clicking '#' copies the absolute link instead of only navigating to it.
for (const a of document.querySelectorAll('a.anchor')) {
  a.addEventListener('click', e => {
    const href = a.getAttribute('href');
    history.replaceState(null, '', href);
    flash(href.slice(1));
    if (!navigator.clipboard) return;
    e.preventDefault();
    navigator.clipboard.writeText(location.origin + location.pathname + href).then(() => {
      a.classList.add('copied');
      setTimeout(() => a.classList.remove('copied'), 1200);
    });
  });
}
