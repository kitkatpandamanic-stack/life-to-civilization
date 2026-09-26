/**
 * The guide: a way into everything the game has, one step at a time — and long paths to follow
 * once you know your way around (GuideSystem).
 *
 * GUIDE — "Getting started": chapters of steps. Each step is measured from the world (never a
 * counter of its own), so doing things in another order still counts. A step can wait for an
 * unlock (the level it opens at). Done: a small reward, once.
 *   done(sim) → true when it's been done · need — progression unlock it waits for
 *   where(sim) → { tx, ty } a place the arrow points to · open — the panel that helps
 *
 * PATHS — careers you can follow: ladders of milestones, each measured from the world.
 *   measure(sim) → [value, target] · reward { xp, money, rep }
 */
import { BUILDABLES } from './buildables.js';

const finished = (s, f) => s.construction.finished().filter((c) => f(BUILDABLES[c.type] || {}, c)).length;
const workers = (s) => s.workers.list().length;
const contractsDone = (s) => s.state.contracts?.done || 0;
const rankAt = (s, id) => {
  const order = ['odd_jobs', 'handyman', 'contractor', 'master'];
  return order.indexOf(s.contracts?.rank?.().id || 'odd_jobs') >= order.indexOf(id) ? 1 : 0;
};
const equipment = (s) => s.equipment?.mine() || [];
const orders = (s) => s.workers.state.orders || [];
const tenants = (s) => Object.values(s.property.all).filter((r) => r.owner === 'player' && r.lease?.tenant).length + (s.flats ? Object.values(s.property.all).filter((r) => r.owner === 'player' && r.flats).reduce((n, r) => n + Object.values(r.flats).filter((f) => f?.tenant).length, 0) : 0);
const owned = (s) => Object.values(s.property.all).filter((r) => r.owner === 'player').length;
const statusIdx = (s) => ['village', 'large_village', 'town', 'city'].indexOf(s.state.civic?.status || 'village');
const bestSkill = (s, ids) => Math.max(...ids.map((k) => s.state.player.skills[k]?.level || 0));
const noticeBoard = (s) => {
  const d = s.world.decor.find((x) => x.interact === 'notice_board');
  return d ? { tx: d.tx, ty: d.ty + 1 } : null;
};
const nearest = (s, kind) => {
  const p = s.world.toTile(s.state.player.x, s.state.player.y);
  const o = s.resources.findNearest(kind, p.tx, p.ty, 40, (x) => s.resources.isHarvestable(x) && (kind !== 'rock' || x.variant === 'stone'));
  return o ? { tx: o.tx, ty: o.ty } : null;
};
/** The nearest villager out of work (someone you could hire). */
const jobless = (s) => {
  const p = s.state.player;
  let best = null;
  let bd = Infinity;
  for (const n of s.state.npcs) {
    if (n.occupation !== 'unemployed' || n.age < 16 || n.away || n.inside || n.leaving) continue;
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < bd) (bd = d), (best = n);
  }
  return best ? s.world.toTile(best.x, best.y) : null;
};
/** The nearest signposted plot still for sale. */
const plotForSale = (s) => {
  const me = s.world.toTile(s.state.player.x, s.state.player.y);
  const pl = s.land.forSale().sort((a, b) => Math.abs(a.sign[0] - me.tx) + Math.abs(a.sign[1] - me.ty) - (Math.abs(b.sign[0] - me.tx) + Math.abs(b.sign[1] - me.ty)))[0];
  return pl ? { tx: pl.sign[0], ty: pl.sign[1] + 1 } : null;
};
const door = (s, id) => {
  const b = id && s.world.buildings[id];
  return b ? { tx: b.door.tx, ty: b.door.ty } : null;
};

/** Someone well past the basics (this level or more) isn't asked to find their first job: the first chapter counts as done. */
export const BASICS_BY_LEVEL = 5;

