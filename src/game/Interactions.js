/**
 * Interactions — what you can do with each kind of thing in the world.
 *
 * getActions(scene, target) returns a list of:
 *   { label, disabled, reason, run }
 * Disabled actions stay visible with the reason ("Opens at 08:00", "You need an axe"),
 * so the world explains itself instead of silently refusing.
 */
import { DiscoveryPanel } from '../ui/panels/DiscoveryPanel.js';
import { BUILDABLES } from '../data/buildables.js';
import { SITE_KINDS } from '../data/sites.js';
import { FORGE_FEE } from '../systems/CraftingSystem.js';
import { t, npcName, fmtMoney } from '../i18n/i18n.js';
import { tr, buildingLabel, npcRole } from '../ui/format.js';
import { BALANCE } from '../config/balance.js';
import { JOBS } from '../data/jobs.js';
import { CROPS } from '../data/crops.js';

const OK = { ok: true };

export function targetName(scene, target) {
  const sim = scene.sim;
  switch (target.kind) {
    case 'npc':
      return npcName(sim.npcs.byId(target.id));
    case 'discovery':
      return t(`site.${sim.exploration.site(target.id)?.kind}.name`);
    case 'object': {
      const obj = sim.state.objects[target.id];
      return t(`object.${obj.kind}_${obj.variant}`);
    }
    case 'building':
      return buildingLabel(sim, target.id);
    case 'decor':
      if (target.type === 'land_sign') return t(`plot.${target.plotId}`);
      return t(`decor.${target.type}`);
    case 'furniture':
      return t(`furniture.${target.type}`);
    case 'site': {
      const c = sim.construction.byId(target.id);
      if (!c) return '';
      return t('ui.site_of', { name: sim.construction.isPlayers(c) ? t(`buildable.${c.type}.name`) : t(`vbuilding.${c.type}`) });
    }
    case 'ground': {
      const f = sim.farming.field(target.tx, target.ty);
      if (f?.crop) return t(`crop.${f.crop}`);
      return f ? t('ui.tilled_soil') : t('ui.your_land_tile');
    }
    case 'water':
      return t('ui.water_source');
    case 'animal':
      return t(`animal.${target.animal.kind}`);
    default:
      return '';
  }
}

/** Second line under the name: a villager's role, or whether a shop is open. */
export function targetSubtitle(scene, target) {
  const sim = scene.sim;
  if (target.kind === 'npc') return npcRole(sim, sim.npcs.byId(target.id));
  if (target.kind === 'discovery') return t(`site_state.${sim.exploration.site(target.id)?.state}`);
  if (target.kind === 'site') {
    const c = sim.construction.byId(target.id);
    return c ? t('ui.site_progress', { pct: Math.round((c.labor / c.laborNeeded) * 100), mat: Math.round(sim.construction.materialsFraction(c) * 100) }) : '';
  }
  if (target.kind === 'ground') {
    const f = sim.farming.field(target.tx, target.ty);
    if (!f?.crop) return '';
    if (f.dead) return t('ui.crop_dead');
    const crop = CROPS[f.crop];
    const state = sim.farming.isRipe(f) ? t('ui.crop_ripe') : t('ui.crop_growing', { d: Math.floor(f.growth), days: crop.days });
    return `${state}${f.watered ? ` · ${t('ui.watered')}` : ''}`;
  }
  if (target.kind === 'water' && sim.inventory.bestTool('fishing_rod')) {
    const c = sim.nature.fishChance(sim.nature.waterBody(target.tx, target.ty));
    return t(`ui.fish_${c > 0.55 ? 'plenty' : c > 0.3 ? 'some' : 'few'}`);
  }
  if (target.kind === 'decor' && target.type === 'land_sign') {
    const owner = sim.territory.owner(target.plotId);
    return owner === 'player' ? t('ui.your_land') : owner === 'village' ? t('ui.land_for_sale', { money: fmtMoney(sim.land.price(target.plotId)) }) : ownerLabel(sim, owner);
  }
  if (target.kind === 'building') {
    if (sim.disasters?.fireAt(target.id)) return t('ui.on_fire');
    const r = sim.property.rec(target.id);
    if (r?.ruined) return t('ui.ruin_tag');
    if (r?.abandoned) return t('ui.abandoned_tag');
    if (r?.forSale && sim.property.occupants(target.id) === 0) return `${t('ui.for_sale_tag')} · ${fmtMoney(sim.property.value(target.id))}`;
    const biz = sim.economy.businessAtBuilding(target.id);
    const def = biz && sim.economy.def(biz);
    if (def?.openHours) {
      return sim.economy.isOpen(biz) ? t('ui.open_until', { hour: `${def.openHours[1]}:00` }) : t('ui.closed_opens', { hour: `${String(def.openHours[0]).padStart(2, '0')}:00` });
    }
  }
  return '';
}

