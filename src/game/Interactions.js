/**
 * Interactions — what you can do with each kind of thing in the world.
 *
 * getActions(scene, target) returns a list of:
 *   { label, disabled, reason, run }
 * Disabled actions stay visible with the reason ("Opens at 08:00", "You need an axe"),
 * so the world explains itself instead of silently refusing.
 */
import { t, npcName } from '../i18n/i18n.js';
import { tr, buildingLabel } from '../ui/format.js';
import { BALANCE } from '../config/balance.js';
import { BUSINESSES } from '../data/businesses.js';
import { JOBS } from '../data/jobs.js';

const OK = { ok: true };

export function targetName(scene, target) {
  const sim = scene.sim;
  switch (target.kind) {
    case 'npc':
      return npcName(sim.npcs.byId(target.id));
    case 'object': {
      const obj = sim.state.objects[target.id];
      return t(`object.${obj.kind}_${obj.variant}`);
    }
    case 'building':
      return buildingLabel(sim, target.id);
    case 'decor':
      return t(`decor.${target.type}`);
    default:
      return '';
  }
}

export function getActions(scene, target) {
  const sim = scene.sim;
  const ui = scene.ui;
  const list = [];
  const add = (labelKey, params, run, check = OK) =>
    list.push({ label: tr(sim, labelKey, params), disabled: !check.ok, reason: check.ok ? '' : tr(sim, `reason.${check.reason}`, check.params || {}), run });

  switch (target.kind) {
    case 'object': {
      const obj = sim.state.objects[target.id];
      const kind = sim.actions.actionFor(obj);
      if (kind && sim.resources.isHarvestable(obj)) add(`action.${kind}`, {}, () => scene.performObjectAction(obj), sim.actions.check(obj));
      break;
    }
    case 'npc':
      add('action.talk', {}, () => ui.openDialogue(target.id));
      break;
    case 'decor':
      if (target.type === 'well') add('action.drink', {}, () => sim.actions.drinkWell(), sim.actions.canDrinkWell() ? OK : { ok: false, reason: 'not_thirsty' });
      if (target.type === 'notice_board') add('action.read_board', {}, () => ui.openJobBoard());
      break;
    case 'building':
      buildingActions(scene, target.id, add);
      break;
  }
  return list;
}

function buildingActions(scene, id, add) {
  const sim = scene.sim;
  const ui = scene.ui;
  const jobs = sim.jobs;
  const econ = sim.economy;
  const p = sim.state.player;
  const h = sim.time.hourFloat;
  const bizId = econ.businessAtBuilding(id);
  const def = bizId ? BUSINESSES[bizId] : null;

  // Job steps first — they're usually the reason you came.
  if (jobs.canPickup(id)) add('action.pickup_package', {}, () => jobs.pickup());
  if (jobs.canTurnIn(id)) {
    const job = jobs.active;
    if (job.type === 'courier') add('action.deliver_package', {}, () => jobs.turnIn());
    else add('action.deliver_goods', { qty: job.qty, item: job.item }, () => jobs.turnIn());
  }
  const job = jobs.active;
  if (job?.type === 'shift' && job.stage === 'go' && jobs.employerBuilding(job.jobId).id === id) {
    add('action.start_shift', { hours: JOBS[job.jobId].durationHours }, () => scene.workShift(), jobs.canStartShift(id));
  }

  if (id === p.homeId) {
    const night = h >= 18 || h < BALANCE.needs.wakeHour;
    if (night) add('action.sleep', {}, () => scene.sleep({ comfort: BALANCE.player.shackComfort, untilMorning: true }));
    else add('action.nap', { hours: BALANCE.needs.napHours }, () => scene.sleep({ comfort: BALANCE.player.shackComfort, untilMorning: false }));
    add('action.rent_info', {}, () =>
      sim.toast(p.rent.debt > 0 ? 'toast.rent_info_debt' : 'toast.rent_info', { money: p.rent.amount, days: Math.max(0, p.rent.nextDueDay - sim.time.day), debt: p.rent.debt }, 'info'),
    );
  }

  if (def) {
    const open = econ.isOpen(bizId);
    const closed = { ok: false, reason: 'closed', params: { hour: def.openHours?.[0] ?? 8 } };
    if (def.kind === 'shop') add('action.trade', {}, () => ui.openShop(bizId), open ? OK : closed);
    if (bizId === 'tavern') {
      add('action.eat_meal', { money: econ.playerBuyPrice('tavern', 'stew') }, () => sim.actions.eatAtTavern(), open ? OK : closed);
      const evening = h >= 18 || h < 3;
      add(
        'action.rent_bed',
        { money: BALANCE.tavernBedPrice },
        () => {
          if (sim.actions.payTavernBed()) scene.sleep({ comfort: BALANCE.player.tavernComfort, untilMorning: true });
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
  if (id === 'hall') add('action.read_board', {}, () => ui.openJobBoard());
}