export const GUIDE = [
  {
    chapter: 'feet',
    steps: [
      { id: 'first_job', icon: '📋', done: (s) => (s.state.stats.jobsCompleted || 0) >= 1, where: noticeBoard, open: 'jobboard', reward: { money: 10, xp: 20 } },
      { id: 'chop_wood', icon: '🪓', done: (s) => (s.state.stats.treesChopped || 0) >= 3, where: (s) => nearest(s, 'tree'), reward: { money: 5, xp: 15 } },
      { id: 'earn_100', icon: '💰', done: (s) => (s.state.stats.moneyEarned || 0) >= 100, where: noticeBoard, open: 'jobboard', reward: { xp: 30 } },
      { id: 'craft', icon: '🪚', need: 'crafting', done: (s) => (s.state.stats.itemsCrafted || 0) >= 1, where: (s) => door(s, s.state.player.homeId), reward: { money: 10, xp: 25 } },
    ],
  },
  {
    chapter: 'crew',
    steps: [
      { id: 'hire', icon: '👷', need: 'hire_worker', done: (s) => workers(s) >= 1, where: jobless, open: 'workers', reward: { money: 20, xp: 40 } },
      { id: 'contract', icon: '📜', need: 'hire_worker', done: (s) => contractsDone(s) >= 1, where: noticeBoard, open: 'contracts', reward: { money: 25, xp: 50 } },
      { id: 'two_workers', icon: '👥', need: 'hire_worker', done: (s) => workers(s) >= 2, where: jobless, open: 'workers', reward: { xp: 40 } },
    ],
  },
  {
    chapter: 'land',
    steps: [
      { id: 'buy_land', icon: '🗺️', need: 'buy_land', done: (s) => (s.land.owned?.length || 0) >= 1, where: plotForSale, open: 'map', reward: { xp: 50 } },
      { id: 'build_store', icon: '🏚️', need: 'construction', done: (s) => finished(s, (fx) => fx.storage) >= 1, open: 'build', reward: { money: 20, xp: 60 } },
      { id: 'build_two', icon: '🏗️', need: 'construction', done: (s) => s.construction.finished().length >= 2, open: 'build', reward: { money: 30, xp: 60 } },
    ],
  },
  {
    chapter: 'goods',
    steps: [
      { id: 'get_equipment', icon: '🛒', need: 'hire_worker', done: (s) => equipment(s).length >= 1, open: 'equipment_shop', reward: { xp: 40 } },
      { id: 'lend_equipment', icon: '🤝', need: 'hire_worker', done: (s) => equipment(s).some((e) => e.holder?.kind === 'worker') || equipment(s).some((e) => (e.trips || 0) > 0 && e.holder?.kind !== 'player'), open: 'equipment', reward: { money: 15, xp: 40 } },
      { id: 'big_store', icon: '🏬', need: 'construction', done: (s) => finished(s, (fx) => (fx.storage || 0) >= 200 || fx.depot) >= 1, open: 'build', reward: { money: 30, xp: 80 } },
      { id: 'standing_order', icon: '🔁', need: 'hire_worker', done: (s) => orders(s).some((o) => (o.total || 0) > 0), open: 'orders', reward: { money: 25, xp: 80 } },
    ],
  },
  {
    chapter: 'name',
    steps: [
      { id: 'contracts_3', icon: '⭐', need: 'hire_worker', done: (s) => rankAt(s, 'handyman') > 0, open: 'contracts', reward: { money: 40, xp: 100 } },
      { id: 'business', icon: '🏪', need: 'start_business', done: (s) => (s.holdings?.mine().length || 0) + (s.businesses?.list().length || 0) >= 1, reward: { money: 50, xp: 100 } },
      { id: 'path', icon: '🧭', need: 'hire_worker', done: (s) => !!s.state.guide?.path, open: 'paths', reward: { xp: 30 } },
    ],
  },
];

