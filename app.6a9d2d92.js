import { createModel, cruise, formatRate, rateDigits } from './model.ad2f0250.js';
import { formatLevel, killCaption, cellNote, formatHitPoints } from './combat.ae28ee07.js';

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

// ---------------------------------------------------------------- combat table
// Two switchers, asteroid type and shots to kill, so six combinations. Every
// threshold was solved at build time and is embedded as a lookup cube, because
// solving them here cost 260 ms per tab click - the solver walks research levels
// one at a time, and a cell no level satisfies walks all 20,000 of them.
// Formatting still comes from the shared module, so a threshold cannot render
// one way in the pre-rendered table and another way after a click.
const combatData = document.getElementById('combat');
if (combatData) {
  const C = JSON.parse(combatData.textContent);
  const table = document.getElementById('kill-grid');
  const caption = document.getElementById('kill-caption');
  const pick = { kindIndex: 0, shotIndex: 0 };

  const CELL_CLASS = { free: '', impossible: 'hacky', plain: '' };

  const renderKills = () => {
    const kind = C.kinds[pick.kindIndex];
    const rows = C.levels[pick.kindIndex][pick.shotIndex];

    // Asteroid sprites: three types for the standard kinds, one for promethium.
    // The markup is built at build time, one string per kind, so the browser is
    // only choosing between them.
    table.querySelectorAll('thead td[data-rocks]').forEach(td => {
      const size = C.sizes.find(x => x.size === td.dataset.rocks);
      td.innerHTML = size.rocks[pick.kindIndex];
    });

    // Hit points sit in their own row under the size headers, and double for
    // promethium. The size names themselves never change.
    table.querySelectorAll('thead td[data-size]').forEach(td => {
      const size = C.sizes.find(x => x.size === td.dataset.size);
      td.textContent = `${formatHitPoints(size.hp * kind.mul)} HP`;
    });

    table.querySelectorAll('tbody tr').forEach((tr, r) => {
      const weapon = C.weapons[r];
      const family = C.families[weapon.family];
      tr.querySelectorAll('td').forEach((td, c) => {
        const level = rows[r][c];
        const { text, state } = formatLevel(level);
        td.textContent = text;
        td.className = CELL_CLASS[state];
        td.title = cellNote(level, family, weapon.tech_name);
      });
    });

    caption.innerHTML = killCaption({ kind, shots: C.shotCounts[pick.shotIndex] });
  };

  /** Wire one strip; `apply` maps the chosen index onto `pick`. */
  const wireStrip = (id, apply) => {
    const strip = document.getElementById(id);
    if (!strip) return;
    const buttons = [...strip.querySelectorAll('[role="tab"]')];
    const select = i => {
      buttons.forEach((b, n) => {
        b.setAttribute('aria-selected', String(n === i));
        b.tabIndex = n === i ? 0 : -1;
      });
      apply(i);
      renderKills();
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
  };

  wireStrip('kind-tabs', i => { pick.kindIndex = i; });
  wireStrip('shot-tabs', i => { pick.shotIndex = i; });
  renderKills();
}

// ---------------------------------------------------------------- wiki card
// A card for the item, entity or technology a link points at: the icon at full
// size, the game's own name, what kind of thing it is, and a link to the wiki
// article marked as leaving the site.
//
// Hand-rolled rather than pulled in. The content is four static fields; the only
// hard part is placement. A positioning library earns its size when tooltips
// flip, carry arrows or anchor to virtual elements, none of which this does.
//
// Everything it shows comes off the anchor's own data attributes, written by
// wiki.mjs at build time, so the card cannot disagree with the link it describes
// and there is no second lookup table to keep in step.
//
// Progressive enhancement: with no JavaScript the links still work. The card
// only ever adds.
const TYPE_LABEL = {
  item: 'Item', entity: 'Entity', fluid: 'Fluid', equipment: 'Equipment',
  technology: 'Technology', 'asteroid-chunk': 'Asteroid chunk',
  'space-location': 'Space location', tile: 'Tile', quality: 'Quality',
};

(() => {
  if (!document.querySelector('.iref[data-name]')) return;
  const wiki = JSON.parse(document.getElementById('wiki-meta')?.textContent || '{}');

  const card = document.createElement('div');
  card.className = 'iref-card';
  card.hidden = true;
  document.body.append(card);

  let anchor = null;
  let closing = null;

  const place = () => {
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const gap = 6, margin = 8;
    // Below and left-aligned by default, so the card grows down and to the
    // right from the trigger's bottom-left corner. Above only when there is no
    // room below; clamped horizontally because the table scrolls sideways and
    // links near an edge are the normal case, not the exception.
    const below = a.bottom + gap;
    const top = below + c.height + margin <= window.innerHeight
      ? below
      : Math.max(margin, a.top - c.height - gap);
    const left = Math.min(Math.max(margin, a.left),
                          window.innerWidth - c.width - margin);
    card.style.top = `${Math.round(top)}px`;
    card.style.left = `${Math.round(left)}px`;
  };

  const build = el => {
    const { name, type, icon } = el.dataset;
    card.replaceChildren();

    const img = document.createElement('img');
    img.className = 'big';
    img.src = icon;
    img.alt = '';

    const text = document.createElement('div');

    // Header row: name, then the logo pushed to the far corner by a spacer.
    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('strong');
    title.textContent = name;
    head.append(title);

    // A real link, which is why the card has to be hoverable - see `closing`.
    if (wiki.base && wiki.logo) {
      const link = document.createElement('a');
      link.className = 'wiki';
      link.href = el.dataset.page;
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = 'Open the official Factorio wiki article in a new tab';
      const logo = document.createElement('img');
      logo.src = wiki.base + wiki.logo;
      logo.alt = 'Factorio wiki';
      link.append(logo);
      head.append(link);
    }

    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = TYPE_LABEL[type] || type;

    text.append(head, kind);
    card.append(img, text);
  };

  const show = el => {
    clearTimeout(closing);
    anchor = el;
    build(el);
    card.hidden = false;
    place();
  };

  // Closing on a delay is what makes the link reachable: the pointer has to
  // cross the gap between the trigger and the card, and an immediate hide took
  // the card away mid-journey. Entering the card cancels the close.
  const scheduleHide = () => {
    clearTimeout(closing);
    closing = setTimeout(() => { card.hidden = true; anchor = null; }, 220);
  };
  const hideNow = () => { clearTimeout(closing); card.hidden = true; anchor = null; };

  // Delegated, not bound per element. The asteroid row is replaced when the
  // type switcher changes, and per-element handlers died with the old markup -
  // the icons stopped responding after one click of the switcher.
  document.addEventListener('mouseover', e => {
    const trigger = e.target.closest?.('.iref[data-name]');
    if (!trigger || trigger === anchor) return;
    show(trigger);
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest?.('.iref[data-name]')) scheduleHide();
  });
  card.addEventListener('mouseenter', () => clearTimeout(closing));
  card.addEventListener('mouseleave', scheduleHide);

  // position:fixed, so the card has to follow its anchor when anything scrolls.
  // It repositions rather than hides: focusing a link scrolls it into view, and
  // hiding on scroll made the card vanish the instant keyboard focus arrived.
  const follow = () => {
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const gone = a.bottom < 0 || a.top > window.innerHeight
      || a.right < 0 || a.left > window.innerWidth;
    if (gone) hideNow(); else place();
  };
  addEventListener('scroll', follow, { passive: true, capture: true });
  addEventListener('resize', follow, { passive: true });
})();
