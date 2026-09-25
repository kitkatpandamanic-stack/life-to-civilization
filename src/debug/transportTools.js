/**
 * Equipment, transport and interaction-point developer tools (development builds only — see
 * devTools.js / DebugPanel.js). In the browser console:
 *   dev.tr.list()                   all your equipment: where it is, who has it, condition, load
 *   dev.tr.give(type, where)        a new piece: 'you' (in your hands) or 'yard' (parked at your yard)
 *   dev.tr.lend(eqId, npcId)        lend a piece to a worker (defaults: the first free piece, the first worker without one)
 *   dev.tr.retrieve(eqId)           ask it back (the worker takes it to the yard)
 *   dev.tr.wear(eqId, condition)    set its condition (damaged below 35, broken at 0)
 *   dev.tr.build(type)              a building of yours near home, finished at once (warehouse_bld, transport_depot, barn…)
 *   dev.tr.warehouse(wood)          your warehouse, with this much wood in store
 *   dev.tr.crew()                   what each worker is doing: phase, task, equipment, cargo
 *   dev.tr.points(id)               a building's or site's interaction points, and who's on each
 *   dev.tr.scenario()               the whole chain: warehouse with 200 wood → a house contract → 3 workers,
 *                                   one with a wheelbarrow → watch them carry, build and finish
 */
import { EQUIPMENT } from '../data/transport.js';
import { BUILDABLES } from '../data/buildables.js';