export const PATHS = {
  contractor: {
    icon: '📜',
    milestones: [
      { id: 'first', measure: (s) => [contractsDone(s), 1], reward: { xp: 60, money: 30 } },
      { id: 'handyman', measure: (s) => [rankAt(s, 'handyman'), 1], reward: { xp: 120, rep: 2 } },
      { id: 'crew', measure: (s) => [workers(s), 4], reward: { xp: 120 } },
      { id: 'contractor', measure: (s) => [rankAt(s, 'contractor'), 1], reward: { xp: 200, money: 100, rep: 3 } },
      { id: 'company', measure: (s) => [s.state.contracts?.company ? 1 : 0, 1], reward: { xp: 200, rep: 3 } },
      { id: 'master', measure: (s) => [rankAt(s, 'master'), 1], reward: { xp: 400, money: 300, rep: 6 } },
    ],
  },
  transport: {
    icon: '🛞',
    milestones: [
      { id: 'barrow', measure: (s) => [equipment(s).length, 1], reward: { xp: 50 } },
      { id: 'lend_two', measure: (s) => [equipment(s).filter((e) => e.holder?.kind === 'worker').length, 2], reward: { xp: 100, money: 40 } },
      { id: 'depot', measure: (s) => [finished(s, (fx) => fx.depot), 1], reward: { xp: 150, money: 60 } },
      { id: 'orders', measure: (s) => [orders(s).filter((o) => (o.total || 0) > 0).length, 3], reward: { xp: 150, rep: 2 } },
      { id: 'deliveries', measure: (s) => [s.state.freight?.company?.delivered || 0, 10], reward: { xp: 150, money: 50 } },
      { id: 'cart', measure: (s) => [equipment(s).filter((e) => ['handcart', 'wooden_wagon', 'pack_horse', 'horse_cart', 'wagon'].includes(e.type)).length, 2], reward: { xp: 200 } },
      { id: 'caravan', measure: (s) => [s.state.freight?.caravanStats?.trips || 0, 1], reward: { xp: 200, money: 80 } },
      { id: 'tonnage', measure: (s) => [equipment(s).reduce((n, e) => n + (e.units || 0), 0), 3000], reward: { xp: 400, money: 250, rep: 5 } },
      { id: 'railway', measure: (s) => [Object.values(s.state.region?.list || {}).filter((x) => x.road >= 4).length, 1], reward: { xp: 600, money: 400, rep: 8 } },
    ],
  },
  landlord: {
    icon: '🔑',
    milestones: [
      { id: 'land', measure: (s) => [s.land.owned?.length || 0, 1], reward: { xp: 50 } },
      { id: 'two_buildings', measure: (s) => [owned(s), 2], reward: { xp: 100 } },
      { id: 'tenant', measure: (s) => [tenants(s), 1], reward: { xp: 120, money: 40 } },
      { id: 'three_tenants', measure: (s) => [tenants(s), 3], reward: { xp: 200, rep: 2 } },
      { id: 'estate', measure: (s) => [owned(s), 8], reward: { xp: 400, money: 250, rep: 5 } },
    ],
  },
  business: {
    icon: '🏪',
    milestones: [
      { id: 'first', measure: (s) => [(s.holdings?.mine().length || 0) + (s.businesses?.list().length || 0), 1], reward: { xp: 80 } },
      { id: 'staffed', measure: (s) => [s.holdings?.posted().length || 0, 2], reward: { xp: 120 } },
      { id: 'two', measure: (s) => [(s.holdings?.mine().length || 0) + (s.businesses?.list().length || 0), 2], reward: { xp: 200, money: 80 } },
      { id: 'earnings', measure: (s) => [Math.round(s.state.stats.moneyEarned || 0), 5000], reward: { xp: 300, rep: 3 } },
      { id: 'tycoon', measure: (s) => [(s.holdings?.mine().length || 0) + (s.businesses?.list().length || 0), 4], reward: { xp: 500, money: 400, rep: 6 } },
    ],
  },
  founder: {
    icon: '🏛️',
    milestones: [
      { id: 'known', measure: (s) => [Math.round(s.state.player.reputation || 0), 20], reward: { xp: 80 } },
      { id: 'benefactor', measure: (s) => [Math.round(s.state.player.donated || 0), 300], reward: { xp: 120 } },
      { id: 'large_village', measure: (s) => [statusIdx(s), 1], reward: { xp: 200, rep: 3 } },
      { id: 'headman', measure: (s) => [s.state.civic?.headman === 'player' ? 1 : 0, 1], reward: { xp: 250, rep: 4 } },
      { id: 'town', measure: (s) => [statusIdx(s), 2], reward: { xp: 500, money: 300, rep: 8 } },
    ],
  },
  craftsman: {
    icon: '🪚',
    milestones: [
      { id: 'skill3', measure: (s) => [bestSkill(s, ['carpentry', 'smithing', 'cooking']), 3], reward: { xp: 60 } },
      { id: 'fine', measure: (s) => [s.state.stats.itemsCrafted || 0, 25], reward: { xp: 100 } },
      { id: 'skill6', measure: (s) => [bestSkill(s, ['carpentry', 'smithing', 'cooking']), 6], reward: { xp: 200, money: 60 } },
      { id: 'masterwork', measure: (s) => [s.state.stats.masterworks || 0, 1], reward: { xp: 250, rep: 3 } },
      { id: 'master', measure: (s) => [bestSkill(s, ['carpentry', 'smithing', 'cooking']), 10], reward: { xp: 500, money: 300, rep: 5 } },
    ],
  },
};

/** How the advisor weighs what it suggests (higher first). */
export const ADVICE_PRIO = { danger: 100, money: 80, workers: 70, materials: 60, contract: 55, equipment: 45, opportunity: 35, guide: 20 };
