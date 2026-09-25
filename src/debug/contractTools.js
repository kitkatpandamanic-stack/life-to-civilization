/**
 * Contract and crew developer tools (development builds only — see devTools.js / DebugPanel.js).
 * In the browser console:
 *   dev.ct.list()                   your contracts: status, work done, who's on them, what they've done
 *   dev.ct.farm(workers = true)     the farmer's harvest — offered, taken on, your workers put on it
 *   dev.ct.repair(workers = true)   a worn house near you — its owner's repair job, taken on (and your workers on it)
 *   dev.ct.offer(npcId)             what this villager would ask you to do (and puts it on the table)
 *   dev.ct.assign(id, n)            put n of your workers on contract id (0 takes them all off)
 *   dev.ct.finish(id)               all the work done at once — settled the normal way (paid, experience)
 *   dev.ct.rank(n)                  set the number of contracts you've seen through (your contractor rank)
 *   dev.ct.stuck()                  run the workers' watchdog now and show who it caught
 */
export function contractTools(dev) {
  const sim = () => dev.sim;
  const K = () => sim().contracts;
  const first = (id) => K().S.active.find((c) => c.id === Number(id)) || K().S.active.find((c) => c.id === K().S.tracked) || K().S.active[0];
  const hands = (n = Infinity) => sim().workers.list().slice(0, n).map((c) => c.npcId);
  const tools = {
    list: () => {
      const rows = K().S.active.map((c) => ({ id: c.id, kind: c.kind, client: c.issuer, status: K().statusOf(c), done: `${c.done}/${K().required(c)}`, owed: c.owed || 0, workers: (c.workers || []).join(','), crew: JSON.stringify(c.crew), pay: c.pay, due: c.deadline }));
      console.table(rows);
      return `${rows.length} active · rank ${K().rank().id} (${K().S.done} done)`;
    },
    farm: (workers = true) => {
      const f = sim().npcs.byId(sim().economy.ownerId('farm'));
      const o = K().make_harvest(f);
      if (!o) return 'no harvest needed (nothing ripe, or winter)';
      o.via = 'talk';
      K().S.offers.push(o);
      const r = K().accept(o.id);
      if (!r.ok) return r.reason;
      if (workers) K().assign(o.id, hands(K().recommended(o)));
      K().track(o.id);
      return `harvest #${o.id}: ${o.qty} plants for ${o.pay} · workers ${o.workers.join(',') || 'none'}`;
    },
    repair: (workers = true) => {
      const s = sim();
      const me = s.world.toTile(s.state.player.x, s.state.player.y);
      const id = Object.keys(s.property.all).filter((b) => s.world.buildings[b] && s.property.rec(b).owner !== 'player' && s.npcs.byId(s.property.rec(b).owner)).sort((a, b) => {
        const A = s.world.buildings[a].door;
        const B = s.world.buildings[b].door;
        return Math.abs(A.tx - me.tx) + Math.abs(A.ty - me.ty) - (Math.abs(B.tx - me.tx) + Math.abs(B.ty - me.ty));
      })[0];
      if (!id) return 'no villager-owned building';
      s.property.rec(id).condition = 30;
      const owner = s.npcs.byId(s.property.rec(id).owner);
      owner.money = Math.max(owner.money, 200);
      const o = K().make_repair(owner);
      if (!o) return 'no repair job';
      o.via = 'talk';
      K().S.offers.push(o);
      const r = K().accept(o.id);
      if (!r.ok) return r.reason;
      if (workers) K().assign(o.id, hands(K().recommended(o)));
      K().track(o.id);
      return `repair #${o.id} of ${id}: ${o.qty} points for ${o.pay}`;
    },
    offer: (npcId) => {
      const o = K().offerFromTalk(sim().npcs.byId(npcId));
      return o ? `${o.kind} #${o.id}: pay ${o.pay}` : 'they need nothing done';
    },
    assign: (id, n = 2) => {
      const c = first(id);
      if (!c) return 'no contract';
      return K().assign(c.id, hands(n));
    },
    finish: (id) => {
      const c = first(id);
      if (!c) return 'no contract';
      if (c.kind === 'harvest') {
        c.done = c.qty;
        c.owed = 0;
      } else if (c.kind === 'repair') c.done = c.qty;
      else if (c.kind === 'build') c.done = c.hours;
      else c.delivered = c.qty;
      K().complete(c);
      return `settled: paid ${c.awarded?.pay}, +${c.awarded?.xp} XP, workers ${JSON.stringify(c.awarded?.workers || {})}`;
    },
    rank: (n) => {
      K().S.done = n;
      return K().rank().id;
    },
    stuck: () => {
      const before = Object.fromEntries(sim().workers.list().map((c) => [c.npcId, c.unstuck || 0]));
      sim().workers.watchdog();
      return sim().workers.list().filter((c) => (c.unstuck || 0) > before[c.npcId]).map((c) => `${c.npcId}: ${c.lastStuck?.why}`).join(' · ') || 'nobody stuck';
    },
  };
  return tools;
}