export function getActions(scene, target) {
  const sim = scene.sim;
  const ui = scene.ui;
  const list = [];
  // key: optional direct hotkey ('E' / 'F'). When every action has a key, no menu is needed.
  const add = (labelKey, params, run, check = OK, key = null) =>
    list.push({ label: tr(sim, labelKey, params), disabled: !check.ok, reason: check.ok ? '' : tr(sim, `reason.${check.reason}`, check.params || {}), run, key });

  switch (target.kind) {
    case 'object': {
      const obj = sim.state.objects[target.id];
      const kind = sim.actions.actionFor(obj);
      if (kind && (sim.resources.isHarvestable(obj) || kind === 'water')) add(kind === 'water' ? 'action.water_crop' : `action.${kind}`, {}, () => scene.performObjectAction(obj), sim.actions.check(obj));
      break;
    }
    case 'discovery': {
      const s = sim.exploration.site(target.id);
      if (s.state === 'discovered' || s.state === 'unknown') add('action.explore_site', {}, () => scene.exploreSite(s.id), sim.exploration.canExploreSite({ ...s, state: 'discovered' }));
      else if (s.state === 'explored' && SITE_KINDS[s.kind].outpost && !s.outpostSite) {
        const type = SITE_KINDS[s.kind].outpost;
        add('action.found_outpost', { building_type: type, money: BUILDABLES[type].money }, () => {
          const r = sim.exploration.foundOutpost(s.id);
          if (r.ok) ui.openSite(r.site.id);
          else sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
        }, sim.exploration.canFoundOutpost(s));
      } else add('action.look_around', {}, () => ui.openPanel(new DiscoveryPanel(ui, s.id, null)));
      break;
    }
    case 'npc':
      add('action.talk', {}, () => ui.openDialogue(target.id), OK, 'E');
      add('action.inspect', {}, () => ui.openInspect(target.id), OK, 'F');
      break;
    case 'decor':
      if (target.type === 'well') {
        add('action.drink', {}, () => sim.actions.drinkWell(), sim.actions.canDrinkWell() ? OK : { ok: false, reason: 'not_thirsty' });
        if (sim.farming.canNeedsRefill()) add('action.fill_can', {}, () => sim.farming.refillCan());
      }
      if (target.type === 'notice_board') add('action.read_board', {}, () => ui.openJobBoard());
      if (target.type === 'expedition') {
        const away = sim.state.exploration.trip || sim.state.region?.journey ? { ok: false, reason: 'already_away' } : OK;
        add('action.expedition', {}, () => ui.openExpedition(), away);
        // Trade: take goods to another settlement (once you know of one).
        add('action.journey', {}, () => ui.openJourney(), sim.settlements.known().length ? away : { ok: false, reason: 'no_settlements' });
      }
      if (target.type === 'land_sign') {
        if (sim.land.isOwned(target.plotId)) {
          const canBuild = sim.progression.hasUnlock('construction');
          add('action.build', {}, () => ui.openBuild(), canBuild ? OK : { ok: false, reason: 'locked', params: { level: sim.progression.unlockLevel('construction') } });
        }
        add('action.land_info', {}, () => ui.openLand(target.plotId));
      }
      break;
    case 'site': {
      const c = sim.construction.byId(target.id);
      if (c) siteActions(scene, c, add);
      break;
    }
    case 'ground':
      groundActions(scene, target.tx, target.ty, add);
      break;
    case 'water':
      if (sim.inventory.bestTool('fishing_rod')) add('action.fish', {}, () => scene.performFishing(target.tx, target.ty), sim.actions.checkFish());
      if (sim.farming.canNeedsRefill()) add('action.fill_can', {}, () => sim.farming.refillCan());
      break;
    case 'animal':
      add('action.hunt', {}, () => scene.performHunt(target.animal), sim.actions.checkHunt());
      break;
    case 'building':
      buildingActions(scene, target.id, add);
      break;
    case 'furniture':
      furnitureActions(scene, target.type, add);
      break;
  }
  return list;
}

