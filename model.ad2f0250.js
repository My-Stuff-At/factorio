// Space platform speed model. Pure functions, no DOM and no filesystem, so the
// same code runs in the build, in the browser, and under `node --test`.
//
// Previously this maths existed twice - once in build.mjs for the pre-rendered
// table and once in app.js for the interactive one. Two copies of a formula
// drift, and nothing would have caught it.

export const TILE_WEIGHT = 200;
export const HULL_BASE = 40000;
export const STATIC_DRAG = 10000;

/** Hull weight follows from foundation tiles; machines and cargo are massless. */
export const weightOf = tiles => tiles * TILE_WEIGHT + HULL_BASE;
export const tilesOf = weight => (weight - HULL_BASE) / TILE_WEIGHT;

/** Drag at speed v (tiles/tick) for a hull of the given width. */
export const drag = (v, width) =>
  (1500 * v * v + 1500 * Math.abs(v)) * (width * 0.5) + STATIC_DRAG;

/**
 * Steady cruise speed in km/s: the speed at which thrust balances drag, i.e. the
 * game's acceleration expression set to zero.
 *
 * Returns 0 when thrust cannot overcome STATIC_DRAG - a real case, not an edge
 * case: one normal thruster at minimum fill does not move a platform at all.
 */
export function cruise({ thrusters, width, weight, thrustPer }) {
  const thrust = thrusters * thrustPer / (1 + weight / 1e7);
  if (drag(0, width) >= thrust) return 0;
  let lo = 0, hi = 100;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (drag(mid, width) < thrust) lo = mid; else hi = mid;
  }
  return lo * 60;                       // tiles/tick -> km/s (60 = design UPS)
}

/**
 * Format a consumption rate so a row of them reads as consistent arithmetic.
 *
 * Rounding every cell to a whole number independently is correct but looks
 * broken: at 43% fill a thruster burns 59.74/s, which prints as "60" while four
 * of them print as "239", and the reader is left doing 60 x 4 = 240 and finding
 * a bug that is not there. Showing the decimal where there is one makes the
 * column agree with itself - 59.7 x 4 really is about 239.
 *
 * The decision is made once for a whole row, not per cell: mixing "179.2" and
 * "239" in one row reintroduces exactly the inconsistency this exists to remove.
 * A row whose values are all whole (the performance endpoints, where the numbers
 * are exact) prints with no decimals at all.
 */
export const rateDigits = values =>
  values.some(v => Math.abs(v - Math.round(v)) >= 0.05) ? 1 : 0;

export const formatRate = (v, digits = rateDigits([v])) =>
  v.toLocaleString('en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });

// ---------------------------------------------------------------- gravity
// The +/-10 km/s a platform carries is not an empirical offset. Every space
// location has a `gravity_pull` in tiles/tick, and a tile per tick is 60 km/s.

export const TICKS_PER_SECOND = 60;
export const kmsFromTilesPerTick = v => v * TICKS_PER_SECOND;

/**
 * The gravity term acting on a platform partway along a leg, in km/s, signed
 * along the direction of travel.
 *
 * Only the nearer end of the leg acts, which is why the changeover is at the
 * midpoint. A positive `gravity_pull` attracts toward its own body: from the
 * origin that is backward, from the destination that is forward. The edge and
 * the shattered planet carry a NEGATIVE pull and therefore push instead, and
 * that sign is the entire reason their legs behave differently - no special
 * case is needed here, it falls out of the arithmetic.
 *
 * @param {number} originPull       gravity_pull of the body left behind
 * @param {number} destinationPull  gravity_pull of the body ahead
 * @param {number} progress         0..1 along the leg
 */
export const legOffsetKms = ({ originPull, destinationPull, progress }) =>
  progress < 0.5 ? -kmsFromTilesPerTick(originPull)
                 : +kmsFromTilesPerTick(destinationPull);

/**
 * Both halves of a leg at once: what the platform carries before the midpoint
 * and after it. When the two agree, the leg has no changeover at all.
 */
export function legProfile({ originPull, destinationPull }) {
  const at = progress => legOffsetKms({ originPull, destinationPull, progress });
  const first = at(0), second = at(1);
  return { first, second, switchesAtMidpoint: first !== second };
}

/** A thruster is 4 tiles wide and needs a fifth for its fuel and oxidizer lines. */
export const minWidthFor = thrusters => 5 * thrusters - 1;
export const isHacky = (width, thrusters) => width < minWidthFor(thrusters);

/**
 * Build a model bound to one dataset. Both the build and the browser call this,
 * so there is exactly one implementation of every number on the page.
 *
 * @param {object} data           site/data/platform-speed.json, or the subset
 *                                the browser is handed
 * @param {object} data.performance  {min,max} thruster performance points
 * @param {number} data.calibrationFill  fill the thrust constant was measured at
 * @param {object} data.thrustPerThruster  {normal, legendary, ...}
 */
export function createModel({ performance, calibrationFill, thrustPerThruster, qualityScale: scales }) {
  const { min, max } = performance;

  const lerp = (f, key) =>
    min[key] + (f - min.fill) / (max.fill - min.fill) * (max[key] - min[key]);

  /**
   * Outside its performance points a thruster is held at the nearer one.
   *
   * Clamping rather than extrapolating is forced by the prototype: the curve is
   * two points, (0.1, 0.1) and (0.8, 2.0), and continuing that line below 0.1
   * reaches negative fluid usage before it reaches an empty tank. The game
   * cannot be extrapolating, so it clamps.
   */
  const clampFill = f => Math.min(Math.max(f, min.fill), max.fill);

  /**
   * Thrust is proportional to fluid usage x effectivity.
   *
   * Empty is the one fill the clamp must not cover. A thruster holding no fluid
   * has nothing to burn, so it makes no thrust however the curve is shaped -
   * that is a definition, not an extrapolation. Without this the table showed a
   * ship cruising at 0% fill.
   */
  const performanceAt = f =>
    f <= 0 ? 0 : lerp(clampFill(f), 'fluid_usage') * lerp(clampFill(f), 'effectivity');

  /** Thrust multiplier at `fill`, relative to the fill the constant was measured at. */
  const thrustRatio = fill => performanceAt(fill) / performanceAt(calibrationFill);

  /**
   * How much bigger this quality is than normal - applies to thrust AND fuel
   * alike, so efficiency is unchanged by quality.
   *
   * Prefer the exact law (1 + 0.3 x level) over dividing two measured thrust
   * constants: the measurement is ~0.3% off, which is enough to turn a fuel
   * figure of 300/s into 299/s.
   */
  const qualityScale = quality =>
    scales?.[quality] ?? thrustPerThruster[quality] / thrustPerThruster.normal;

  /** Fluid per second per thruster, for each of fuel and oxidizer separately. */
  const fluidPerSecond = (fill, quality) =>
    fill <= 0 ? 0 : lerp(clampFill(fill), 'fluid_usage') * 60 * qualityScale(quality);

  const thrustAt = (fill, quality) => thrustPerThruster[quality] * thrustRatio(fill);

  /** Full speed grid: rows are widths, columns are thruster counts. */
  const speedGrid = ({ widths, thrusterCounts, weight, fill, quality }) => {
    const thrustPer = thrustAt(fill, quality);
    return widths.map(width =>
      thrusterCounts.map(thrusters => cruise({ thrusters, width, weight, thrustPer })));
  };

  return { lerp, clampFill, thrustRatio, qualityScale, fluidPerSecond, thrustAt, speedGrid };
}
