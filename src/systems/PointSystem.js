/**
 * PointSystem — where people stand when they use a building or a construction site.
 *
 * Nobody should ever have to stand on someone else's head, so every building and site has
 * its interaction points, each a real tile beside it:
 *
 *   door      — the way in
 *   load      — the front of the building either side of the door: where carriers load and unload
 *   park      — the row in front of that: where barrows, carts and wagons are left (a transport depot has many)
 *   work      — all round the walls: where builders and repairers work
 *   material  — at a construction site, the front corners: where materials are dropped
 *   storage · workbench · bed — inside (reached by the door): what the building offers within
 *
 * Points aren't stored: they're worked out from the building's footprint, so they can never go
 * stale. Who has a point is read from the world too — a worker's reserved task spot, a parked
 * cart — so a reservation can't outlive the worker or the cart that made it. A worker reserves
 * a point before walking over; if all are taken they use another kind, wait, or find other work.
 */
import { BUILDABLES } from '../data/buildables.js';
import { TYPE_FAMILY } from '../data/structures.js';

/** Indoor points each family of building offers (reached through the door). */
const INSIDE = {
  house: ['bed', 'storage'],
  apartment: ['bed', 'storage'],
  workshop: ['workbench', 'storage'],
  yard: ['workbench', 'storage'],
  farm: ['storage'],
  warehouse: ['storage'],
  depot: ['storage'],
  shop: ['storage'],
  inn: ['bed', 'storage'],
};

export class PointSystem {
  constructor(sim) {
    this.sim = sim;
    this.cache = new Map(); // target → { at: time.total, list }
    const clear = () => this.cache.clear();
    for (const ev of ['building:added', 'building:removed', 'construction:changed', 'road:built', 'structure:changed']) sim.bus.on(ev, clear);
  }

  /** A building (world.buildings) or a construction site, as a rectangle. */
  rect(target) {
    const b = this.sim.world.buildings[target];
    if (b) return { id: b.id, tx: b.tx, ty: b.ty, w: b.w, h: b.h, door: b.door, type: b.type, site: false };
    const s = this.sim.construction.byId(target);
    if (s) {
      if (s.kind === 'works' && this.sim.world.buildings[s.target]) {
        const wb = this.sim.world.buildings[s.target];
        return { id: s.id, tx: wb.tx, ty: wb.ty, w: wb.w, h: wb.h, door: wb.door, type: s.type, site: true };
      }
      return { id: s.id, tx: s.tx, ty: s.ty, w: s.w, h: s.h, door: null, type: s.type, site: true };
    }
    return null;
  }

  /** How many cars a depot (or yard) has room for. */
  parking(r) {
    if (r.site) return 0;
    const own = this.sim.construction.byId(r.id);
    const fx = own && BUILDABLES[own.type]?.effect;
    if (fx?.depot) return (fx.parking || 6) + ((this.sim.structures?.rec(r.id)?.lvl || 1) - 1) * 4;
    return fx?.storage ? 3 : 2;
  }

  /** Every point of a building or site (worked out from its footprint; cached for a game minute). */
  of(target) {
    const now = this.sim.time.total;
    const hit = this.cache.get(target);
    if (hit && hit.at === now) return hit.list;
    const list = this.compute(target);
    this.cache.set(target, { at: now, list });
    return list;
  }

