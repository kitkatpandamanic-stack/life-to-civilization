/**
 * IndustrySystem — the valley's early industry: where its raw materials come from, and how the
 * new trades (brickworks, sawmill, factory — data/businessTypes.js) find them.
 *
 * Clay: dug from pits along the riverbanks (rocks of variant 'clay' — ResourceSystem gives clay
 * for them). A brickworks' diggers walk out to the pits, dig, and carry the clay back to the kiln;
 * your workers can dig it too (a standing order, "keep 30 clay — gather it"). A pit dug out fills
 * again in time, and when one is worked out for good a new one is found further along the bank.
 *
 * The pits are placed without dice (by a hash of the tile), so adding them never changes what else
 * happens in a game — and an older save gets its pits the first time it's loaded.
 */
import { hashStr } from '../core/rng.js';

export const INDUSTRY = {
  clayPits: 9, // pits along the river
  pitSpacing: 7, // tiles apart, at least
  clayYield: [3, 5], // clay a dig gives
  mudOffroad: 0.7, // wheels over wet grass and dirt (rain, storm, snow): stuck in the mud
  pavedWheels: 1.15, // wheels on cobbles: quicker still
};

export class IndustrySystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.industry ??= { pits: 0 };
    this.ensureClay();
  }

  clayPits() {
    return Object.values(this.sim.state.objects).filter((o) => o.kind === 'rock' && o.variant === 'clay');
  }

  /** Good ground for a pit: open grass (or dirt) right beside the river, not on anyone's plot or a road. */
  pitSpot(x, y) {
    const w = this.sim.world;
    if (!w.inBounds(x, y) || w.isBlocked(x, y) || w.isWater(x, y) || w.isRoad(x, y)) return false;
    if (this.sim.land?.plotAt(x, y)) return false;
    const owner = this.sim.territory?.ownerAt?.(x, y);
    if (owner && owner !== 'village') return false; // (not on anyone's own land)
    let water = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.isWater(x + dx, y + dy)) water++;
    return water >= 1 && water <= 2;
  }

  /** Candidate riverbank tiles, ordered by a hash (so the same world always gets the same pits). */
  candidates() {
    const w = this.sim.world;
    const seed = this.sim.state.seed | 0;
    const out = [];
    for (let y = 2; y < w.H - 2; y++) for (let x = 2; x < w.W - 2; x++) if (this.pitSpot(x, y)) out.push({ x, y, h: hashStr(`clay_${x}_${y}`, seed) });
    return out.sort((a, b) => a.h - b.h);
  }

  /** Put the pits along the river (once per game — old saves get theirs when loaded). */
  ensureClay() {
    if (this.clayPits().length || this.sim.state.industry.pits > 0) return;
    const placed = [];
    for (const c of this.candidates()) {
      if (placed.length >= INDUSTRY.clayPits) break;
      if (placed.some((p) => Math.abs(p.x - c.x) + Math.abs(p.y - c.y) < INDUSTRY.pitSpacing)) continue;
      placed.push(c);
      this.addPit(c.x, c.y);
    }
    this.sim.state.industry.pits = placed.length;
  }

  addPit(x, y) {
    const N = this.sim.nature;
    const o = { kind: 'rock', variant: 'clay', tx: x, ty: y, state: 'full', regrowDay: 0 };
    if (N) return N.addObject(o);
    const id = `clay_${x}_${y}`;
    this.sim.state.objects[id] = { id, ...o };
    this.sim.world.updateObjectBlocking?.(this.sim.state.objects[id]);
    return this.sim.state.objects[id];
  }

  /** A pit worked out for good: a new one is found further along the bank. */
  newPit(near) {
    const taken = this.clayPits();
    for (const c of this.candidates()) {
      if (taken.some((p) => Math.abs(p.tx - c.x) + Math.abs(p.ty - c.y) < INDUSTRY.pitSpacing)) continue;
      if (near && Math.abs(near.tx - c.x) + Math.abs(near.ty - c.y) > 40) continue;
      const o = this.addPit(c.x, c.y);
      this.sim.state.industry.pits++;
      return o;
    }
    return null;
  }

  /** Which rocks a business's diggers work: a brickworks the clay pits, a quarry the stone. */
  rockFor(bizId) {
    return this.sim.economy.def(bizId)?.type === 'brickworks' ? 'clay' : 'stone';
  }
}
