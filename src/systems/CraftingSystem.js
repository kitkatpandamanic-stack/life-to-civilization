/**
 * CraftingSystem — turning materials into products at a crafting station.
 *
 * Stations: the workbench and stove in your home, and a forge (the smithy's,
 * rented by the session, or one you build). Inputs are taken from your pockets
 * first, then from your home storage when you're at home. Output goes to your
 * pockets, or to storage if you can't carry it.
 *
 * Crafting takes time and energy, trains the recipe's skill, wears the tool —
 * and tools, furniture and cooked food come out with a QUALITY (crude, standard,
 * fine, masterwork) that depends on your skill, craftsmanship, tool, perks and luck.
 */
import { RECIPES } from '../data/recipes.js';
import { ITEMS } from '../data/items.js';
import { Mod, skill, perk, attr } from './Modifiers.js';
import { QUALITY_ROLL as QR, STANDARD } from '../data/quality.js';
import { hasQuality } from './slots.js';
import { rand } from '../core/rng.js';

export const FORGE_FEE = 5; // what the smith charges for a session at the forge

export class CraftingSystem {
  constructor(sim) {
    this.sim = sim;
    /** Where you're crafting right now: { station, useStorage } (set when a station is opened). */
    this.at = null;
  }

  /** Open a station: at home the chest is at hand; at a forge only your pockets are. */
  openStation(station) {
    this.at = { station, useStorage: station !== 'forge' };
  }

  /** Rent the smithy's forge for the day (the fee goes to the smith's business). */
  rentForge(bizId) {
    const sim = this.sim;
    const p = sim.state.player;
    if (p.forgeDay === sim.time.day) return true;
    if (p.money < FORGE_FEE) return false;
    p.money -= FORGE_FEE;
    sim.economy.biz(bizId).money += FORGE_FEE;
    sim.economy.ledger(bizId, 'rev', FORGE_FEE);
    p.forgeDay = sim.time.day;
    sim.bus.emit('player:changed');
    return true;
  }

  recipesFor(station) {
    return Object.keys(RECIPES).filter((id) => RECIPES[id].station === station);
  }

  /** How many of an item are available to craft with (pockets + home storage). */
  available(id, useStorage) {
    return this.sim.inventory.count(id) + (useStorage ? this.sim.home.storageCount(id) : 0);
  }

  hasTool(kind, useStorage) {
    return !!this.sim.inventory.bestTool(kind) || (useStorage && this.sim.home.storage.some((s) => ITEMS[s.id].tool?.kind === kind));
  }

  check(recipeId, useStorage = this.at?.useStorage ?? true) {
    const r = RECIPES[recipeId];
    const p = this.sim.state.player;
    if (r.unlock && !this.sim.progression.hasUnlock(r.unlock)) return { ok: false, reason: 'locked', params: { level: this.sim.progression.unlockLevel(r.unlock) } };
    if (r.minSkill && skill(p, r.skill) < r.minSkill) return { ok: false, reason: 'need_skill', params: { skill: r.skill, level: r.minSkill } };
    if (r.tool && !this.hasTool(r.tool, useStorage)) return { ok: false, reason: `need_${r.tool}` };
    for (const [id, qty] of Object.entries(r.inputs)) {
      if (this.available(id, useStorage) < qty) return { ok: false, reason: 'missing_materials', params: { item: id, qty } };
    }
    if (p.energy < (r.energy || 0) + 2) return { ok: false, reason: 'too_tired' };
    return { ok: true };
  }

  duration(recipeId) {
    const r = RECIPES[recipeId];
    const p = this.sim.state.player;
    let speed = Mod.craftSpeed(p, r.skill) * this.sim.needs.productivity();
    if (r.tool) {
      const tool = this.sim.inventory.bestTool(r.tool);
      if (tool) speed *= this.sim.inventory.toolEfficiency(tool);
    }
    return Math.round(r.ms / Math.max(0.25, speed));
  }

  /** The quality a piece comes out at (0 crude … 3 masterwork). */
  rollQuality(recipeId) {
    const r = RECIPES[recipeId];
    const p = this.sim.state.player;
    const lvl = skill(p, r.skill);
    const tool = r.tool ? this.sim.inventory.bestTool(r.tool) : null;
    let score = lvl * QR.perSkill + attr(p, 'craftsmanship') * QR.perCraftsmanship + perk(p, `quality_${r.skill}`);
    if (tool) score += ((tool.q ?? STANDARD) - STANDARD) * QR.perToolQuality;
    score += rand.range(-QR.luck, QR.luck);
    // Tired, hungry hands make worse work.
    score -= (1 - this.sim.needs.productivity()) * 1.5;
    if (score < QR.crude) return 0;
    if (score < QR.fine) return 1;
    const mastery = lvl >= QR.masterworkSkill || perk(p, `masterwork_${r.skill}`) > 0;
    return score >= QR.masterwork && mastery ? 3 : 2;
  }

  /** Consume inputs, produce outputs. Call after the crafting animation finishes. Returns the quality made (or false). */
  complete(recipeId, useStorage = this.at?.useStorage ?? true) {
    const c = this.check(recipeId, useStorage);
    if (!c.ok) {
      this.sim.toast(`reason.${c.reason}`, c.params || {}, 'warn');
      return false;
    }
    const sim = this.sim;
    const p = sim.state.player;
    const r = RECIPES[recipeId];
    const q = this.rollQuality(recipeId);
    // Thrifty hands sometimes save a piece of material.
    const saved = rand.chance(perk(p, `save_material_${r.skill}`)) ? Object.keys(r.inputs)[0] : null;
    for (const [id, qty0] of Object.entries(r.inputs)) {
      const qty = id === saved ? Math.max(0, qty0 - 1) : qty0;
      const fromPockets = sim.inventory.remove(id, qty);
      if (fromPockets < qty) sim.home.take(id, qty - fromPockets);
    }
    if (r.tool && sim.inventory.bestTool(r.tool)) sim.inventory.useTool(r.tool);
    for (const [id, qty0] of Object.entries(r.output)) {
      // The Smelter perk: sometimes the ore gives more.
      const qty = qty0 + (id === 'iron_ingot' && rand.chance(perk(p, 'double_ingot')) ? 1 : 0);
      const opts = { q: hasQuality(id) ? q : undefined };
      // Tempered tools last longer.
      if (ITEMS[id].tool && perk(p, 'tool_durability')) {
        const base = Math.round(ITEMS[id].tool.durability * [0.7, 1, 1.3, 1.8][q] * (1 + perk(p, 'tool_durability')));
        opts.extra = { maxDur: base, dur: base };
      }
      const added = sim.inventory.add(id, qty, opts);
      if (added < qty) sim.home.store(id, qty - added, { force: true, q: opts.q });
      sim.toast(hasQuality(id) ? 'toast.crafted_q' : 'toast.crafted', { item: id, qty, quality: ['crude', 'standard', 'fine', 'masterwork'][q] }, q >= 2 ? 'good' : 'gain');
    }
    sim.needs.spendEnergy(r.energy || 0);
    sim.progression.addXp(r.xp || 0);
    if (r.skill) sim.progression.addSkillXp(r.skill, (r.skillXp || 0) * (q >= 2 ? 1.25 : 1));
    sim.state.stats.itemsCrafted = (sim.state.stats.itemsCrafted || 0) + 1;
    if (q === 3) sim.state.stats.masterworks = (sim.state.stats.masterworks || 0) + 1;
    sim.bus.emit('player:crafted', { recipe: recipeId, q });
    sim.bus.emit('player:changed');
    return q;
  }
}
