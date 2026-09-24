/**
 * ExplorationSystem — the world beyond the valley, and finding your way around it.
 *
 * Expeditions: you set out from a waymark where the road leaves the valley,
 * with food for the road and (if you like) paid companions. The days pass —
 * the village carries on without you, fully simulated — and when you come
 * back you find out what the journey turned up. Villagers with a taste for
 * risk go exploring too, and what they find becomes the village's news.
 *
 * Fog of war: the valley map fills in as you walk it.
 *
 * Discovery sites (data/sites.js): caves, ruins, an abandoned cabin, an old mine
 * shaft, standing stones, a derelict waystation — out in the valley itself.
 * You come across them by walking the unknown country (unknown → discovered),
 * go in and see what's there (explored), and build an outpost where it makes
 * sense (developed): a mining camp, a hunting cabin, a trading post. Outposts
 * are real businesses; their workers settle nearby, and a hamlet may grow.
 *
 *   state.exploration = {
 *     regions: { id: { known, explored, visits, partner, finds: [kind] } },
 *     trip: { region, companions, depart, until, food } | null,   (the player's)
 *     npcTrips: [{ npc, region, until }],
 *     pending: [{ day, kind }],     (settlers on their way)
 *     seen: [chunk ids],            (fog of war)
 *     reports: [last report],
 *   }
 *   state.knowledge = { points, sources: [] }   (used by technology — see TechSystem)
 */
import { Mod, skill } from './Modifiers.js';
import { rand } from '../core/rng.js';
import { ITEMS } from '../data/items.js';
import { REGIONS, EXPEDITION as X, FIND_LOOT, FOG } from '../data/regions.js';
import { BUILDABLES } from '../data/buildables.js';
import { SITE_KINDS, OUTPOSTS, HAMLET, SITE_TUNING as ST } from '../data/sites.js';
import { Rng, hashStr } from '../core/rng.js';
import { T } from '../world/WorldGenerator.js';
import { findPath } from '../world/Pathfinder.js';

export class ExplorationSystem {
  constructor(sim) {
    this.sim = sim;
    const S = sim.state;
    S.exploration ??= {};
    const E = S.exploration;
    E.regions ??= {};
    for (const [id, def] of Object.entries(REGIONS)) E.regions[id] ??= { known: !!def.known, explored: 0, visits: 0, partner: false, finds: [] };
    E.trip ??= null;
    E.npcTrips ??= [];
    E.pending ??= [];
    E.seen ??= [];
    E.reports ??= [];
    S.knowledge ??= { points: 0, sources: [] };
    E.sites ??= this.generateSites();
    E.hamlets ??= [];
    // Sites are solid on the ground (the world is regenerated from the seed on load).
    for (const s of E.sites) sim.world.blockRect(s.tx, s.ty, 2, 1, 1);
    this.seenSet = new Set(E.seen);
    if (!this.seenSet.size) this.revealAround(45, 42, FOG.startRadiusTiles, { quiet: true });
    sim.bus.on('building:added', (id) => this.onBuilt(id));
    // After the day's work (before 'worked today' resets at midnight).
    sim.bus.on('time:hour', (h) => h === 18 && this.outpostDay());
    sim.bus.on('time:minute', (now) => this.onMinute(now));
    sim.bus.on('time:day', () => this.onDay());
  }

  get E() {
    return this.sim.state.exploration;
  }
  get p() {
    return this.sim.state.player;
  }

  region(id) {
    return this.E.regions[id];
  }

  known() {
    return Object.keys(REGIONS).filter((id) => this.E.regions[id].known);
  }

  /** Trading partners out there pay better for the village's goods. */
  tradeFactor() {
    const partners = Object.values(this.E.regions).filter((r) => r.partner).length;
    return 1 + partners * X.tradeBonusPerPartner;
  }

  addKnowledge(n, source) {
    if (this.sim.tech) return this.sim.tech.addKnowledge(n, source);
    const K = this.sim.state.knowledge;
    K.points += n;
    K.sources.push({ day: this.sim.time.day, source, n });
    if (K.sources.length > 30) K.sources.shift();
    this.sim.bus.emit('knowledge:changed');
  }