/** A construction site (or your house while it's being upgraded). */
function siteActions(scene, c, add) {
  const sim = scene.sim;
  // A hauling job: the materials you carried are for this site.
  if (sim.jobs.canTurnInSite(c.id)) add('action.deliver_haul', { qty: sim.jobs.active.qty, item: sim.jobs.active.item }, () => sim.jobs.turnInSite(c.id));
  add('action.work_site', {}, () => scene.workOnSite(c), sim.construction.canWork(c));
  const missing = sim.construction.missing(c);
  const carrying = Object.keys(missing).some((id) => sim.inventory.count(id) > 0);
  add(
    'action.deliver_materials',
    {},
    () => {
      const n = sim.construction.deliver(c, 'inventory');
      sim.toast('toast.delivered', { qty: n }, 'gain');
    },
    carrying ? OK : { ok: false, reason: Object.keys(missing).length ? 'nothing_to_deliver' : 'all_delivered' },
  );
  add('action.inspect_site', {}, () => scene.ui.openSite(c.id));
}

/** Buildings the player built. */
function playerBuildingActions(scene, id, add) {
  const sim = scene.sim;
  const ui = scene.ui;
  const cons = sim.construction;
  const c = cons.byId(id);
  if (!c) return;
  const p = sim.state.player;
  if (cons.canMoveIn(id)) add('action.move_in', {}, () => cons.moveIn(id));
  if (p.homeId === id) {
    const upgrade = cons.sites().find((s) => s.kind === 'upgrade' && s.target === id);
    if (upgrade) siteActions(scene, upgrade, add);
    else if (sim.home.nextTier() && !sim.structures?.rec(id)) add('action.upgrade_home', {}, () => ui.openBuild('home'));
  }
  if (c.type === 'storage_shed') add('action.open_storage', {}, () => ui.openStorage());
  if (c.type === 'forge') add('action.use_own_forge', {}, () => ui.openCraft('forge'));
  const biz = sim.businesses.atBuilding(id);
  if (biz) {
    const B = sim.businesses;
    const input = B.type(biz).input;
    add('action.manage_business', {}, () => ui.openBusiness(biz.id));
    add('action.work_business', {}, () => scene.workAtBusiness(biz), B.hasWork(biz) ? (p.energy >= 8 ? OK : { ok: false, reason: 'too_tired' }) : { ok: false, reason: 'no_materials_ws', params: { item: input } });
    if (sim.inventory.count(input) > 0) add('action.deliver_input', { item: input }, () => sim.toast('toast.delivered', { qty: B.deliverFromPockets(biz) }, 'gain'));
  }
  if (c.type === 'well') {
    add('action.drink', {}, () => sim.actions.drinkWell(), sim.actions.canDrinkWell() ? OK : { ok: false, reason: 'not_thirsty' });
    if (sim.farming.canNeedsRefill()) add('action.fill_can', {}, () => sim.farming.refillCan());
  }
}

