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
 * Lowest completed research level that kills in `shots` or fewer.
 *
 * Returns null when no level up to `cap` suffices. Nothing here is truly
 * unbounded - the technologies are infinite - so a null means "beyond the cap",
 * and the cap is deliberately generous so the wall cases report a real number
 * rather than hiding behind a dash.
 */
export function levelFor({ weapon, family, asteroid, shots, hpMultiplier = 1, cap = 20000 }) {
  for (let level = 0; level <= cap; level++) {
    if (shotsToKill({ weapon, family, asteroid, level, hpMultiplier }) <= shots) return level;
  }
  return null;
}

/**
 * Past this the exact figure is noise: 2,859 and "no reachable level" are the
 * same advice, which is that this is the wrong weapon for this size.
 */
export const WALL = 99;

/**
 * Render one level for a table cell, as { text, state }.
 *
 * Shared by the build and the browser deliberately. The self-check learned this
 * the hard way with `rawDamage`: anything restated in two places drifts, and a
 * threshold that renders differently in the pre-rendered table than in the
 * recomputed one is invisible until someone switches a tab.
 */
export function formatLevel(level) {
  if (level === 0) return { text: '0', state: 'free' };
  if (level === null || level > WALL) return { text: `>${WALL}`, state: 'wall' };
  return { text: String(level), state: 'plain' };
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
