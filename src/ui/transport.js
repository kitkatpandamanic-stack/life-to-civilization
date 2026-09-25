/**
 * Transport in the UI: one worker at a glance — their job, what they're doing, what they're
 * pushing and what's in it, and where they are in a round of carrying:
 *
 *   Worker: Alex · Job: House construction · Task: Transport wood · Equipment: Wheelbarrow Lv2
 *   Cargo: 60 / 80 · Status: Working            [collect → load → transport → unload → return]
 */
import { t, npcName } from '../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel } from './format.js';
import { button, status } from './widgets.js';
import { EQUIPMENT } from '../data/transport.js';

export const ROUND = ['collect', 'load', 'transport', 'unload', 'return'];
const STATE_KIND = { working: 'good', moving: 'info', seeking: 'info', waiting: 'warn', need_materials: 'warn', unavailable: 'danger', failed: 'danger' };

/** The job a worker's on, in words (a contract, or their role). */
export function jobText(sim, npcId) {
  const c = sim.workers.contract(npcId);
  const job = sim.contracts.jobOf(npcId);
  if (job) {
    const site = job.siteId && sim.construction.byId(job.siteId);
    const what = site ? (site.kind === 'works' ? buildingLabel(sim, site.target) : t(`vbuilding.${site.type}`)) : null;
    const client = job.issuer && job.issuer !== 'village' ? npcName(sim.npcs.byId(job.issuer)) : null;
    return `${t(`contract.kind.${job.kind}`)}${what ? ` — ${what}` : client ? ` — ${client}` : ''}`;
  }
  return t(`assignment.${c?.assignment?.type || 'idle'}`);
}

/** The task in words ("Transport wood", "Building", "Fetching the wheelbarrow"). */
export function taskText(sim, npc) {
  const act = sim.workers.activity(npc);
  return act ? t(`activity.${act.key}`, { ...(act.params || {}), item: act.params?.item ? t(`item.${act.params.item}.name`).toLowerCase() : undefined, eq: act.params?.eq ? t(`equip.${act.params.eq}`).toLowerCase() : undefined }) : '—';
}

/** A worker's card: job, task, equipment, cargo, status — and a way to lend or take back equipment. */
export function workerCardHtml(sim, npc, { buttons = true } = {}) {
  const W = sim.workers;
  const c = W.contract(npc.id);
  if (!c) return '';
  const E = sim.equipment;
  const eq = E?.assignedTo(npc.id);
  const using = E?.using(npc);
  const cap = W.carryCap(npc);
  const load = npc.carry?.qty || 0;
  const eqText = eq
    ? `${EQUIPMENT[eq.type].icon} ${t(`equip.${eq.type}`)} ${t('equip.lv', { n: eq.level || 1 })} · ${Math.round(eq.condition)}%${using ? '' : ` · ${t(eq.recall ? 'equip.coming_back' : 'wcard.not_in_hand')}`}${eq.recall && using ? ` · ${t('equip.coming_back')}` : ''}`
    : t('wcard.by_hand');
  const st = c.state || 'idle';
  const inRound = ROUND.includes(c.phase) && (st === 'working' || st === 'moving');
  const round = inRound ? `<div class="round-row">${ROUND.map((p) => `<span class="stage${p === c.phase ? ' now' : ''}">${escapeHtml(t(`phase.${p}`))}</span>`).join('<span class="stage-arrow">→</span>')}</div>` : '';
  const btn = !buttons
    ? ''
    : eq
      ? button(t('equip.retrieve'), 'eq_retrieve', { id: eq.id }, { cls: 'sm ghost', disabled: !!eq.recall, title: t('equip.retrieve_tip') })
      : button(t('wcard.lend'), 'eq_lend', { npc: npc.id }, { cls: 'sm ghost', disabled: !E?.mine().length, title: E?.mine().length ? '' : t('reason.eq_none') });
  const row = (k, v) => `<div>${escapeHtml(t(k))}</div><div>${v}</div>`;
  return `<div class="card wcard"><div class="kv-grid small">
      ${row('wcard.worker', `<b>${escapeHtml(npcName(npc))}</b>`)}
      ${row('wcard.job', escapeHtml(jobText(sim, npc.id)))}
      ${row('wcard.task', escapeHtml(taskText(sim, npc)))}
      ${row('wcard.equipment', `${escapeHtml(eqText)} ${btn}`)}
      ${row('wcard.cargo', `<b>${load} / ${cap}</b>${npc.carry ? ` ${escapeHtml(t(`item.${npc.carry.item}.name`))}` : ''}`)}
      ${row('wcard.status', status(t(`wstate.${st}`), STATE_KIND[st] || 'neutral'))}
    </div>${round}</div>`;
}

/** Handle the card's buttons (for any panel that shows it). Returns true if it was one of them. */
export function workerCardAction(ui, action, data) {
  const sim = ui.sim;
  if (action === 'eq_lend') {
    ui.openEquipment({ lendTo: data.npc });
    return true;
  }
  if (action === 'eq_retrieve') {
    const eq = sim.equipment.byId(data.id);
    const npc = eq?.holder?.id;
    const r = sim.equipment.retrieve(data.id);
    sim.toast(r.ok ? (r.returning ? 'toast.eq_returning' : 'toast.eq_back') : `reason.${r.reason}`, { npc, eq: eq?.type }, r.ok ? 'info' : 'warn');
    return true;
  }
  return false;
}