  // ------------------------------------------------------------------ fog of war

  chunkId(tx, ty) {
    return Math.floor(ty / FOG.chunk) * 1000 + Math.floor(tx / FOG.chunk);
  }

  isSeen(tx, ty) {
    return this.seenSet.has(this.chunkId(tx, ty));
  }

  /** Mark the map around a tile as explored. Returns true if anything new was seen. */
  revealAround(tx, ty, radius = FOG.radiusTiles, { quiet = false } = {}) {
    let added = false;
    // Anything out there you can see from here?
    for (const s of this.E.sites || []) {
      if (s.state !== 'unknown' || Math.hypot(s.tx - tx, s.ty - ty) > radius - 2) continue;
      s.state = 'discovered';
      s.discoveredDay = this.sim.time.day;
      if (!quiet) {
        this.sim.toast('toast.site_discovered', { site: s.kind }, 'good');
        this.sim.progression.addSkillXp('exploration', 10);
        this.sim.bus.emit('site:changed', s.id);
      }
    }
    const c = FOG.chunk;
    for (let y = ty - radius; y <= ty + radius; y += c) {
      for (let x = tx - radius; x <= tx + radius; x += c) {
        if (!this.sim.world.inBounds(Math.max(0, x), Math.max(0, y))) continue;
        if ((x - tx) ** 2 + (y - ty) ** 2 > (radius + c) ** 2) continue;
        const id = this.chunkId(Math.max(0, x), Math.max(0, y));
        if (!this.seenSet.has(id)) {
          this.seenSet.add(id);
          this.E.seen.push(id);
          added = true;
        }
      }
    }
    return added;
  }

  /** Share of the valley map explored (0–1). */
  valleyExplored() {
    const w = this.sim.world;
    const total = Math.ceil(w.W / FOG.chunk) * Math.ceil(w.H / FOG.chunk);
    return this.seenSet.size / total;
  }

  // ------------------------------------------------------------------ the player's expeditions

  /** Villagers who'd come along (friends, not tied to running a business). */
  candidates() {
    return this.sim.state.npcs.filter((n) => n.age >= 18 && n.age < 60 && n.met && n.rel >= X.companionMinRel && !n.owns && !n.away && this.sim.social.tier(n) !== 'wary' && this.sim.social.tier(n) !== 'hostile');
  }

  foodNeeded(regionId, companions = 0) {
    const provisioner = 1 - Mod.perk(this.p, 'expedition_food');
    return Math.ceil(REGIONS[regionId].days * 2 * (1 + companions) * X.foodPerPersonDay * provisioner);
  }

  foodCarried() {
    return this.sim.state.player.inventory.filter((s) => ITEMS[s.id]?.food).reduce((sum, s) => sum + s.qty, 0);
  }

  cost(regionId, companions = 0) {
    return REGIONS[regionId].days * 2 * companions * X.companionWagePerDay;
  }

  canSetOut(regionId, companionIds = []) {
    const r = this.E.regions[regionId];
    if (!r?.known) return { ok: false, reason: 'region_unknown' };
    if (this.E.trip || this.sim.settlements?.R.journey) return { ok: false, reason: 'already_away' };
    if (companionIds.length > X.maxCompanions) return { ok: false, reason: 'too_many_companions' };
    const food = this.foodNeeded(regionId, companionIds.length);
    if (this.foodCarried() < food) return { ok: false, reason: 'need_food', params: { n: food } };
    const cost = this.cost(regionId, companionIds.length);
    if (this.p.money < cost) return { ok: false, reason: 'no_money', params: { money: cost } };
    if (this.p.health < 35) return { ok: false, reason: 'too_weak' };
    return { ok: true };
  }