  compute(target) {
    const r = this.rect(target);
    if (!r) return [];
    const w = this.sim.world;
    const out = [];
    const seen = new Set();
    const ok = (x, y) => w.inBounds(x, y) && !w.isBlocked(x, y) && !seen.has(`${x},${y}`);
    const push = (role, tx, ty, extra = {}) => {
      if (!extra.inside && !ok(tx, ty)) return false;
      if (!extra.inside) seen.add(`${tx},${ty}`);
      out.push({ key: `${r.id}|${role}|${out.filter((p) => p.role === role).length}`, target: r.id, role, tx, ty, ...extra });
      return true;
    };
    const front = r.ty + r.h;
    const byDoor = (a, b) => Math.abs(a - (r.door?.tx ?? r.tx + r.w / 2)) - Math.abs(b - (r.door?.tx ?? r.tx + r.w / 2));
    if (!r.site || r.door) {
      // The door, and the front either side of it for loading.
      if (r.door) {
        seen.add(`${r.door.tx},${r.door.ty}`);
        out.push({ key: `${r.id}|door|0`, target: r.id, role: 'door', tx: r.door.tx, ty: r.door.ty });
      }
      const xs = [];
      for (let x = r.tx - 1; x <= r.tx + r.w; x++) xs.push(x);
      xs.sort(byDoor);
      let loads = 0;
      for (const x of xs) if (loads < 4 && push(r.site ? 'material' : 'load', x, front)) loads++;
      // Parking: the row in front of that, nearest the door first.
      const want = this.parking(r);
      let parked = 0;
      for (let row = front + 1; row <= front + 3 && parked < want; row++) {
        for (const x of xs) if (parked < want && push('park', x, row)) parked++;
      }
      // Inside: what the building offers within (reached by the door).
      const fam = TYPE_FAMILY[r.type]?.[0] || (BUILDABLES[r.type]?.effect?.depot ? 'depot' : BUILDABLES[r.type]?.effect?.storage ? 'warehouse' : null);
      if (r.door && !r.site) for (const role of INSIDE[fam] || []) out.push({ key: `${r.id}|${role}|0`, target: r.id, role, tx: r.door.tx, ty: r.door.ty, inside: true });
    }
    // A site: materials dropped at the front corners, and everyone else round the walls.
    if (r.site && !r.door) {
      push('material', r.tx, front);
      push('material', r.tx + r.w - 1, front);
    }
    for (const s of this.sim.workers.spots(r)) push('work', s.tx, s.ty);
    return out;
  }

  /** Points of a kind. */
  list(target, role) {
    return this.of(target).filter((p) => p.role === role);
  }

  /** Tiles someone has (a worker's reserved spot, a parked cart) — except this worker's own. */
  taken(except = null) {
    const out = new Map();
    for (const c of this.sim.workers.list()) if (c.npcId !== except && c.task?.spot) out.set(`${c.task.spot.tx},${c.task.spot.ty}`, c.npcId);
    for (const eq of this.sim.equipment?.list() || []) if (eq.at?.kind === 'ground') out.set(`${eq.at.tx},${eq.at.ty}`, eq.id);
    return out;
  }

  /** A free point of this kind for this worker (nearest to `near` first), or null. */
  free(target, role, npcId = null, near = null) {
    const taken = this.taken(npcId);
    let list = this.list(target, role).filter((p) => p.inside || !taken.has(`${p.tx},${p.ty}`));
    if (near) list = list.sort((a, b) => Math.abs(a.tx - near.tx) + Math.abs(a.ty - near.ty) - (Math.abs(b.tx - near.tx) + Math.abs(b.ty - near.ty)));
    return list[0] || null;
  }

  /** How many can use it at once for a kind of work (its free and taken points). */
  slots(target, role = 'work') {
    return this.list(target, role).length;
  }

  /** The building whose door is at this tile (for tasks that only know where they go). */
  atDoor(tx, ty) {
    for (const b of this.sim.world.buildingList) if (b.door?.tx === tx && b.door?.ty === ty) return b.id;
    return null;
  }

  /**
   * Where a worker should stand to load or unload at a building: a free loading point, or the
   * door if they're all taken (a short wait at the door beats standing in each other).
   */
  standAt(buildingId, npcId, near = null) {
    const p = this.free(buildingId, 'load', npcId, near) || this.free(buildingId, 'door', npcId, near);
    if (p) return { tx: p.tx, ty: p.ty, point: p.key };
    const b = this.sim.world.buildings[buildingId];
    return b ? this.sim.world.nearestWalkable(b.door.tx, b.door.ty, 3) : null;
  }

  /** Where to leave a barrow or cart at a building: a free parking point (or anywhere near the door). */
  parkAt(buildingId, near = null) {
    const p = this.free(buildingId, 'park', null, near);
    if (p) return { tx: p.tx, ty: p.ty };
    const b = this.sim.world.buildings[buildingId];
    if (!b) return null;
    const taken = this.taken();
    for (let r = 1; r <= 5; r++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = b.door.tx + dx;
        const y = b.door.ty + r;
        if (this.sim.world.inBounds(x, y) && !this.sim.world.isBlocked(x, y) && !taken.has(`${x},${y}`)) return { tx: x, ty: y };
      }
    }
    return this.sim.world.nearestWalkable(b.door.tx, b.door.ty + 1, 4);
  }
}