export function transportTools(dev) {
  const sim = () => dev.sim;
  const E = () => sim().equipment;
  const first = (id) => (id ? E().byId(id) : E().mine().find((e) => e.holder?.kind !== 'worker' && E().usable(e)));

  /** Put up a building of yours on land you own near home (buying the next plot if there's no room) — finished at once. */
  function build(type) {
    const s = sim();
    const def = BUILDABLES[type];
    if (!def) return null;
    s.state.player.money = Math.max(s.state.player.money, def.money + 500);
    if (!s.progression.hasUnlock(def.unlock)) s.progression.addXp(20000);
    const sk = (s.state.player.skills.construction ??= { level: 0, xp: 0 });
    sk.level = Math.max(sk.level || 0, def.minSkill || 0);
    const tryPlace = () => {
      for (const p of s.land.owned || []) {
        for (const [x, y] of s.territory.tiles(p.id || p)) if (s.construction.canPlace(type, x, y).ok) return s.construction.place(type, x, y);
      }
      return null;
    };
    let c = tryPlace();
    if (!c) {
      for (const plot of ['east_meadow', 'north_field', 'south_field']) {
        if (s.land.buy(plot, { anywhere: true })) {
          c = tryPlace();
          if (c) break;
        }
      }
    }
    if (!c) return null;
    c.delivered = { ...c.required };
    c.labor = c.laborNeeded;
    s.construction.tryComplete(c);
    return c.id;
  }

  const tools = {
    build,
    list: () => {
      const rows = E().list().map((e) => ({ id: e.id, type: e.type, lv: e.level, status: E().status(e), cond: Math.round(e.condition), cap: E().cap(e), holder: e.holder ? `${e.holder.kind}:${e.holder.id || ''}` : '-', at: e.at.kind === 'ground' ? `${e.at.tx},${e.at.ty}` : `${e.at.kind}:${e.at.id || ''}`, load: E().load(e), trips: e.trips }));
      console.table(rows);
      return `${rows.length} pieces · wear so far $${E().totalWear()}`;
    },
    give: (type = 'wheelbarrow', where = 'yard') => {
      if (!EQUIPMENT[type]) return `no such equipment: ${type} (${Object.keys(EQUIPMENT).join(', ')})`;
      const s = sim();
      if (where === 'you' && !E().playerHeld()) {
        const eq = E().create(type, { at: { kind: 'player' } });
        s.state.player.eq = eq.id;
        return eq.id;
      }
      const eq = E().create(type);
      E().syncJourney();
      return `${eq.id} at ${eq.at.tx},${eq.at.ty}`;
    },
    lend: (eqId, npcId) => {
      const eq = first(eqId);
      if (!eq) return 'no free equipment (dev.tr.give())';
      const w = npcId || sim().workers.list().find((c) => !E().assignedTo(c.npcId))?.npcId;
      if (!w) return 'no worker without equipment';
      return JSON.stringify(E().lend(eq.id, w));
    },
    retrieve: (eqId) => {
      const eq = eqId ? E().byId(eqId) : E().mine().find((e) => e.holder?.kind === 'worker');
      return eq ? JSON.stringify(E().retrieve(eq.id)) : 'nothing lent out';
    },
    wear: (eqId, condition = 20) => {
      const eq = first(eqId) || E().mine()[0];
      if (!eq) return 'no equipment';
      eq.condition = condition;
      E().changed();
      return `${eq.id} ${E().status(eq)}`;
    },
    warehouse: (wood = 200) => {
      const s = sim();
      const id = s.construction.finished().find((c) => c.type === 'warehouse_bld')?.id || build('warehouse_bld');
      if (!id) return 'no room for a warehouse';
      s.home.store('wood', wood, { force: true });
      return `${id} · base ${s.workers.baseBuilding().id} · wood ${s.home.storageCount('wood')}`;
    },
    crew: () => {
      const s = sim();
      const rows = s.workers.list().map((c) => {
        const n = s.npcs.byId(c.npcId);
        const eq = E().assignedTo(c.npcId);
        return { npc: c.npcId, state: c.state, phase: c.phase || '-', task: c.task?.kind || '-', stage: n?.task?.stage, eq: eq ? `${eq.type}${E().using(n) ? '' : ' (not in hand)'}` : '-', cargo: `${n?.carry?.qty || 0}/${s.workers.carryCap(n)}`, spot: c.task?.spot ? `${c.task.spot.tx},${c.task.spot.ty}` : '-' };
      });
      console.table(rows);
      return `${rows.length} workers`;
    },
    points: (id) => {
      const s = sim();
      const me = s.world.toTile(s.state.player.x, s.state.player.y);
      const target = id || s.construction.sites().sort((a, b) => Math.abs(a.tx - me.tx) + Math.abs(a.ty - me.ty) - (Math.abs(b.tx - me.tx) + Math.abs(b.ty - me.ty)))[0]?.id || s.workers.baseBuilding().id;
      const taken = s.points.taken();
      console.table(s.points.of(target).map((p) => ({ key: p.key, role: p.role, at: p.inside ? 'inside' : `${p.tx},${p.ty}`, who: p.inside ? '' : taken.get(`${p.tx},${p.ty}`) || '' })));
      return target;
    },
    scenario: () => {
      const s = sim();
      const log = [];
      log.push(tools.warehouse(200));
      // A villager who wants a house built (materials: you bring them, with their advance).
      const K = s.contracts;
      K.S.done = Math.max(K.S.done || 0, 10);
      K.S.rep = Math.max(K.S.rep ?? 50, 70);
      let offer = null;
      for (const n of s.state.npcs.filter((x) => x.age >= 20 && x.homeId && !x.owns)) {
        n.money = Math.max(n.money, 900);
        K.S.clients ??= {};
        K.S.clients[n.id] = { ...(K.S.clients[n.id] || {}), jobs: 3, good: 3 };
        offer = K.make_proposal(n);
        if (offer && offer.proposal.what === 'new') break;
      }
      if (!offer) return 'no villager wants building work';
      offer.via = 'talk';
      K.S.offers.push(offer);
      const r = K.accept(offer.id, { materials: 'included' });
      log.push(`contract #${offer.id} ${r.ok ? 'accepted' : r.reason}`);
      // Three workers — one with a wheelbarrow.
      const look = s.state.npcs[0].look;
      const p = s.state.player;
      while (s.workers.list().length < 3) {
        const n = s.npcs.spawn({ age: 30, occupation: 'unemployed', look, money: 20, x: p.x + 20, y: p.y + 30 });
        n.met = true;
        s.workers.hire(n, 16);
      }
      const ids = s.workers.list().slice(0, 3).map((c) => c.npcId);
      K.assign(offer.id, ids);
      const eq = E().create('wheelbarrow');
      log.push(`wheelbarrow ${eq.id}: ${JSON.stringify(E().lend(eq.id, ids[0]))}`);
      K.track?.(offer.id);
      return log.join('\n');
    },
  };
  return tools;
}