  /** Leave the valley. The scene then lets the days pass (see GameScene.travel). */
  setOut(regionId, companionIds = []) {
    const chk = this.canSetOut(regionId, companionIds);
    if (!chk.ok) return chk;
    const sim = this.sim;
    const p = this.p;
    // Pack food for the road, cheapest first.
    let need = this.foodNeeded(regionId, companionIds.length);
    const packs = p.inventory.filter((s) => ITEMS[s.id]?.food).sort((a, b) => ITEMS[a.id].basePrice - ITEMS[b.id].basePrice);
    for (const s of packs) {
      if (need <= 0) break;
      const take = Math.min(need, s.qty);
      sim.inventory.remove(s.id, take);
      need -= take;
    }
    const cost = this.cost(regionId, companionIds.length);
    p.money -= cost;
    const companions = companionIds.map((id) => sim.npcs.byId(id)).filter(Boolean);
    for (const n of companions) {
      n.money += cost / companions.length;
      this.leave(n, regionId);
    }
    const days = this.tripDays(regionId);
    const now = sim.time.total;
    this.E.trip = { region: regionId, companions: companions.map((n) => n.id), depart: now, departDay: sim.time.day, seq: sim.state.chronicleSeq || 0, until: now + days * 1440, from: { x: p.x, y: p.y } };
    p.away = { region: regionId };
    sim.chronicle('chronicle.expedition_left', { region_name: regionId, n: companions.length });
    sim.bus.emit('expedition:departed', this.E.trip);
    return { ok: true, days };
  }

  /** There and back: a horse gets you there faster (see SettlementSystem.transport). */
  tripDays(regionId) {
    const speed = this.sim.settlements?.transport().speed ?? 1;
    return Math.max(1, Math.round((REGIONS[regionId].days * 2) / speed));
  }

  /** A villager leaves the map for a while. */
  leave(n, regionId) {
    n.away = { region: regionId };
    n.task = null;
    n.plan = null;
    n.inside = 'away';
    this.sim.npcs.paths.delete(n.id);
    this.sim.npcs.clearReservation(n);
  }

  /** …and comes back, at the waymark where the road leaves the valley. */
  comeBack(n, at) {
    delete n.away;
    n.inside = null;
    n.x = at.x;
    n.y = at.y;
    n.task = null;
    n.nextThink = this.sim.time.total;
    n.hunger = Math.max(n.hunger, 50);
  }

  /** Where travellers leave and come back. */
  waymark() {
    const d = this.sim.world.decor.find((x) => x.interact === 'expedition');
    return d ? this.sim.world.tileCenter(d.tx + 1, d.ty + 1) : this.sim.world.tileCenter(8, 47);
  }

  onMinute(now) {
    const trip = this.E.trip;
    if (trip && now >= trip.until) this.returnHome();
    for (const t of this.E.npcTrips.slice()) if (now >= t.until) this.npcReturns(t);
  }

  /** The player's party comes home: what did they find? */
  returnHome() {
    const sim = this.sim;
    const trip = this.E.trip;
    const p = this.p;
    this.E.trip = null;
    delete p.away;
    const at = this.waymark();
    p.x = at.x;
    p.y = at.y;
    p.hunger = Math.max(p.hunger, 45);
    p.energy = Math.max(20, p.energy - 25);
    const companions = trip.companions.map((id) => sim.npcs.byId(id)).filter(Boolean);
    for (const n of companions) this.comeBack(n, { x: at.x + rand.int(-20, 20), y: at.y + rand.int(-10, 10) });
    const report = this.explore(trip.region, { player: true, companions });
    report.departDay = trip.departDay;
    report.seq = trip.seq ?? 0;
    report.days = sim.time.day - trip.departDay;
    this.E.reports = [report];
    sim.progression.addXp(15 + report.finds.length * 10);
    sim.progression.addSkillXp('exploration', 12 * report.days + report.finds.length * 8);
    sim.bus.emit('expedition:returned', report);
    sim.bus.emit('player:changed');
    return report;
  }