/** A tile of your own land: till → plant → water → harvest. */
function groundActions(scene, tx, ty, add) {
  const farm = scene.sim.farming;
  const act = farm.actionFor(tx, ty);
  if (act === 'plant') {
    const seeds = farm.seedsCarried();
    if (seeds.length <= 1) add('action.farm_plant', { item: seeds[0] || 'wheat_seeds' }, () => scene.performFarm('plant', tx, ty, seeds[0]), farm.check('plant', tx, ty, seeds[0]));
    else for (const s of seeds) add('action.farm_plant', { item: s }, () => scene.performFarm('plant', tx, ty, s), farm.check('plant', tx, ty, s));
    return;
  }
  add(`action.farm_${act}`, {}, () => scene.performFarm(act, tx, ty), farm.check(act, tx, ty));
}

/** Furniture inside your home. */
function furnitureActions(scene, type, add) {
  const sim = scene.sim;
  const ui = scene.ui;
  const h = sim.time.hourFloat;
  switch (type) {
    case 'bed': {
      const night = h >= 18 || h < BALANCE.needs.wakeHour;
      if (night) add('action.sleep', {}, () => scene.sleep({ comfort: sim.home.comfort(), untilMorning: true }));
      else add('action.nap', { hours: BALANCE.needs.napHours }, () => scene.sleep({ comfort: sim.home.comfort(), untilMorning: false }));
      break;
    }
    case 'chest':
      add('action.open_storage', {}, () => ui.openStorage());
      break;
    case 'table':
      add('action.eat_table', {}, () => sim.home.eatAtTable());
      break;
    case 'workbench':
    case 'stove': {
      const unlocked = sim.progression.hasUnlock('crafting');
      add(`action.craft_${type}`, {}, () => ui.openCraft(type), unlocked ? OK : { ok: false, reason: 'locked', params: { level: sim.progression.unlockLevel('crafting') } });
      break;
    }
    case 'shelf':
      add('action.read_books', {}, () => sim.home.read(), sim.home.canRead());
      break;
    case 'fireplace':
      add('action.warm_up', {}, () => sim.home.warmUp(), OK);
      break;
    case 'door':
      add('action.leave_home', {}, () => scene.exitHome());
      break;
  }
}

