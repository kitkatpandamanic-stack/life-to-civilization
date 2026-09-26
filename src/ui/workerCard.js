/**
 * Workers in the world: the card you get by clicking one of your workers (or any villager),
 * the little status icon over their head, and the "following" strip while the camera rides along.
 *
 *   👷 John                         [🔨 Working]
 *   Builder · Lv 4  ██████░░ XP     Best at: building 46
 *   Task: Carrying wood → Anna's house     ████████░░ 82%
 *   📍 North Residential Area
 *   Equipment: 🛒 Wheelbarrow Lv2 · 74% · carries 60
 *   Works for: You · $18/day · Role: Builder · Contract: Harvest — Ivan
 *   [Follow] [Manage] [Equipment] [Priorities] [Contract] [Show]
 *
 * All of it is read from WorkerSystem (the contract, its task and state), EquipmentSystem and ContractSystem.
 */
import { t, npcName, fmtMoney, occupationName, cap } from '../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel, districtLabel, hoodLabel, npcRole } from './format.js';
import { status, condBar, progress, portrait, hearts } from './widgets.js';
import { stateBadge, taskText, jobText } from './transport.js';
import { EQUIPMENT } from '../data/transport.js';

const TS = 32;
const HAUL_PHASES = new Set(['collect', 'load', 'transport', 'unload']);

/** The Workforce screen's status groups (WorkersPanel), most urgent last so a sort puts them first. */
export const GROUPS = ['resting', 'idle', 'traveling', 'working', 'waiting', 'stuck'];
export const GROUP_ICONS = { all: '👥', working: '🔨', idle: '•', traveling: '🚶', waiting: '⏳', resting: '💤', stuck: '⚠️' };
const STATE_GROUP = {
  working: 'working',
  moving: 'traveling',
  seeking: 'idle',
  idle: 'idle',
  waiting: 'waiting',
  need_materials: 'waiting',
  resting: 'resting',
  sleeping: 'resting',
  eating: 'resting',
  returning_home: 'traveling',
  unavailable: 'stuck',
  failed: 'stuck',
};

/** Which group a worker is in right now (stuck: something's wrong, or they were put right in the last hour). */
export function statusGroup(sim, c) {
  if (c.lastStuck && c.lastStuck.why !== 'invalid' && sim.time.total - (c.lastStuck.at ?? -1e9) < 60) return 'stuck';
  return STATE_GROUP[c.state] || 'idle';
}

/**
 * The icon over a worker's head — only when it tells you something:
 * 🔨 working · 📦 carrying · ⏳ waiting · ⚠️ stuck (put right a moment ago) · 💤 resting · 🏠 going home.
 */
export function workerIndicator(sim, npc) {
  const c = sim.workers.contract(npc.id);
  if (!c) return null;
  if (c.lastStuck && c.lastStuck.why !== 'invalid' && sim.time.total - (c.lastStuck.at ?? -1e9) < 60) return '⚠️';
  switch (c.state) {
    case 'working':
      return npc.carry || HAUL_PHASES.has(c.phase) ? '📦' : '🔨';
    case 'moving':
      return npc.carry ? '📦' : null;
    case 'waiting':
    case 'need_materials':
      return '⏳';
    case 'failed':
    case 'unavailable':
      return '⚠️';
    case 'resting':
    case 'sleeping':
      return '💤';
    case 'returning_home':
      return '🏠';
    default:
      return null;
  }
}

/** Where someone is, in words: the neighbourhood, or the district. */
export function placeText(sim, npc) {
  const tx = Math.floor(npc.x / TS);
  const ty = Math.floor(npc.y / TS);
  const hood = sim.places?.hoodAt(tx, ty);
  if (hood) return hoodLabel(sim, hood);
  const d = sim.places?.districtAt(tx, ty);
  if (d) return districtLabel(d);
  const inside = npc.inside && sim.world.buildings[npc.inside];
  return inside ? buildingLabel(sim, npc.inside) : t('wcard2.out_in_valley');
}

/**
 * How far along what they're doing is: the building going up, the contract, or the load they're carrying.
 * { label, pct, value? } or null.
 */
export function taskProgress(sim, npc) {
  const c = sim.workers.contract(npc.id);
  if (!c) return null;
  const C = sim.construction;
  const target = c.task?.target && C.byId(c.task.target);
  if (target && target.status === 'site') {
    const name = target.kind === 'works' ? buildingLabel(sim, target.target) : C.isPlayers(target) ? t(`buildable.${target.type}.name`) : t(`vbuilding.${target.type}`);
    return { label: t('ui.site_of', { name }), pct: Math.round((target.labor / Math.max(1, target.laborNeeded)) * 100) };
  }
  const job = sim.contracts.jobOf(npc.id);
  if (job) return { label: jobText(sim, npc.id), pct: Math.round(sim.contracts.progress(job) * 100) };
  if (npc.carry?.qty) {
    const most = sim.workers.carryCap(npc);
    return { label: t('wcard2.load'), pct: Math.round((npc.carry.qty / Math.max(1, most)) * 100), value: `${npc.carry.qty} / ${most}` };
  }
  return null;
}

