// Asteroid combat: how much research a weapon needs to kill in N shots.
//
// Pure functions, no DOM and no filesystem, so the same code runs in the build
// and under `node --test`. This section has no interactive controls, so unlike
// model.mjs it is not shipped to the browser.
//
// The damage model, and the two things about it that are easy to get wrong:
//
//   raw     = base x (1 + ammoBonus) x (1 + turretBonus)
//   applied = max(0, raw - resist.decrease) x (1 - resist.percent)
//
//   1. Physical projectile damage research grants BOTH `ammo-damage bullet` and
//      `turret-attack gun-turret`, at the same increment, and the two MULTIPLY.
//      So bullet damage carries the bonus squared. Checked across every
//      technology in the game, only gun-turret and flamethrower-turret receive
//      turret-attack at all, so rocket, railgun and laser are all linear.
//      The laser turret instead carries a FLAT `damage_modifier` of 2 on its
//      attack parameters, which is a different mechanism with the same shape.
//   2. The flat `decrease` is subtracted before the percentage. On big and huge
//      asteroids that flat term is 2000 and 3000, which is what makes bullets
//      useless against them at any research level a person would reach.

/**
 * Cumulative research bonus at a COMPLETED level.
 *
 * Levels 1-6 are the finite technologies and each carries its own increment;
 * level 7 is infinite and its increment repeats forever.
 *
 * A damage category that does not appear in an early technology contributes
 * ZERO there, not the tail increment - `rocket` is absent from
 * stronger-explosives 1 and 2, and treating those as tail levels overstates the
 * bonus by a full 1.0 forever after.
 */
export function bonusAt(family, level) {
  let b = 0;
  for (let i = 1; i <= level; i++) {
    b += i <= family.finite.length ? family.finite[i - 1] : family.tail;
  }
  return Math.round(b * 1e9) / 1e9;   // the increments are one-decimal by design
}

/**
 * Damage one shot deals before the target's resistances.
 *
 * Exported so the build's self-check and the tests use this exact expression
 * rather than restating it. They did restate it, and the copy omitted
 * `turret_modifier`, which meant the self-check rejected a correct laser figure.
 */
export function rawDamage({ weapon, family, level }) {
  const m = 1 + bonusAt(family, level);
  return weapon.base
    * m * (family.double_dip ? m : 1)      // research, squared for bullets
    * (weapon.turret_modifier ?? 1);       // flat turret multiplier, lasers only
}

/** Damage one shot lands on one asteroid, after resistances. */
export function appliedDamage({ weapon, family, asteroid, level }) {
  const [decrease, percent] = asteroid.resist[weapon.damage_type];
  return Math.max(0, rawDamage({ weapon, family, level }) - decrease) * (1 - percent);
}

/** Shots needed to kill, at a given research level. Infinity if none would. */
export function shotsToKill({ weapon, family, asteroid, level, hpMultiplier = 1 }) {
  // hpMultiplier is 2 for promethium. Its resistances are IDENTICAL to the
  // standard types at every size - verified field by field against data.raw -
  // so hit points are the only thing that changes here.
  const per = appliedDamage({ weapon, family, asteroid, level });
  if (per <= 0) return Infinity;
  return Math.ceil((asteroid.hp * hpMultiplier) / per);
}

/**
 * Lowest completed research level that kills in `shots` or fewer, or null if no
 * level ever will.
 *
 * Closed form, not a search. The research bonus is LINEAR in level - arithmetic
 * increments - and damage is quadratic in the bonus only for bullets, so the
 * level follows directly:
 *
 *   m >= ( hp / (shots * (1 - percent)) + decrease ) / (base * turret)  ^ (1/n)
 *   L  = the first level whose bonus reaches m - 1
 *
 * This replaced a loop that walked upward to a 20,000 cap. Speed was never the
 * reason - the cap was. It returned null past 20,000, so "further than that" and
 * "impossible" rendered identically, and those are not the same claim.
 */
export function levelFor({ weapon, family, asteroid, shots, hpMultiplier = 1 }) {
  const [decrease, percent] = asteroid.resist[weapon.damage_type];

  // The ONLY genuine impossibility: the damage type is fully resisted, so no
  // multiplier reaches the target at any level. Asteroids are 100% immune to
  // electric and fire. Nothing the site lists is affected today, and a cell
  // should say so plainly rather than hide behind a large number.
  if (percent >= 1) return null;

  // --- the guess -----------------------------------------------------------
  // Closed form. Fast and almost always exact, but it is built from a root and
  // two divisions, so it can land a level either side of the truth where the
  // arithmetic is near a tie.
  const n = family.double_dip ? 2 : 1;
  const turret = weapon.turret_modifier ?? 1;
  const needRaw = (asteroid.hp * hpMultiplier) / (shots * (1 - percent)) + decrease;
  const wantBonus = Math.pow(needRaw / (weapon.base * turret), 1 / n) - 1;

  let level = 0;
  if (wantBonus > 0) {
    const finite = family.finite.length;
    const atLast = bonusAt(family, finite);
    level = wantBonus <= atLast
      ? 1                                        // inside the irregular levels
      : finite + Math.ceil((wantBonus - atLast) / family.tail);
  }

  // --- the authority -------------------------------------------------------
  // The FORWARD model decides. It is the same multiply-and-subtract the damage
  // table itself uses, with no roots or logarithms, so it cannot disagree with
  // the published damage figures. The closed form only says where to start
  // looking, and this walks to the first level that actually satisfies it.
  //
  // Correcting rather than tolerating: an epsilon here would be a guess about
  // how much error to forgive, and would still leave the two formulas free to
  // disagree. This makes them agree by construction.
  const kills = L => shotsToKill({ weapon, family, asteroid, level: L, hpMultiplier }) <= shots;
  const LIMIT = 64;   // the guess is within a level or two; more means a real bug
  let steps = 0;
  while (level > 0 && kills(level - 1)) {
    level--;
    if (++steps > LIMIT) throw new Error('levelFor: closed form is far off, walking down');
  }
  while (!kills(level)) {
    level++;
    if (++steps > LIMIT) throw new Error('levelFor: closed form is far off, walking up');
  }
  return level;
}