  /**
   * Roll what an expedition to this region finds, and apply it.
   * Returns { region, finds: [{ kind, ... }], losses: [...], revealed: [...] }.
   */
  explore(regionId, { player = false, companions = [], npc = null } = {}) {
    const sim = this.sim;
    const def = REGIONS[regionId];
    const r = this.E.regions[regionId];
    const report = { region: regionId, finds: [], losses: [], revealed: [], player, npc: npc?.id || null };
    const party = (player ? 1 : 0) + companions.length + (npc ? 1 : 0);
    r.visits++;
    const [lo, hi] = X.exploredPerTrip;
    const before = r.explored;
    const mapping = player ? 1 + Mod.perk(this.p, 'expedition_explore') + skill(this.p, 'exploration') * 0.04 : 1;
    r.explored = Math.min(100, Math.round(r.explored + (rand.int(lo, hi) + companions.length * 4) * mapping));
    // What turns up. Unexplored land yields more; more people find more.
    const rolls = 1 + (r.explored < 60 ? 1 : 0) + (party >= 3 ? 1 : 0) + (player ? Mod.perk(this.p, 'expedition_finds') + (skill(this.p, 'exploration') >= 5 ? 1 : 0) : 0);
    const weights = Object.entries(def.finds).filter(([k]) => !(k === 'partner' && r.partner));
    for (let i = 0; i < rolls; i++) {
      if (!rand.chance(0.75)) continue;
      const kind = rand.weighted(weights.map(([k, w]) => [k, w]));
      const f = this.applyFind(kind, regionId, { player, npc });
      if (f) report.finds.push(f);
    }
    // The road is dangerous.
    const know = player ? (skill(this.p, 'hunting') + skill(this.p, 'exploration') * 1.5) * 0.01 : 0;
    const wary = player ? 1 - Mod.perk(this.p, 'expedition_danger') : 1;
    const danger = Math.max(0.01, (def.danger - companions.length * 0.02 - know) * wary);
    if (rand.chance(danger)) report.losses.push(this.misfortune(regionId, { player, companions, npc }));
    // Mapping one place shows the way to the next.
    if (r.explored >= 50 && before < 50 || r.explored >= 100) {
      for (const [id, d] of Object.entries(REGIONS)) {
        if (this.E.regions[id].known || !d.requires?.includes(regionId)) continue;
        this.E.regions[id].known = true;
        report.revealed.push(id);
        sim.chronicle('chronicle.region_discovered', { region_name: id });
      }
    }
    r.finds.push(...report.finds.map((f) => f.kind));
    if (r.finds.length > 12) r.finds.splice(0, r.finds.length - 12);
    if (player) {
      sim.chronicle(report.finds.length ? 'chronicle.expedition_back' : 'chronicle.expedition_empty', { region_name: regionId, n: report.finds.length });
      for (const n of companions) sim.memory.remember(n, 'explored_with_player', { who: 'player', params: { region_name: regionId } });
      if (report.finds.length) sim.progression.addReputation(1 + report.finds.length * 0.5);
    }
    return report;
  }

  applyFind(kind, regionId, { player, npc }) {
    const sim = this.sim;
    const def = REGIONS[regionId];
    const r = this.E.regions[regionId];
    const who = npc ? { npc: npc.id, gender: npc.gender } : {};
    switch (kind) {
      case 'deposit': {
        const vein = sim.nature.discoverVein(def.deposit || rand.pick(['iron', 'coal', 'stone']));
        return vein ? { kind, item: vein.variant === 'iron' ? 'iron_ore' : vein.variant === 'coal' ? 'coal' : 'stone', obj: vein.id } : null;
      }
      case 'ruins': {
        const money = rand.int(15, 70);
        sim.state.knowledge && this.addKnowledge(X.knowledgePerRuins, `ruins:${regionId}`);
        if (player) sim.state.player.money += money;
        else if (npc) npc.money += money;
        sim.chronicle(`chronicle.exp_ruins${npc ? '_npc' : ''}`, { region_name: regionId, ...who });
        return { kind, money };
      }
      case 'relic': {
        if (player) sim.inventory.add('relic', 1, { force: true });
        else if (npc) npc.money += 40;
        this.addKnowledge(1, `relic:${regionId}`);
        sim.chronicle(`chronicle.exp_relic${npc ? '_npc' : ''}`, { region_name: regionId, ...who });
        return { kind, item: 'relic', qty: 1 };
      }
      case 'partner': {
        if (r.partner) return null;
        r.partner = true;
        sim.chronicle(`chronicle.exp_partner${npc ? '_npc' : ''}`, { region_name: regionId, ...who });
        return { kind };
      }
      case 'settlers': {
        this.E.pending.push({ day: sim.time.day + rand.int(2, 5), kind: 'settlers', region: regionId });
        return { kind };
      }
      default: {
        const loot = FIND_LOOT[kind];
        if (!loot) return null;
        const items = loot.map(([item, a, b]) => ({ item, qty: rand.int(a, b) }));
        for (const { item, qty } of items) {
          if (player) sim.inventory.add(item, qty, { force: true });
          else if (npc) npc.pantry = Math.min(20, (npc.pantry || 0) + qty);
        }
        return { kind, items };
      }
    }
  }

