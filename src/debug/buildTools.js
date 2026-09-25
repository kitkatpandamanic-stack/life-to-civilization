/**
 * Building, housing and territory developer tools (development builds only — see devTools.js / DebugPanel.js).
 * In the browser console:
 *   dev.bt.building('house', 'village')      put up a building near you at once (owner: 'village', 'player' or a villager id)
 *   dev.bt.upgrade(id) / repair(id) / damage(id, 40) / expand(id, 'bedroom')
 *   dev.bt.complete()                          finish every building site and works near you
 *   dev.bt.setRent(id, 20) / addTenant(id, npcId) / removeTenant(id)
 *   dev.bt.landOwner(plotId, owner) / plotHere()
 *   dev.bt.neighbourhood()                    three houses with families near you → a neighbourhood
 *   dev.bt.district('shop')                    three shops (or 'home', 'workshop') near you → a district of that kind
 *   dev.bt.places()                            recount neighbourhoods and districts (and list them)
 *   dev.bt.setType(plotId, 'industrial') / setType(plotId, null)   pin a plot's territory type (or let it be what it is)
 *   dev.bt.develop(plotId)                     a house on that plot (its development goes up)
 *   dev.bt.inspect(id) / land()               open the building's / the land-under-you's panel
 *   dev.bt.developer(npcId?) / buyLot(npcId?)  a villager starts a row of houses to let · buys a lot for a home
 *   dev.bt.convert(id, 'shopfront') / demolish(id) / merge(a, b)   change a building at once (whoever owns it)
 *   dev.bt.joinPlots(a, b) / splitPlot(id)    reshape land (made yours first)
 *   dev.bt.flats(owner)                        a block of flats near you, with households moving in
 *   dev.bt.pave(n) / lamp() / works() / infra()  cobble n road tiles near you · a lamp near you · the village's public works now · the numbers
 */
import { VILLAGE_BUILDINGS } from '../data/villageBuildings.js';