/**
 * Cumulative research cost to reach a level, as { units, log10, packs }.
 *
 * Costs DOUBLE per level past the finite members - the prototype formula is
 * `base * 2^(level - from)` - so the total outruns a double quickly. `log10`
 * stays meaningful when `units` has become Infinity, which is why both are
 * returned rather than one derived from the other.
 */
export function researchCost(cost, level) {
  let units = 0;
  for (let L = 1; L <= Math.min(level, cost.finite.length); L++) units += cost.finite[L - 1];

  const doublings = Math.max(0, level - Math.max(cost.from - 1, cost.finite.length));
  let log10 = null;
  if (doublings > 0) {
    const geometricLog10 = Math.log10(cost.base) + doublings * Math.log10(2);
    if (geometricLog10 < 15) units += cost.base * (Math.pow(2, doublings) - 1);
    else { units = Infinity; log10 = geometricLog10; }
  }
  if (log10 === null) log10 = units > 0 ? Math.log10(units) : 0;
  return { units, log10, packs: cost.packs };
}

const SUPERSCRIPT = { '0': '⁰', '1': '¹', '2': '²', '3': '³',
  '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const superscript = n => String(n).replace(/[0-9]/g, d => SUPERSCRIPT[d]);

/**
 * Human-readable count: 128k, 23.1M, 1.3B, then a power of ten still in
 * billions once the ladder runs out - 10^35 B rather than 8.7e43.
 *
 * Billions is the top of the ladder on purpose. Past a thousand billion the
 * exact figure carries no meaning a reader can use, and bare scientific
 * notation reads like a parse error; keeping the familiar unit and showing the
 * exponent against it is legible at any magnitude.
 *
 * The exponent is written with Unicode superscript digits rather than markup,
 * because the only place this lands is a title attribute, which is plain text.
 */
export function formatCount({ units, log10 }) {
  if (units !== Infinity) {
    if (units < 1000) return String(Math.round(units));
    for (const [suffix, size] of [['k', 1e3], ['M', 1e6], ['B', 1e9]]) {
      if (units < size * 1000) {
        const scaled = units / size;
        const text = scaled < 10 ? scaled.toFixed(1).replace(/.0$/, '') : String(Math.round(scaled));
        return text + suffix;
      }
    }
  }
  // Beyond a thousand billion, or beyond what a double can hold at all.
  return `10${superscript(Math.round(log10 - 9))} B`;
}

/**
 * Render one level for a table cell, as { text, state }.
 *
 * No threshold any more. An exact level is always shown, however large, because
 * deciding what counts as "too high" is not the table's job - the research cost
 * in the cell's tooltip makes that case far better than a cutoff could. A dash
 * means genuinely impossible, which is a different claim and now the only one
 * the table ever hides a number behind.
 *
 * Shared by the build and the browser: anything restated in two places drifts,
 * and a threshold that rendered differently in the pre-rendered table than in
 * the recomputed one would be invisible until someone switched a tab.
 */
export function formatLevel(level) {
  if (level === null) return { text: '—', state: 'impossible' };
  if (level === 0) return { text: '0', state: 'free' };
  return { text: level.toLocaleString('en-US'), state: 'plain' };
}

/**
 * The table's caption, naming the current selection. Shared with the build,
 * which renders one combination while the browser renders the other five.
 */
export const killCaption = ({ kind, shots }) =>
  `Research levels needed to kill in ${shots === 1 ? 'one shot' : shots + ' shots'}, `
  + `against ${kind.mul === 1 ? 'metallic, carbonic and oxide'
                              : `promethium, at ${kind.mul}&times; hit points`}.`;

/** The full grid: one row per weapon, one entry per asteroid size. */
export function killGrid({ weapons, families, asteroids, shotCounts, hpMultiplier = 1 }) {
  return weapons.map(weapon => ({
    weapon,
    sizes: asteroids.map(asteroid => ({
      asteroid,
      levels: shotCounts.map(shots =>
        levelFor({ weapon, family: families[weapon.family], asteroid, shots, hpMultiplier })),
    })),
  }));
}

/**
 * The note a cell carries on hover: what the number costs, in science.
 *
 * Shared with the browser for the same reason formatLevel is. Three shapes,
 * because three different things can be true of a cell:
 *
 *   0       it already works, and no research is involved at all
 *   null    no level works, which is a property of the resistance
 *   a level what reaching it costs - and that is the honest answer to "is this
 *           level too high", far better than a cutoff, because the cost doubles
 *           every level and says so itself
 */
export function cellNote(level, family, techName) {
  if (level === null) return 'No research level works: this damage type is fully resisted.';
  if (level === 0) return 'Already works with no research.';
  return `${techName} ${level.toLocaleString('en-US')}`
    + ` \u2014 ${formatCount(researchCost(family.cost, level))} research units`;
}

/**
 * Asteroid hit points for a column header: 2k rather than 2,000.
 *
 * Reuses the same ladder as the research counts so the page never shows one
 * magnitude two different ways.
 */
export const formatHitPoints = hp => formatCount({ units: hp, log10: Math.log10(hp) });