  misfortune(regionId, { player, companions, npc }) {
    const sim = this.sim;
    const roll = rand.float();
    if (roll < 0.45) {
      if (player) sim.state.player.health = Math.max(15, sim.state.player.health - rand.int(20, 40));
      if (npc) npc.health = Math.max(10, npc.health - rand.int(20, 45));
      return { kind: 'injured' };
    }
    if (roll < 0.8 || !companions.length) {
      const lost = player ? Math.floor(sim.state.player.money * rand.range(0.1, 0.25)) : 0;
      if (player) sim.state.player.money -= lost;
      return { kind: 'robbed', money: lost };
    }
    // Someone in the party is badly hurt — and, rarely, doesn't come back.
    const n = rand.pick(companions);
    if (rand.chance(REGIONS[regionId].danger * 0.6)) {
      sim.chronicle('chronicle.exp_companion_died', { npc: n.id, gender: n.gender, region_name: regionId });
      for (const r of sim.family.relatives(n)) sim.memory.remember(r, 'player_let_down', { who: 'player' });
      sim.family.die(n, 'expedition');
      return { kind: 'companion_died', npc: n.id };
    }
    n.health = Math.max(10, n.health - rand.int(30, 50));
    sim.memory.remember(n, 'was_sick');
    return { kind: 'companion_hurt', npc: n.id };
  }

  // ------------------------------------------------------------------ villagers' own expeditions

  onDay() {
    const sim = this.sim;
    const day = sim.time.day;
    if (sim.time.weekday === 3) this.hamlets();
    for (const e of this.E.pending.slice()) {
      if (day < e.day) continue;
      this.E.pending.splice(this.E.pending.indexOf(e), 1);
      if (e.kind === 'settlers') {
        const before = sim.state.npcs.length;
        sim.growth.arrive();
        if (sim.state.npcs.length > before) sim.chronicle('chronicle.exp_settlers', { region_name: e.region, n: sim.state.npcs.length - before });
      }
    }
    if (sim.time.weekday === 5 && rand.chance(X.npcTripChance)) this.npcSetsOut();
  }

  npcSetsOut() {
    const sim = this.sim;
    const bold = sim.state.npcs.filter((n) => n.age >= 18 && n.age < 55 && !n.away && !n.owns && n.health > 60 && (n.traits.includes('risk_taker') || n.habits?.hobby === 'hunting' || n.occupation === 'unemployed'));
    if (!bold.length) return null;
    const n = rand.pick(bold);
    const options = this.known().filter((id) => this.E.regions[id].explored < 100);
    if (!options.length) return null;
    const regionId = rand.pick(options);
    this.leave(n, regionId);
    const until = sim.time.total + REGIONS[regionId].days * 2 * 1440;
    this.E.npcTrips.push({ npc: n.id, region: regionId, until });
    sim.chronicle('chronicle.npc_expedition_left', { npc: n.id, gender: n.gender, region_name: regionId });
    return n;
  }

  npcReturns(t) {
    const sim = this.sim;
    this.E.npcTrips.splice(this.E.npcTrips.indexOf(t), 1);
    const n = sim.npcs.byId(t.npc);
    if (!n) return;
    const at = this.waymark();
    this.comeBack(n, { x: at.x + rand.int(-16, 16), y: at.y + rand.int(-8, 8) });
    const report = this.explore(t.region, { npc: n });
    sim.memory.remember(n, 'went_exploring', { params: { region_name: t.region } });
    sim.chronicle(report.finds.length ? 'chronicle.npc_expedition_back' : 'chronicle.npc_expedition_empty', { npc: n.id, gender: n.gender, region_name: t.region });
    // What they saw becomes the village's news (a found seam starts its own rumor).
    if (report.revealed.length) sim.rumors?.seed('new_region', { region_name: report.revealed[0] }, { teller: n });
  }