function cmdButton(ico, label, cmd, data = {}, cls = 'sm') {
  const attrs = Object.entries(data)
    .map(([k, v]) => `data-${k}="${escapeHtml(v)}"`)
    .join(' ');
  return `<button class="btn ${cls}" data-cmd="${cmd}" ${attrs}><span class="b-ico">${ico}</span>${escapeHtml(label)}</button>`;
}

/** The card for one of your workers — or, for anyone else, a smaller one (who they are, what they're doing). */
export function workerCard(sim, npcId, { near = true, following = false } = {}) {
  const npc = sim.npcs.byId(npcId);
  if (!npc) return null;
  const W = sim.workers;
  const c = W.contract(npcId);
  const face = portrait(`npc_${sim.state.seed}_${npc.id}`, npc.look, 44);
  if (!c) return villagerCard(sim, npc, face, near);
  const prof = W.profile(npc);
  const best = prof.skills[0];
  const need = sim.npcs.xpForNext(npc.level);
  const xpPct = Math.min(100, ((npc.xp || 0) / Math.max(1, need)) * 100);
  const head = `<div class="bc-head">
      ${face}
      <div class="bc-id"><div class="bc-name">${escapeHtml(npcName(npc))}</div><div class="bc-type">${escapeHtml(t(`profession.${prof.profession}`))} · ${escapeHtml(t('ui.level_n', { level: npc.level }))}</div></div>
      ${stateBadge(c.state || 'idle')}
    </div>`;
  let body = progress(xpPct, { label: 'XP', value: `${Math.floor(npc.xp || 0)} / ${need}`, kind: 'gold' });
  if (best) body += `<div class="bc-line"><span>${escapeHtml(t('wcard2.best_at'))}</span><b>${escapeHtml(cap(t(`knowledge.${best.field}`)))} ${best.v}</b></div>`;
  // What they're doing right now, how far along, and where.
  body += `<div class="bc-sub">${escapeHtml(t('wcard2.now'))}</div><div class="bc-task">${escapeHtml(taskText(sim, npc))}</div>`;
  const tp = taskProgress(sim, npc);
  if (tp) body += progress(tp.pct, { label: tp.label, value: tp.value, kind: c.state === 'need_materials' || c.state === 'waiting' ? 'warn' : '' });
  body += `<div class="bc-line"><span>📍 ${escapeHtml(placeText(sim, npc))}</span></div>`;
  // Their equipment: what, how worn, how much it lets them carry.
  const eq = sim.equipment?.assignedTo(npc.id);
  const carry = W.carryCap(npc);
  body += `<div class="bc-sub">${escapeHtml(t('wcard.equipment'))}</div>`;
  if (eq) {
    const inHand = sim.equipment.using(npc);
    body += `<div class="bc-line"><span>${EQUIPMENT[eq.type].icon} <b>${escapeHtml(t(`equip.${eq.type}`))} ${escapeHtml(t('equip.lv', { n: eq.level || 1 }))}</b>${inHand ? '' : ` · ${escapeHtml(t(eq.recall ? 'equip.coming_back' : 'wcard.not_in_hand'))}`}</span><span>${escapeHtml(t('wcard2.carries', { n: carry }))}</span></div><div class="bc-cond">${condBar(eq.condition)}</div>`;
  } else body += `<div class="bc-line"><span>✋ ${escapeHtml(t('wcard.by_hand'))}</span><span>${escapeHtml(t('wcard2.carries', { n: carry }))}</span></div>`;
  // Who they work for, for how much, as what — and the contract they're on.
  const posted = npc.crew && npc.employer && sim.holdings?.isMine(npc.employer) ? sim.economy.biz(npc.employer) : null;
  const employer = posted ? buildingLabel(sim, posted.building) : t('bcard.owner_you');
  body += `<div class="bc-sub">${escapeHtml(t('wcard2.employment'))}</div>
    <div class="bc-line"><span>${escapeHtml(t('wcard2.works_for'))}</span><b>${escapeHtml(employer)}</b></div>
    <div class="bc-line"><span>${escapeHtml(t('wcard2.wage'))}</span><b class="money-text">${fmtMoney(c.salary)} / ${escapeHtml(t('wcard2.day'))}</b></div>
    <div class="bc-line"><span>${escapeHtml(t('workers.role'))}</span><b>${escapeHtml(t(`assignment.${c.assignment?.type || 'idle'}`))}</b></div>`;
  const job = sim.contracts.jobOf(npc.id);
  if (job) body += `<div class="bc-line"><span>${escapeHtml(t('wcard2.contract'))}</span><b>${escapeHtml(jobText(sim, npc.id))}</b></div>`;
  body += devInfo(sim, npc, c);
  const foot = [
    cmdButton(following ? '⏹' : '👁', t(following ? 'wcard2.stop_follow' : 'wcard2.follow'), following ? 'unfollow' : 'follow', { npc: npc.id }, 'sm primary'),
    cmdButton('👷', t('wcard2.manage'), 'manage_worker', { npc: npc.id }),
    cmdButton('🛒', t('wcard.equipment'), 'equipment', { npc: npc.id }),
    cmdButton('⚖️', t('wcard2.priorities'), 'priorities', { npc: npc.id }),
    job ? cmdButton('📜', t('wcard2.contract'), 'contract', { npc: npc.id }) : '',
    cmdButton('🎯', t('bcard.locate'), 'show_npc', { npc: npc.id }, 'sm ghost'),
  ].join('');
  return { head, body, foot };
}