export function buildTools(dev) {
  const sim = () => dev.sim;
  const here = () => sim().world.toTile(sim().state.player.x, sim().state.player.y);
  const finish = (c) => {
    if (!c) return null;
    c.delivered = { ...c.required };
    c.labor = c.laborNeeded;
    sim().construction.tryComplete(c);
    return c.id;
  };
  const tools = {
    /** A building of a village type (house, small_house, shopfront, warehouse, well, school…) near you, finished at once. */
    building: (type = 'small_house', owner = 'village', purpose = null) => {
      const s = sim();
      const def = VILLAGE_BUILDINGS[type];
      if (!def) return `no such type: ${Object.keys(VILLAGE_BUILDINGS).join(', ')}`;
      const who = owner === 'village' || owner === 'player' ? 'village' : s.npcs.byId(owner);
      if (!who) return 'no such villager';
      if (who !== 'village') who.money += 3000;
      else s.state.village.treasury += 3000;
      const c = s.growth.start(who, type, purpose || def.purposes[0], here());
      const id = finish(c);
      if (id && owner === 'player') s.property.transfer(id, 'player', 'gift');
      return id || 'no room here';
    },
    upgrade: (id) => {
      const S = sim().structures;
      const r = S.rec(id);
      if (!r || r.lvl >= S.maxLevel(id)) return 'cannot';
      r.lvl++;
      r.ups = (r.ups || 0) + 1;
      S.changed(id);
      S.refreshLook(id);
      return r.lvl;
    },
    repair: (id) => {
      const r = sim().property.rec(id);
      if (!r) return 'no building';
      r.condition = 100;
      r.abandoned = false;
      sim().bus.emit('property:changed', id);
      return 100;
    },
    damage: (id, by = 40) => {
      const r = sim().property.rec(id);
      if (!r) return 'no building';
      r.condition = Math.max(0, r.condition - by);
      sim().bus.emit('property:changed', id);
      return r.condition;
    },
    /** Fit a module at once (bedroom, kitchen, garden, cellar…) — it grows onto free ground if it needs room. */
    expand: (id, m = 'bedroom') => {
      const S = sim().structures;
      const owner = S.owner(id);
      const res = S.start(id, { type: 'module', m }, owner === 'player' ? 'player' : owner || 'village');
      if (!res.ok) return res.reason;
      return finish(res.site);
    },
    /** Finish every building site and works within 20 tiles of you. */
    complete: () => {
      const s = sim();
      const me = here();
      const done = [];
      for (const c of s.construction.sites().slice()) {
        if (Math.abs(c.tx - me.tx) + Math.abs(c.ty - me.ty) > 20) continue;
        finish(c);
        done.push(c.id);
      }
      return done;
    },
    setRent: (id, n) => {
      const P = sim().property;
      if (P.lease(id)) P.lease(id).rent = n;
      P.rec(id).ask = n;
      return P.weeklyRent(id);
    },
    addTenant: (id, npcId = null) => {
      const s = sim();
      const P = s.property;
      const n = npcId ? s.npcs.byId(npcId) : s.state.npcs.find((x) => x.age >= 18 && x.homeId !== id && P.rec(x.homeId)?.owner !== x.id && !P.lease(x.homeId));
      if (!n) return 'nobody to move in';
      s.letting.moveIn(n, id, 'debug');
      return P.lease(id) || n.homeId;
    },
    removeTenant: (id) => {
      const P = sim().property;
      if (!P.lease(id)) return 'no tenant';
      P.vacate(id);
      return 'gone';
    },
    landOwner: (plotId, owner = 'player') => {
      sim().territory.transfer(plotId, owner, 'debug');
      return sim().territory.owner(plotId);
    },
    /** A 5×5 lot of your own, carved out where you stand. */
    plotHere: () => {
      const { tx, ty } = here();
      const T2 = sim().territory;
      const price = T2.acquireLot('player', tx - 2, ty - 2, tx + 2, ty + 2, { pay: false, how: 'debug' });
      return price < 0 ? 'cannot' : T2.idAt(tx, ty);
    },
    /** Three houses with families near you, and the week's recount: a neighbourhood. */
    neighbourhood: () => {
      const s = sim();
      const ids = [];
      for (let i = 0; i < 3; i++) {
        const id = tools.building(i ? 'small_house' : 'house', 'village', 'rental');
        if (!s.world.buildings[id]) continue;
        ids.push(id);
        s.growth.arrive({ homeId: id, size: 2 });
      }
      s.places.weekly();
      return { houses: ids, hood: s.places.hoodAt(here().tx, here().ty)?.id || null };
    },
    /** Three buildings of a kind near you ('shop', 'home', 'workshop'), and the districts recounted. */
    district: (kind = 'shop') => {
      const type = { shop: 'shopfront', home: 'small_house', workshop: 'warehouse' }[kind] || kind;
      const ids = [0, 1, 2].map(() => tools.building(type, 'village', VILLAGE_BUILDINGS[type]?.purposes[0]));
      if (kind === 'shop') for (const id of ids) if (sim().world.buildings[id]) sim().property.rec(id).formerBusiness = 'general_store';
      sim().places.updateDistricts();
      return { built: ids, district: sim().places.districtAt(here().tx, here().ty) };
    },
    places: () => {
      const s = sim();
      s.places.weekly();
      s.places.updateDistricts();
      console.table(s.places.hoods().map((h) => ({ id: h.id, name: `${h.name.f}.${h.name.v}`, kind: h.kind, homes: h.homes.length, pop: h.stats.pop, rep: h.stats.rep, services: h.stats.services.join(' ') })));
      console.table(s.state.districts.list.map((d) => ({ id: d.id, type: d.type, char: d.char, cells: d.cells.length })));
      return s.places.hoods().length;
    },
    setType: (plotId, type = null) => {
      const T2 = sim().territory;
      const r = T2.rec(plotId);
      if (!r) return 'no such plot';
      if (type) r.pin = type;
      else delete r.pin;
      T2.rev++;
      T2.weekly();
      return T2.profile(plotId)?.type;
    },
    /** A house on a plot (its development and worth go up at the week's review). */
    develop: (plotId) => {
      const s = sim();
      const q = s.territory.parcel(plotId);
      if (!q) return 'no such plot';
      s.state.village.treasury += 2000;
      const id = finish(s.growth.start('village', 'small_house', 'rental', { tx: Math.round(q.cx), ty: Math.round(q.cy) }));
      s.territory.weekly();
      return { house: id, dev: s.territory.rec(plotId)?.dev };
    },
    /** Cobble the n road tiles nearest you (the village's work: no cost). */
    pave: (n = 8) => {
      const s = sim();
      const me = here();
      const tiles = [];
      for (let r = 0; r <= 12 && tiles.length < n; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && tiles.length < n && s.infra.canPave(me.tx + dx, me.ty + dy, 'village').ok) tiles.push([me.tx + dx, me.ty + dy]);
      for (const [x, y] of tiles) s.infra.pave(x, y, 'village');
      return tiles.length;
    },
    lamp: () => {
      const s = sim();
      const spot = s.infra.lampSpot(here().tx, here().ty);
      return spot ? s.infra.lamp(spot.tx, spot.ty, 'village') : 'no spot by a road here';
    },
    works: () => {
      sim().infra.S.fund += 300;
      return sim().infra.publicWorks();
    },
    infra: () => {
      const s = sim();
      console.table(Object.entries(s.infra.S.traffic).sort((a, b) => b[1] - a[1]).slice(0, 10));
      return { ...s.infra.stats(), fund: s.infra.S.fund, here: s.infra.coverage(here().tx, here().ty) };
    },
    /** A villager (the richest, or this one) becomes a developer now: a row of houses to let. */
    developer: (npcId = null) => {
      const s = sim();
      const n = npcId ? s.npcs.byId(npcId) : s.state.npcs.filter((x) => x.age >= 25 && x.age <= 62 && !x.landPlan).sort((a, b) => b.money - a.money)[0];
      if (!n) return 'nobody';
      n.money = Math.max(n.money, 1200);
      if (!n.traits.includes('ambitious')) n.traits.push('ambitious');
      delete n.devRest;
      s.realty.S.idx = Math.max(s.realty.S.idx, 1.2);
      const D = s.development;
      const keep = D.minded;
      D.minded = () => true;
      const id = D.developers();
      D.minded = keep;
      return id ? n.landPlan : 'could not start';
    },
    /** A villager who rents buys a lot to build a home on later. */
    buyLot: (npcId = null) => {
      const s = sim();
      const n = npcId ? s.npcs.byId(npcId) : s.state.npcs.find((x) => x.age >= 20 && !x.landPlan && s.property.landlord(x));
      if (!n) return 'nobody renting';
      n.money = Math.max(n.money, 600);
      return s.development.buyHomeLot(n) ? n.landPlan : 'no lot';
    },
    /** Convert, pull down or join at once (the works finished on the spot). */
    convert: (id, to = 'shopfront') => tools.rebuild(id, { type: 'convert', to }),
    demolish: (id) => tools.rebuild(id, { type: 'demolish' }),
    merge: (a, b) => tools.rebuild(a, { type: 'merge', with: b }),
    rebuild: (id, job) => {
      const s = sim();
      const S = s.structures;
      const owner = S.owner(id) || 'village';
      if (owner === 'player') s.state.player.money += 5000;
      else if (owner === 'village') s.state.village.treasury += 5000;
      else if (s.npcs.byId(owner)) s.npcs.byId(owner).money += 5000;
      const res = S.start(id, job, owner);
      if (!res.ok) return res.reason;
      finish(res.site);
      return job.type === 'demolish' ? 'gone' : s.world.buildings[id]?.type;
    },
    joinPlots: (a, b) => {
      const T2 = sim().territory;
      for (const id of [a, b]) if (T2.owner(id) !== 'player') T2.transfer(id, 'player', 'debug');
      return T2.join(a, b);
    },
    splitPlot: (id) => {
      const T2 = sim().territory;
      if (T2.owner(id) !== 'player') T2.transfer(id, 'player', 'debug');
      return T2.split(id);
    },
    /** A block of flats near you (the village's, or yours), with newcomers taking all but one flat. */
    flats: (owner = 'village') => {
      const s = sim();
      const id = tools.building('apartment_house', owner === 'player' ? 'player' : 'village', 'rental');
      if (!s.world.buildings[id]) return id;
      for (let i = 0; i < s.flats.units(id) - 1; i++) s.growth.arrive({ homeId: id, size: 2 });
      return { id, units: s.flats.units(id), leases: s.flats.leases(id).map((x) => ({ flat: x.n, tenant: x.lease.tenant, rent: x.lease.rent })) };
    },
    inspect: (id) => dev.scene?.ui.openProperty(id),
    land: () => {
      const { tx, ty } = here();
      const id = sim().territory.idAt(tx, ty);
      if (id) dev.scene?.ui.openLand(id);
      return id;
    },
  };
  return tools;
}