  // ------------------------------------------------------------------ discovery sites

  /** Scatter the valley's discoveries, deterministically from the world seed. */
  generateSites() {
    const w = this.sim.world;
    const rng = new Rng(Math.floor(hashStr('discovery-sites', this.sim.state.seed) * 4294967296));
    const plaza = { tx: 46, ty: 40 };
    const sites = [];
    const free = (x, y) => w.inBounds(x, y) && !w.isBlocked(x, y) && !w.isWater(x, y) && !w.isRoad(x, y) && w.tileAt(x, y) !== T.CLIFF;
    const treesNear = (x, y) => {
      let n = 0;
      for (const o of Object.values(this.sim.state.objects)) if (o.kind === 'tree' && Math.abs(o.tx - x) <= 3 && Math.abs(o.ty - y) <= 3) n++;
      return n;
    };
    const fits = {
      cliff: (x, y) => w.tileAt(x, y - 1) === T.CLIFF || w.tileAt(x + 1, y - 1) === T.CLIFF,
      wild: (x, y) => [T.GRASS, T.GRASS2, T.GRASS3].includes(w.tileAt(x, y)) && !w.isRoad(x, y + 2) && !w.isRoad(x, y - 2),
      forest: (x, y) => treesNear(x, y) >= 5,
      road_end: (x, y) => x >= 98 && w.isRoad(x, y + 2),
    };
    let n = 0;
    for (const [kind, def] of Object.entries(SITE_KINDS)) {
      for (let c = 0; c < def.count; c++) {
        for (let tries = 0; tries < 2500; tries++) {
          const x = rng.int(3, w.W - 5);
          const y = rng.int(3, w.H - 5);
          if (Math.hypot(x - plaza.tx, y - plaza.ty) < ST.minDistanceFromPlaza) continue;
          if (!free(x, y) || !free(x + 1, y) || !free(x, y + 1) || !free(x + 1, y + 1)) continue;
          if (!fits[def.place](x, y)) continue;
          if (sites.some((s) => Math.hypot(s.tx - x, s.ty - y) < ST.spacing)) continue;
          sites.push({ id: `site${n++}`, kind, tx: x, ty: y, state: 'unknown' });
          break;
        }
      }
    }
    return sites;
  }

  site(id) {
    return this.E.sites.find((s) => s.id === id) || null;
  }

  canExploreSite(s) {
    if (!s || s.state === 'unknown') return { ok: false, reason: 'site_unknown' };
    if (s.state !== 'discovered') return { ok: false, reason: 'site_explored' };
    if (this.p.energy < SITE_KINDS[s.kind].energy + 5) return { ok: false, reason: 'too_tired' };
    return { ok: true };
  }

  /** You went in and looked around (called when the time has passed — see GameScene.exploreSite). */
  exploreSite(id) {
    const sim = this.sim;
    const s = this.site(id);
    const chk = this.canExploreSite(s);
    if (!chk.ok) return chk;
    const def = SITE_KINDS[s.kind];
    const found = [];
    for (const [item, a, b, chance] of def.loot) {
      if (!rand.chance(chance)) continue;
      const qty = rand.int(a, b);
      sim.inventory.add(item, qty, { force: true });
      found.push({ item, qty });
    }
    let money = 0;
    if (def.money) {
      money = rand.int(def.money[0], def.money[1]);
      this.p.money += money;
    }
    if (def.knowledge) sim.tech?.addKnowledge(def.knowledge, `site:${s.kind}`);
    // Signs of ore in the rock: a seam you can point the miners at.
    let vein = null;
    if (def.vein && rand.chance(def.vein)) vein = sim.nature.discoverVein(s.kind === 'mineshaft' ? 'iron' : rand.pick(['iron', 'coal', 'stone']), { tx: s.tx, ty: s.ty });
    let hurt = false;
    if (rand.chance(def.danger * (1 - Mod.perk(this.p, 'expedition_danger')))) {
      this.p.health = Math.max(10, this.p.health - rand.int(10, 25));
      hurt = true;
    }
    sim.needs.spendEnergy(def.energy);
    sim.progression.addSkillXp('exploration', 25);
    if (s.kind === 'cave' || s.kind === 'mineshaft') sim.progression.addSkillXp('mining', 8);
    if (s.kind === 'ruin' || s.kind === 'stones') sim.progression.addSkillXp('learning', 10);
    sim.progression.addXp(20);
    s.state = 'explored';
    s.exploredDay = sim.time.day;
    sim.chronicle('chronicle.site_explored', { site: s.kind });
    sim.bus.emit('site:changed', s.id);
    sim.bus.emit('player:changed');
    return { ok: true, found, money, vein: !!vein, hurt };
  }