/** For developers only (dev.cards = true): what the simulation thinks this worker is doing. */
function devInfo(sim, npc, c) {
  if (typeof window === 'undefined' || !window.dev?.cards) return '';
  const path = sim.npcs.paths?.get(npc.id);
  const eq = sim.equipment?.assignedTo(npc.id);
  const rows = [
    ['id', npc.id],
    ['state', `${c.state} (since ${c.stateSince ?? '?'})`],
    ['phase', c.phase || '—'],
    ['task', c.task ? `${c.task.kind} → ${c.task.target ?? '—'}${c.task.item ? ` (${c.task.item})` : ''}` : '—'],
    ['npc.task', npc.task ? `${npc.task.type}/${npc.task.stage || ''}` : '—'],
    ['path', path ? `${path.length ?? path.steps?.length ?? '?'} steps` : 'none'],
    ['equipment', eq ? `${eq.id} ${eq.type} ${Math.round(eq.condition)}% at ${eq.at.kind}` : '—'],
    ['stuck', c.lastStuck ? `${c.lastStuck.why} @${c.lastStuck.at}` : '—'],
  ];
  return `<div class="dev-info">${rows.map(([k, v]) => `<div><span>${k}</span><code>${escapeHtml(String(v))}</code></div>`).join('')}</div>`;
}

/** Anyone else: who they are, how you get on, what they're up to. */
function villagerCard(sim, npc, face, near) {
  const head = `<div class="bc-head">
      ${face}
      <div class="bc-id"><div class="bc-name">${escapeHtml(npcName(npc))}</div><div class="bc-type">${escapeHtml(npcRole(sim, npc) || occupationName(npc.occupation, npc.gender))} · ${escapeHtml(t('ui.age_n', { age: npc.age }))}</div></div>
      ${npc.met ? `<span class="small">${hearts(npc.rel || 0)}</span>` : status(t('wcard2.stranger'), 'neutral', '👋')}
    </div>`;
  let body = `<div class="bc-line"><span>📍 ${escapeHtml(placeText(sim, npc))}</span></div>`;
  const act = sim.npcs.activity(npc);
  if (act) body += `<div class="bc-task">▶ ${escapeHtml(tr(sim, `activity.${act.key}`, { gender: npc.gender, ...act.params }))}</div>`;
  if (!near) body += `<div class="hint bc-far">🚶 ${escapeHtml(t('wcard2.walk_up'))}</div>`;
  const foot = [near ? cmdButton('💬', t('action.talk'), 'talk', { npc: npc.id }, 'sm primary') : '', cmdButton('🔍', t('bcard.inspect'), 'inspect_npc', { npc: npc.id }), cmdButton('🎯', t('bcard.locate'), 'show_npc', { npc: npc.id }, 'sm ghost')].join('');
  return { head, body, foot };
}

/** The strip at the top of the screen while you follow someone: who, doing what, how far — and Stop. */
export function followStrip(sim, npcId) {
  const npc = sim.npcs.byId(npcId);
  if (!npc) return '';
  const c = sim.workers.contract(npcId);
  const tp = taskProgress(sim, npc);
  return `<span class="fs-eye">👁</span><span class="fs-name">${escapeHtml(npcName(npc))}</span>${c ? stateBadge(c.state || 'idle') : ''}<span class="fs-task">${escapeHtml(c ? taskText(sim, npc) : placeText(sim, npc))}</span>${tp ? `<span class="fs-pct">${tp.pct}%</span>` : ''}<button class="btn sm" data-stop-follow="1"><kbd>Esc</kbd>${escapeHtml(t('wcard2.stop_follow'))}</button>`;
}
