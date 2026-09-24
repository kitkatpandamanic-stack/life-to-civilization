/**
 * DisasterSystem — when events hit the physical world, and the recovery after.
 *
 *   flood   riverside buildings are soaked (condition lost, stock ruined),
 *           crops by the water are washed away
 *   storm   roofs torn off here and there, trees blown down
 *   blight  crops wither in the fields
 *   mine_collapse  a miner is hurt, the quarry shuts for days
 *   sickness       people fall ill, and it spreads between people who meet
 *   trade_fair     a merchant at the plaza pays well for one kind of goods
 *   migrants       a wave of newcomers arrives at once
 *   fire    any building can catch fire (dry summers, ovens and forges make it
 *           likelier); it grows and spreads unless people come running to fight it
 *
 * Recovery is part of the economy: damaged buildings are repaired by their
 * owners — materials bought from the lumberyard and quarry, work done by
 * builders, day labourers, neighbours (and you). The displaced stay with
 * family, friends, or in the village hall meanwhile.
 *
 *   state.fires = [{ building, intensity, since, helpers }]
 */
import { DISASTER as D } from '../data/events.js';
import { rand } from '../core/rng.js';

export class DisasterSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.fires ??= [];
    sim.bus.on('time:day', () => this.onDay());
    sim.bus.on('time:minute', (m) => {
      if (m % 10 === 0 && sim.state.fires.length) this.burn();
    });
  }

  get fires() {
    return this.sim.state.fires;
  }

  fireAt(buildingId) {
    return this.fires.find((f) => f.building === buildingId) || null;
  }

  // ------------------------------------------------------------------ event strikes

  strike(kind, event) {
    const fn = this[`strike_${kind}`];
    if (fn) fn.call(this, event);
  }

  /** Buildings whose door is within reach of the river or lake. */
  nearWater(reach) {
    const w = this.sim.world;
    return w.buildingList.filter((b) => {
      for (let dy = -reach; dy <= reach + b.h; dy++) for (let dx = -reach; dx <= b.w + reach; dx++) if (w.isWater(b.tx + dx, b.ty + dy)) return true;
      return false;
    });
  }

  strike_flood(event) {
    const sim = this.sim;
    const hit = this.nearWater(D.floodReach);
    for (const b of hit) {
      this.damage(b.id, rand.int(D.floodDamage[0], D.floodDamage[1]), 'flood');
      // Goods stored on the ground floor are ruined.
      const biz = sim.economy.businessAtBuilding(b.id);
      if (biz) for (const k of Object.keys(sim.economy.biz(biz).stock)) sim.economy.biz(biz).stock[k] = Math.floor(sim.economy.biz(biz).stock[k] * 0.75);
    }
    // Crops near the water are washed away.
    const w = sim.world;
    for (const [key, f] of Object.entries(sim.state.fields)) {
      const [x, y] = key.split(',').map(Number);
      let wet = false;
      for (let dy = -D.floodReach; dy <= D.floodReach && !wet; dy++) for (let dx = -D.floodReach; dx <= D.floodReach; dx++) if (w.isWater(x + dx, y + dy)) wet = true;
      if (wet && f.crop) f.dead = true;
    }
    event.data.params = { n: hit.length };
  }

  strike_storm(event) {
    const sim = this.sim;
    const list = sim.world.buildingList.filter((b) => b.type !== 'well');
    const n = rand.int(D.stormBuildings[0], D.stormBuildings[1]);
    for (let i = 0; i < n && list.length; i++) {
      const b = list.splice(rand.int(0, list.length - 1), 1)[0];
      this.damage(b.id, rand.int(D.stormDamage[0], D.stormDamage[1]), 'storm');
    }
    // Trees blown down near the village.
    for (const o of Object.values(sim.state.objects)) {
      if (o.kind === 'tree' && o.state === 'grown' && rand.chance(D.stormTrees)) {
        o.state = 'stump';
        o.felledDay = sim.time.day;
        sim.resources.changed(o);
      }
    }
    event.data.params = { n };
  }

  strike_blight() {
    for (const f of Object.values(this.sim.state.fields)) if (f.crop && rand.chance(0.4)) f.dead = true;
  }

  strike_mine_collapse(event) {
    const sim = this.sim;
    const crew = sim.state.npcs.filter((n) => n.employer === 'quarry' || n.owns === 'quarry');
    const victim = rand.pick(crew);
    if (victim) {
      victim.health = Math.max(5, victim.health - 60);
      sim.memory.remember(victim, 'mine_accident');
      for (const r of sim.family.relatives(victim)) sim.memory.remember(r, 'lived_through', { params: { event: 'mine_collapse' } });
      event.data.params = { npc: victim.id, gender: victim.gender };
    }
    // Part of the workings is buried for good.
    for (const o of Object.values(sim.state.objects)) if (o.kind === 'rock' && o.reserve && Math.abs(o.tx - 95) + Math.abs(o.ty - 28) < 15) o.reserve = Math.floor(o.reserve * 0.7);
  }

  strike_migrants(event) {
    let n = 0;
    for (let i = 0; i < 3; i++) n += this.sim.growth?.arrive().length || 0;
    event.data.params = { n };
  }

  /** A merchant at the plaza pays well for something the village has (or could make). */
  strike_trade_fair(event) {
    const item = rand.pick(['stool', 'chair', 'table', 'hide', 'fish', 'planks', 'grilled_fish', 'pie', 'iron_ore']);
    event.data.item = item;
    event.data.boost = D.tradeFairBoost;
    event.data.params = { item };
  }

  // ------------------------------------------------------------------ damage & repair

  /** A building takes damage. Owners start repairs; people move out if it's unsafe. */
  damage(buildingId, amount, cause) {
    const sim = this.sim;
    const P = sim.property;
    const r = P.rec(buildingId);
    if (!r) return;
    r.condition = Math.max(0, r.condition - amount);
    r.damage = { kind: cause, day: sim.time.day };
    if (r.condition < 8) r.ruined = true;
    for (const n of sim.npcs.residentsOf(buildingId)) sim.memory.remember(n, `home_${cause}`, { params: { building: buildingId } });
    // Unsafe: the family stays with relatives or friends until it's fixed.
    if (r.condition < 30 && P.isHome(buildingId)) this.rehouse(buildingId);
    sim.bus.emit('building:changed', buildingId);
    sim.bus.emit('property:changed', buildingId);
  }

  rehouse(buildingId) {
    const sim = this.sim;
    const P = sim.property;
    const residents = sim.npcs.residentsOf(buildingId).slice();
    for (const n of residents) {
      const kin = [...sim.family.relatives(n), ...Object.keys(n.relations).map((id) => sim.npcs.byId(id)).filter((o) => o && sim.social.npcRel(n, o) >= 45)];
      const host = kin.find((o) => o.homeId && o.homeId !== buildingId && P.isHome(o.homeId) && P.occupants(o.homeId) < P.capacity(o.homeId) + 1);
      n.displacedFrom = buildingId;
      if (host) {
        P.moveIn([n], host.homeId, 'moved');
        sim.memory.remember(host, 'took_in', { who: n.id, params: { npc: n.id } });
        sim.social.adjust(n, host, { f: 10, t: 10 });
      } else P.moveIn([n], 'hall', 'moved');
    }
  }

  /** Owners (and the village) repair what's been damaged — a real construction job. */
  planRepairs() {
    const sim = this.sim;
    const P = sim.property;
    for (const [id, r] of Object.entries(P.all)) {
      if (!r.damage || r.condition >= D.repairBelow || !sim.world.buildings[id]) continue;
      if (sim.construction.list.some((c) => c.kind === 'repair' && c.target === id && c.status === 'site')) continue;
      if (r.owner === 'player') continue; // your buildings: repair them yourself from the Inspect panel
      const owner = r.owner === 'village' ? 'village' : sim.npcs.byId(r.owner);
      if (!owner) continue;
      const points = 100 - r.condition;
      const mats = {};
      for (const [item, per] of Object.entries(D.repairMaterialsPerPoint)) mats[item] = Math.max(1, Math.ceil(points * per));
      const c = sim.construction.startRepair({ owner: owner === 'village' ? 'village' : owner.id, target: id, materials: mats, labor: Math.round(points * D.repairLaborPerPoint) });
      // Earmark a budget: the owner's savings (or the business's till), plus the village's emergency fund.
      const est = Object.entries(mats).reduce((s, [item, q]) => s + q * 5, 0);
      const V = sim.state.village;
      if (owner === 'village') {
        const b = Math.min(V.treasury, est);
        V.treasury -= b;
        c.budget = b;
      } else {
        const biz = sim.economy.businessAtBuilding(id);
        const till = biz && sim.economy.ownerId(biz) === owner.id ? sim.economy.biz(biz) : null;
        const own = till ? Math.min(Math.max(0, till.money - 40), est) : Math.min(owner.money * 0.8, est);
        if (till) till.money -= own;
        else owner.money -= own;
        const relief = r.damage?.kind && r.damage.kind !== 'wear' ? Math.min(Math.max(0, V.treasury - 20), est * D.emergencyShare) : 0;
        V.treasury -= relief;
        c.budget = own + relief;
        if (relief > 0) sim.state.village.reliefPaid = (sim.state.village.reliefPaid || 0) + relief;
      }
    }
  }

  /** A repair is finished: the building is sound again and people move back. */
  repaired(c) {
    const sim = this.sim;
    const r = sim.property.rec(c.target);
    if (!r) return;
    r.condition = 100;
    r.ruined = false;
    r.abandoned = false;
    delete r.damage;
    const back = sim.state.npcs.filter((n) => n.displacedFrom === c.target);
    for (const n of back) delete n.displacedFrom;
    if (back.length) sim.property.moveIn(back, c.target, 'moved');
    sim.chronicle('chronicle.building_repaired', { building: c.target });
    sim.bus.emit('building:changed', c.target);
  }

  // ------------------------------------------------------------------ fire

  /** Any building may catch fire — ovens, forges, dry weather and neglect make it likelier. */
  igniteChecks() {
    const sim = this.sim;
    const risk = D.fireBaseRisk * sim.events.modifier('fire_risk') * (sim.time.season === 'winter' ? 1.4 : 1) * (sim.weather.type === 'rain' || sim.weather.type === 'snow' ? 0.3 : 1);
    for (const b of sim.world.buildingList) {
      if (b.type === 'well' || this.fireAt(b.id)) continue;
      const r = sim.property.rec(b.id);
      if (r?.ruined) continue;
      const biz = sim.economy.businessAtBuilding(b.id);
      const t = biz ? sim.economy.def(biz).type : b.type;
      const k = (D.fireRiskByType[t] || 1) * (r && r.condition < 50 ? 1.5 : 1);
      if (rand.chance(risk * k)) this.ignite(b.id);
    }
  }

  ignite(buildingId, intensity = 25) {
    if (this.fireAt(buildingId)) return null;
    const f = { building: buildingId, intensity, since: this.sim.time.total, helpers: [], playerHelped: 0 };
    this.fires.push(f);
    this.sim.chronicle('chronicle.fire_started', { building: buildingId });
    this.sim.toast('toast.fire', { building: buildingId }, 'danger');
    this.sim.bus.emit('fire:started', f);
    return f;
  }

  /** Villagers fighting this fire right now. */
  firefighters(f) {
    return this.sim.state.npcs.filter((n) => n.task?.type === 'firefight' && n.task.target?.building === f.building && n.task.stage === 'fighting');
  }

  /** Every 10 minutes: fires grow, spread and destroy — or are beaten back. */
  burn() {
    const sim = this.sim;
    const P = sim.property;
    for (const f of this.fires.slice()) {
      const crew = this.firefighters(f);
      for (const n of crew) if (!f.helpers.includes(n.id)) f.helpers.push(n.id);
      const rain = sim.weather.type === 'rain' || sim.weather.type === 'storm' ? 10 : 0;
      f.intensity = Math.max(0, Math.min(100, f.intensity + D.fireGrowth - crew.length * D.fireFightPerHelper - rain - f.playerHelped * 20));
      f.playerHelped = 0;
      const r = P.rec(f.building);
      if (r) r.condition = Math.max(0, r.condition - D.fireDamagePerTick * (f.intensity / 100) * 10);
      // A blaze leaps to neighbouring buildings.
      if (f.intensity > 60 && rand.chance(D.fireSpreadChance)) {
        const b = sim.world.buildings[f.building];
        const next = sim.world.buildingList.find((o) => o !== b && o.type !== 'well' && !this.fireAt(o.id) && Math.abs(o.tx - b.tx) <= b.w + D.fireSpreadReach && Math.abs(o.ty - b.ty) <= b.h + D.fireSpreadReach);
        if (next) this.ignite(next.id, 20);
      }
      if (f.intensity <= 0) this.extinguished(f);
      else if (r && r.condition <= 5) this.burntDown(f);
    }
  }

  extinguished(f) {
    const sim = this.sim;
    this.fires.splice(this.fires.indexOf(f), 1);
    const r = sim.property.rec(f.building);
    if (r) r.damage = { kind: 'fire', day: sim.time.day };
    // Those who lost the most remember who came to help.
    const victims = sim.npcs.residentsOf(f.building);
    const owner = sim.economy.owner(sim.economy.businessAtBuilding(f.building));
    for (const v of [...victims, owner].filter(Boolean)) {
      for (const id of f.helpers) if (id !== v.id) sim.memory.remember(v, 'fire_helped', { who: id, params: { npc: id } });
      if (f.playerFought) sim.memory.remember(v, 'player_fought_fire', { who: 'player' });
    }
    for (const id of f.helpers) {
      const n = sim.npcs.byId(id);
      if (n?.task?.type === 'firefight') n.task.done = true;
    }
    sim.chronicle('chronicle.fire_out', { building: f.building, n: f.helpers.length });
    sim.bus.emit('fire:ended', f);
    sim.bus.emit('building:changed', f.building);
    if (r && r.condition < 30) this.rehouse(f.building);
  }

  burntDown(f) {
    const sim = this.sim;
    this.fires.splice(this.fires.indexOf(f), 1);
    const r = sim.property.rec(f.building);
    if (r) {
      r.condition = 0;
      r.ruined = true;
      r.damage = { kind: 'fire', day: sim.time.day };
    }
    // Everything inside is lost.
    const biz = sim.economy.businessAtBuilding(f.building);
    if (biz) for (const k of Object.keys(sim.economy.biz(biz).stock)) sim.economy.biz(biz).stock[k] = 0;
    for (const n of sim.npcs.residentsOf(f.building)) sim.memory.remember(n, 'home_burnt', { params: { building: f.building } });
    this.rehouse(f.building);
    for (const id of f.helpers) {
      const n = sim.npcs.byId(id);
      if (n?.task?.type === 'firefight') n.task.done = true;
    }
    sim.chronicle('chronicle.fire_destroyed', { building: f.building });
    sim.bus.emit('fire:ended', f);
    sim.bus.emit('building:changed', f.building);
  }

  /** You throw water on the flames. */
  playerFight(buildingId) {
    const f = this.fireAt(buildingId);
    if (!f) return false;
    f.playerHelped += 1;
    f.playerFought = true;
    this.sim.progression.addXp(6);
    this.sim.needs.spendEnergy(3);
    return true;
  }

  // ------------------------------------------------------------------ sickness

  /** While a sickness goes round, people fall ill — more in crowded homes, the old and the young. */
  spreadSickness() {
    const sim = this.sim;
    const m = sim.events.modifier('sickness');
    if (m <= 1) return;
    for (const n of sim.state.npcs) {
      if (n.health < 40) continue;
      const P = sim.property;
      const crowded = n.homeId && P.occupants(n.homeId) > P.capacity(n.homeId) ? 1.8 : 1;
      const frail = n.age >= 60 || n.age < 6 ? 1.6 : 1;
      if (rand.chance(D.sickChance * m * crowded * frail * (sim.tech?.mod('sickness') ?? 1))) {
        n.health = Math.max(10, n.health - rand.int(35, 55));
        sim.memory.remember(n, 'was_sick');
      }
    }
  }

  onDay() {
    this.igniteChecks();
    this.spreadSickness();
    this.planRepairs();
  }
}