  /** Where an outpost could stand next to a site (a free patch of ground within a few tiles). */
  outpostSpot(s, type) {
    const w = this.sim.world;
    const def = BUILDABLES[type];
    for (let r = 2; r <= 7; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = s.tx + dx;
          const ty = s.ty + dy;
          let ok = true;
          for (let y = ty; y <= ty + def.h && ok; y++) {
            for (let x = tx - 1; x <= tx + def.w && ok; x++) {
              if (!w.inBounds(x, y) || w.isBlocked(x, y) || w.isWater(x, y) || w.tileAt(x, y) === T.CLIFF || this.sim.state.fields[`${x},${y}`]) ok = false;
            }
          }
          if (ok) return { tx, ty };
        }
      }
    }
    return null;
  }

  /** Is this spot next to an explored site that suits this kind of outpost? (see ConstructionSystem.canPlace) */
  outpostAllowed(type, tx, ty) {
    return this.E.sites.some((s) => s.state === 'explored' && !s.outpostSite && SITE_KINDS[s.kind].outpost === type && Math.hypot(s.tx - tx, s.ty - ty) <= 9);
  }

  canFoundOutpost(s) {
    const type = SITE_KINDS[s?.kind]?.outpost;
    if (!type) return { ok: false, reason: 'no_outpost_here' };
    if (s.state !== 'explored' || s.outpostSite) return { ok: false, reason: 'site_explored' };
    if (!this.sim.progression.hasUnlock('construction')) return { ok: false, reason: 'locked', params: { level: this.sim.progression.unlockLevel('construction') } };
    if (this.p.money < BUILDABLES[type].money) return { ok: false, reason: 'no_money' };
    if (!this.outpostSpot(s, type)) return { ok: false, reason: 'obstructed' };
    return { ok: true, type };
  }

  /** Stake your claim: a building site for the outpost appears beside the discovery. */
  foundOutpost(id) {
    const s = this.site(id);
    const chk = this.canFoundOutpost(s);
    if (!chk.ok) return chk;
    const spot = this.outpostSpot(s, chk.type);
    const c = this.sim.construction.place(chk.type, spot.tx, spot.ty);
    if (!c) return { ok: false, reason: 'obstructed' };
    s.outpostSite = c.id;
    this.sim.bus.emit('site:changed', s.id);
    return { ok: true, site: c };
  }

  /** An outpost is finished: it opens as a business, and a track links it to the roads. */
  onBuilt(id) {
    const sim = this.sim;
    const s = this.E.sites.find((x) => x.outpostSite === id);
    const c = sim.construction.byId(id);
    if (!s || !c || !OUTPOSTS[c.type]) return;
    s.state = 'developed';
    s.outpost = id;
    this.layTrack(sim.world.buildings[id]?.door || { tx: c.tx + 1, ty: c.ty + c.h });
    const r = sim.holdings.open(id, OUTPOSTS[c.type].business, { outpost: true });
    if (r.ok) {
      sim.holdings.setStaffTarget(r.id, 2);
      sim.toast('toast.outpost_ready', { building: id }, 'good');
    }
    sim.chronicle('chronicle.outpost_founded', { building_type: c.type, site: s.kind });
    sim.bus.emit('site:changed', s.id);
  }

  /** A dirt track from a door to the nearest road, so carts can reach it and homes can follow. */
  layTrack(door) {
    const w = this.sim.world;
    let goal = null;
    for (let r = 1; r <= 60 && !goal; r++) {
      for (let dy = -r; dy <= r && !goal; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (w.isRoad(door.tx + dx, door.ty + dy)) {
            goal = { tx: door.tx + dx, ty: door.ty + dy };
            break;
          }
        }
      }
    }
    if (!goal) return 0;
    const path = findPath(w, door.tx, door.ty, goal.tx, goal.ty) || [];
    let n = 0;
    for (const t of [{ tx: door.tx, ty: door.ty }, ...path]) {
      if (w.isRoad(t.tx, t.ty) || w.isWater(t.tx, t.ty)) continue;
      w.setRoad(t.tx, t.ty);
      const key = `${t.tx},${t.ty}`;
      if (!this.sim.state.land.roads.includes(key)) this.sim.state.land.roads.push(key);
      n++;
    }
    if (n) this.sim.bus.emit('road:built', { tiles: n });
    return n;
  }

  /** Outposts at work: hunters bring in game; miners at a cave now and then find a gem. */
  outpostDay() {
    const sim = this.sim;
    const E = sim.economy;
    const W = sim.state.nature?.wildlife;
    for (const id of E.ofType('hunting_lodge')) {
      const b = E.biz(id);
      const hunters = sim.state.npcs.filter((n) => n.employer === id && n.workedToday).length + (b.workedDay === sim.time.day ? 1 : 0);
      for (let i = 0; i < hunters; i++) {
        const kind = rand.chance(0.6) ? 'rabbit' : 'deer';
        const plenty = W ? Math.min(1, W[kind].pop / Math.max(1, W[kind].cap)) : 0.5;
        if (!rand.chance(ST.lodgeGamePerHunter * (0.4 + plenty)) || !sim.nature.hunted(kind)) continue;
        b.stock.meat = (b.stock.meat || 0) + (kind === 'deer' ? 3 : 1);
        if (kind === 'deer') b.stock.hide = (b.stock.hide || 0) + 1;
      }
    }
    for (const id of E.ofType('mining_camp')) {
      const b = E.biz(id);
      const site = this.E.sites.find((s) => s.outpost === b.building);
      if (site?.kind !== 'cave') continue;
      const miners = sim.state.npcs.filter((n) => n.employer === id && n.workedToday).length;
      for (let i = 0; i < miners; i++) if (rand.chance(ST.campGemChance)) b.stock.gemstone = (b.stock.gemstone || 0) + 1;
    }
  }

  /** Weekly: an outpost with homes around it becomes a hamlet with a name of its own. */
  hamlets() {
    const sim = this.sim;
    const H = this.E.hamlets;
    for (const s of this.E.sites) {
      if (s.state !== 'developed' || H.some((h) => h.site === s.id)) continue;
      const homes = sim.world.buildingList.filter((b) => sim.property.isHome(b.id) && Math.hypot(b.tx - s.tx, b.ty - s.ty) <= HAMLET.radius && sim.npcs.residentsOf(b.id).length > 0);
      if (homes.length < HAMLET.homes) continue;
      const h = { id: `hamlet${H.length}`, site: s.id, tx: s.tx, ty: s.ty, nameIdx: (H.length + 3 + Math.floor(hashStr(s.id, sim.state.seed) * 7)) % 10, founded: sim.time.day };
      H.push(h);
      sim.chronicle('chronicle.hamlet_founded', { hamlet: h.nameIdx, site: s.kind });
      sim.progression.addReputation(5);
    }
  }

  /** A hamlet — or an outpost that could become one — close to this spot? */
  hamletNear(tx, ty) {
    return this.E.hamlets.some((h) => Math.hypot(h.tx - tx, h.ty - ty) <= HAMLET.radius) || this.E.sites.some((s) => s.outpost && Math.hypot(s.tx - tx, s.ty - ty) <= HAMLET.radius);
  }

  /** Everyone away right now (for the UI). */
  awayList() {
    return this.sim.state.npcs.filter((n) => n.away);
  }
}