function buildingActions(scene, id, add) {
  const sim = scene.sim;
  const ui = scene.ui;
  const jobs = sim.jobs;
  const econ = sim.economy;
  const p = sim.state.player;
  const h = sim.time.hourFloat;
  const bizId = econ.businessAtBuilding(id);
  const def = bizId ? econ.def(bizId) : null;
  if (sim.world.buildings[id]?.player) playerBuildingActions(scene, id, add);

  // Fire! Nothing else matters.
  if (sim.disasters?.fireAt(id)) {
    add('action.fight_fire', {}, () => scene.fightFire(id));
    return;
  }

  // Your own business.
  if (bizId && sim.holdings.isMine(bizId)) {
    add('action.manage_enterprise', {}, () => ui.openEnterprise(bizId));
    // Your hired workers: send them to work here (they join the staff).
    if (econ.def(bizId)?.workerOccupation && sim.workers.list().length) add('action.send_workers_here', {}, () => ui.openEnterprise(bizId, 'workers'));
    add('action.work_own_shift', {}, () => scene.workOwnShift(bizId), p.energy >= 15 ? OK : { ok: false, reason: 'too_tired' });
  } else if (bizId && econ.owner(bizId)) add('action.business_dealings', {}, () => ui.openProperty(id));
  else if (!bizId && sim.holdings.canOpenIn(id).ok) add('action.open_business_here', {}, () => ui.openProperty(id));

  // The smith lets you use the forge for a small fee (paid once a day).
  if (def?.type === 'smithy' && econ.isOpen(bizId) && sim.progression.hasUnlock('crafting')) {
    const paid = p.forgeDay === sim.time.day;
    const hostile = sim.social.tier(econ.owner(bizId) || {}) === 'hostile';
    add(paid ? 'action.use_forge' : 'action.rent_forge', { money: FORGE_FEE }, () => {
      if (sim.crafting.rentForge(bizId)) ui.openCraft('forge');
    }, hostile ? { ok: false, reason: 'forge_refused' } : paid || p.money >= FORGE_FEE ? OK : { ok: false, reason: 'no_money' });
  }

  // Contracts: hand over goods here, or collect goods to haul.
  for (const c of sim.contracts.at(id)) {
    if (c.kind === 'haul' && c.from === id && c.collected < c.qty) add('action.contract_collect', { qty: c.qty - c.collected, item: c.item }, () => sim.contracts.collect(c.id));
    else if (c.kind === 'repair' && c.building === id) add('action.contract_repair', { n: Math.round(sim.property.rec(id)?.condition ?? 0) }, () => scene.repairForContract(c.id), sim.contracts.canRepair(c));
    else if (c.kind === 'harvest' && c.building === id) {
      // The farmer's wheat you picked: hand it over at the farmhouse.
      if ((c.owed || 0) > 0) add('action.contract_handover', { qty: sim.contracts.deliverable(c), item: c.item }, () => sim.contracts.deliver(c.id), sim.contracts.deliverable(c) > 0 ? OK : { ok: false, reason: 'contract_nothing', params: { item: c.item } });
    } else if (c.building === id && c.kind !== 'build') {
      const n = sim.contracts.deliverable(c);
      add('action.contract_deliver', { qty: n || c.qty - c.delivered, item: c.item }, () => sim.contracts.deliver(c.id), n > 0 ? OK : { ok: false, reason: c.minQ !== undefined ? 'contract_quality' : 'contract_nothing', params: { item: c.item } });
    }
  }

  // Work going on at this building (a new level, a room, a renovation — yours or a villager's): lend a hand.
  const works = sim.structures?.works(id);
  if (works) siteActions(scene, works, add);
  // Your own building: see what could be done to it.
  if (sim.structures?.rec(id) && sim.property.rec(id)?.owner === 'player' && !works) add('action.improve_building', {}, () => ui.openProperty(id, 'building'));
  // A house you let out: call on the tenants (the lease, the rent, notice). An empty one: the "to let" sign.
  const pr = sim.property.rec(id);
  if (pr?.owner === 'player' && id !== p.homeId && sim.property.isHome(id) && !bizId) {
    if (pr.lease) add('action.call_on_tenants', {}, () => ui.openProperty(id));
    else if (sim.letting.lettable(id)) add(sim.letting.listed(id) ? 'action.take_sign_down' : 'action.put_sign_up', {}, () => sim.letting.list(id, !sim.letting.listed(id)));
  }
  // A house of yours that stands empty: move in.
  if (!sim.world.buildings[id]?.player && sim.construction.canMoveIn(id)) add('action.move_in', {}, () => sim.construction.moveIn(id));

  // Job steps first — they're usually the reason you came.
  if (jobs.canPickup(id)) {
    const job = jobs.active;
    if (job.type === 'haul') add('action.pickup_haul', { qty: job.qty, item: job.item }, () => jobs.pickup());
    else if (job.type === 'rounds') add('action.pickup_letters', { n: job.targets.length }, () => jobs.pickup());
    else add('action.pickup_package', {}, () => jobs.pickup());
  }
  if (jobs.canTurnIn(id)) {
    const job = jobs.active;
    if (job.type === 'courier') add('action.deliver_package', {}, () => jobs.turnIn(id));
    else if (job.type === 'rounds') add('action.deliver_letter', {}, () => jobs.turnIn(id));
    else add('action.deliver_goods', { qty: job.qty, item: job.item }, () => jobs.turnIn(id));
  }
  const job = jobs.active;
  if (job?.type === 'shift' && job.stage === 'go' && jobs.jobBuilding(job)?.id === id) {
    add('action.start_shift', { hours: JOBS[job.jobId].durationHours }, () => scene.workShift(), jobs.canStartShift(id));
  }

  if (id === p.homeId) {
    add('action.enter_home', {}, () => scene.enterHome());
    const night = h >= 18 || h < BALANCE.needs.wakeHour;
    if (night) add('action.sleep', {}, () => scene.sleep({ comfort: sim.home.comfort(), untilMorning: true }));
    else add('action.nap', { hours: BALANCE.needs.napHours }, () => scene.sleep({ comfort: sim.home.comfort(), untilMorning: false }));
    add('action.rent_info', {}, () =>
      sim.toast(p.rent.debt > 0 ? 'toast.rent_info_debt' : 'toast.rent_info', { money: p.rent.amount, days: Math.max(0, p.rent.nextDueDay - sim.time.day), debt: p.rent.debt }, 'info'),
    );
  }

  if (def) {
    const open = econ.isOpen(bizId);
    const closed = { ok: false, reason: 'closed', params: { hour: def.openHours?.[0] ?? 8 } };
    if (def.kind === 'shop') add('action.trade', {}, () => ui.openShop(bizId), open ? OK : closed);
    if (def.type === 'tavern') {
      add('action.eat_meal', { money: econ.playerBuyPrice(bizId, 'stew') }, () => sim.actions.eatAtTavern(bizId), open ? OK : closed);
      const evening = h >= 18 || h < 3;
      add(
        'action.rent_bed',
        { money: BALANCE.tavernBedPrice },
        () => {
          if (sim.actions.payTavernBed(bizId)) scene.sleep({ comfort: BALANCE.player.tavernComfort, untilMorning: true });
        },
        !open ? closed : evening ? OK : { ok: false, reason: 'too_early', params: { hour: 18 } },
      );
    }
    if (def.repairs) add('action.repair', {}, () => ui.openShop(bizId, 'repair'), open ? OK : closed);
    if (jobs.jobsForBusiness(bizId).length) add('action.ask_work', {}, () => ui.openJobBoard(bizId));
  }

  // Talk to whoever is inside.
  const inside = sim.npcs.insideOf(id);
  for (const n of inside.slice(0, 3)) {
    const asleep = n.task?.type === 'sleep';
    add('action.talk_to', { npc: n.id }, () => ui.openDialogue(n.id), asleep ? { ok: false, reason: 'asleep' } : OK);
  }
  if (!inside.length && id.startsWith('house_')) add('action.knock', {}, () => sim.toast('toast.nobody_home', {}, 'info'));
  // A school: go in and see the classes, the pupils and the teachers — sit in on a class, or teach one (StudySystem).
  if (sim.schools?.rec(id)) {
    add('action.visit_school', {}, () => ui.openSchool(id));
    const S = sim.study;
    const cls = S.classNow(id);
    if (cls) add(cls.field ? 'action.attend_course' : 'action.attend_class', { field: cls.field || undefined }, () => scene.study('class', id));
    const lesson = S.lessonToGive(id);
    if (lesson) add('action.give_lesson', {}, () => scene.study('teach', id), S.canGiveLesson(id));
  }
  // The library: an hour with the books (if you can read).
  if (sim.world.buildings[id]?.type === 'library' && sim.property.rec(id)) add('action.read_library', {}, () => scene.study('read', id), sim.study.canRead(id));
  // Your master's workplace: half a day beside them.
  if (sim.study?.e.apprentice && sim.economy.biz(sim.study.e.apprentice.biz)?.building === id) {
    const c = sim.study.canWorkBeside(id);
    add('action.work_beside', { npc: sim.study.e.apprentice.master }, () => scene.study('beside', id), c);
  }
  if (sim.world.buildings[id]?.type === 'institute' && sim.property.rec(id)) add('action.visit_institute', {}, () => ui.openInstitute(id));
  if (id === 'hall') {
    add('action.village_affairs', {}, () => ui.openHall());
    add('action.read_board', {}, () => ui.openJobBoard());
  }
  // Every building can be inspected: owner, residents, condition, value, history.
  if (sim.property.rec(id)) add('action.inspect', {}, () => ui.openProperty(id), OK, 'F');
}
