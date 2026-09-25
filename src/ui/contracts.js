/**
 * How contracts read on the notice board, in the Journal and in conversation: what's asked,
 * by whom, where; how far along it is and who's on it; and your workers to put on the job.
 */
import { t, fmtMoney, npcName, cap } from '../i18n/i18n.js';
import { tr, escapeHtml, dateString } from './format.js';
import { button, icon, bar, status } from './widgets.js';
import { QUALITY } from '../data/quality.js';
import { CONTRACT_FIELDS } from '../systems/ContractSystem.js';

/** Which card is open for managing workers or showing details, and the workers picked (UI only). */
const view = { manage: null, details: null, sel: new Set() };

const KIND_ICON = { harvest: '🌾', repair: '🛠️', build: '🔨', haul: '🛒', supply: '📦', craft: '🪚', order: '📜' };
const STATUS_LOOK = { accepted: ['info', '📋'], preparing: ['info', '🚶'], working: ['good', '🔨'], waiting: ['warn', '⏳'], completed: ['good', '✔'], failed: ['danger', '✖'], cancelled: ['neutral', '✖'] };

/** One sentence describing what's asked. */
export function contractText(sim, c) {
  const who = c.issuer === 'village' ? t('owner.village') : null;
  const params = { qty: c.qty, item: c.item, building: c.building, building2: c.from, hours: c.hours, npc: c.issuer !== 'village' ? c.issuer : undefined };
  if (c.minQ !== undefined) params.quality = QUALITY[c.minQ].id;
  if (c.kind === 'harvest') return tr(sim, 'contract.harvest', params);
  if (c.kind === 'repair') return tr(sim, c.issuer === 'village' ? 'contract.repair_village' : 'contract.repair', { ...params, n: Math.round(sim.property.rec(c.building)?.condition ?? 0) });
  if (c.kind === 'build') {
    const site = sim.construction.byId(c.siteId);
    params.vbuilding = site?.type || 'house';
    return tr(sim, c.issuer === 'village' ? 'contract.build_village' : 'contract.build', params);
  }
  if (c.kind === 'haul') return tr(sim, 'contract.haul', { ...params, building: c.from, building2: c.building });
  if (c.kind === 'order') return tr(sim, c.feast ? (c.issuer === 'village' ? 'contract.order_feast_village' : 'contract.order_feast') : 'contract.order', { ...params, building2: sim.economy.biz(c.supplierBiz)?.building });
  if (c.kind === 'craft') return tr(sim, c.bizId ? 'contract.craft_biz' : 'contract.craft', params);
  return tr(sim, 'contract.supply', params) + (who ? '' : '');
}

/** "Farmer Gregory · 📍 the farmhouse" — who asked, and where the work is. */
function clientLine(sim, c) {
  const K = sim.contracts;
  const who = c.issuer === 'village' ? t('owner.village') : npcName(sim.npcs.byId(c.issuer)) || '—';
  const where = K.location?.(c) || c.building;
  return `<div class="muted small">👤 ${escapeHtml(t('contract.client', { name: who }))}${where ? ` · 📍 ${escapeHtml(tr(sim, 'contract.at', { building: where }))}` : ''}</div>`;
}

/** Work done so far in words: "12 / 18 plants", "40 / 65 repair points"… */
function progressLabel(sim, c) {
  if (c.kind === 'build') return t('contract.hours_done', { n: c.done, of: c.hours });
  if (c.kind === 'harvest') return t('contract.plants_done', { n: Math.floor(c.done || 0), of: c.qty });
  if (c.kind === 'repair') return t('contract.points_done', { n: Math.floor(c.done || 0), of: c.qty });
  if (c.kind === 'haul') return t('contract.hauled', { n: c.delivered, got: c.collected, of: c.qty });
  return t('contract.delivered_n', { n: c.delivered, of: c.qty });
}

function workLabel(c) {
  return t(`contract.work.${c.kind}`, { n: c.kind === 'build' ? c.hours : c.qty });
}

export function contractCard(sim, c, mode) {
  const C = sim.contracts;
  const head = `<div class="job-top"><div class="job-name">${c.item && c.kind !== 'harvest' ? icon(c.item, 24) : KIND_ICON[c.kind] || '🔨'} ${escapeHtml(t(`contract.kind.${c.kind}`))}</div><div class="job-pay">💰 ${escapeHtml(fmtMoney(c.pay))}</div></div>`;
  const body = `<div class="job-desc">${escapeHtml(contractText(sim, c))}</div>${clientLine(sim, c)}`;
  const delegable = C.canDelegate?.(c);
  if (mode === 'offer') {
    const chk = C.canAccept(c.id);
    const facts = [t('contract.time_allowed', { n: c.days }), delegable ? t('contract.hands', { n: C.recommended(c) }) : null, t('contract.xp_reward', { n: C.playerXp(c) })].filter(Boolean).join(' · ');
    return `<div class="job-card">${head}${body}
      <div class="muted small">${escapeHtml(facts)}</div>
      <div class="btn-row">${button(t('contract.accept'), 'contract_accept', { id: c.id }, { cls: 'primary', disabled: !chk.ok })}${button(t('contract.decline'), 'contract_decline', { id: c.id })}</div>
      ${chk.ok ? '' : `<div class="warn small">${escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</div>`}</div>`;
  }
  const done = C.progress(c);
  const late = c.deadline - sim.time.day;
  const st = C.statusOf ? C.statusOf(c) : 'working';
  const [kind, ico] = STATUS_LOOK[st] || STATUS_LOOK.working;
  const crew = (c.workers || []).map((id) => npcName(sim.npcs.byId(id))).filter(Boolean);
  const tracked = sim.state.contracts.tracked === c.id;
  const crewLine = delegable
    ? `<div class="small">👷 ${escapeHtml(t('contract.workers_n', { n: crew.length, of: C.recommended(c) }))}${crew.length ? ` — ${escapeHtml(crew.join(', '))}` : ''}</div>`
    : '';
  const handover = c.kind === 'harvest' && (c.owed || 0) > 0 ? `<div class="warn small">${escapeHtml(tr(sim, 'contract.owed', { qty: c.owed, item: c.item, building: c.building }))}</div>` : '';
  let html = `<div class="job-card active">${head}${body}
    <div style="margin:4px 0">${status(t(`contract.status.${st}`), kind, ico)}</div>
    ${bar(done * 100, 'xp', progressLabel(sim, c))}
    ${crewLine}${handover}
    <div class="muted small ${late <= 1 ? 'warn' : ''}">${escapeHtml(t('contract.deadline', { date: dateString(c.deadline) }))}</div>
    <div class="btn-row">${c.kind === 'order' ? button(t('contract.ship', { n: Math.floor(sim.economy.stock(c.supplierBiz, c.item)) }), 'contract_ship', { id: c.id }, { cls: 'primary', disabled: sim.economy.stock(c.supplierBiz, c.item) < 1 }) : ''}${delegable ? button(t('contract.manage_workers'), 'contract_manage', { id: c.id }, { cls: view.manage === c.id ? 'selected sm' : 'sm' }) : ''}${C.objective ? button(t(tracked ? 'contract.tracking' : 'contract.go_to'), 'contract_track', { id: c.id }, { cls: tracked ? 'selected sm' : 'sm' }) : ''}${button(t('contract.details'), 'contract_details', { id: c.id }, { cls: view.details === c.id ? 'selected sm ghost' : 'sm ghost' })}${button(t('contract.abandon'), 'contract_abandon', { id: c.id }, { cls: 'sm ghost' })}</div>`;
  if (view.details === c.id) html += detailsHtml(sim, c);
  if (view.manage === c.id && delegable) html += crewPicker(sim, c);
  return html + '</div>';
}

/** The job in full: the work, the hands it wants, the rewards, who's done what so far. */
function detailsHtml(sim, c) {
  const C = sim.contracts;
  const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`;
  const rows = [
    kv(t('contract.d.work'), workLabel(c)),
    C.canDelegate(c) ? kv(t('contract.d.hands'), String(C.recommended(c))) : '',
    kv(t('contract.d.pay'), fmtMoney(c.pay)),
    kv(t('contract.d.deadline'), dateString(c.deadline)),
    kv(t('contract.d.xp'), t('contract.xp_n', { n: C.playerXp(c) })),
    C.canDelegate(c) ? kv(t('contract.d.wxp'), t('contract.xp_n', { n: C.workerXp(c) })) : '',
  ];
  const crew = Object.entries(c.crew || {}).map(([who, w]) => `${who === 'player' ? t('contract.you') : npcName(sim.npcs.byId(who)) || '—'}: ${Math.round(w * 10) / 10}`);
  if (crew.length) rows.push(kv(t('contract.d.done_by'), crew.join(' · ')));
  return `<div class="card" style="margin-top:6px">${rows.join('')}</div>`;
}

/** Your workers, to put on the job or take off it: what they're good at for this work, what they're doing now. */
export function crewPicker(sim, c) {
  const W = sim.workers;
  const field = CONTRACT_FIELDS[c.kind];
  const list = W.list();
  if (!list.length) return `<div class="card" style="margin-top:6px"><div class="muted small">${escapeHtml(t('contract.no_workers'))}</div></div>`;
  const rows = list
    .map((wc) => {
      const npc = sim.npcs.byId(wc.npcId);
      if (!npc) return '';
      const on = view.sel.has(npc.id);
      const skill = Math.round(sim.education?.competence(npc, field) || 0);
      const other = sim.contracts.jobOf(npc.id);
      const now = other && other.id !== c.id ? t('contract.on_other') : t(`wstate.${wc.state || 'idle'}`);
      return `<div class="setting-row"><div><b>${escapeHtml(npcName(npc))}</b> <span class="muted small">${escapeHtml(cap(t(`knowledge.${field}`)))} ${skill} · ${escapeHtml(now)}</span></div>
        ${button(on ? '☑' : '☐', 'crew_toggle', { id: c.id, npc: npc.id }, { cls: on ? 'selected sm' : 'sm ghost' })}</div>`;
    })
    .join('');
  return `<div class="card" style="margin-top:6px"><div class="stat-label">${escapeHtml(t('contract.available_workers', { n: sim.contracts.recommended(c) }))}</div>${rows}
    <div class="btn-row">${button(t('contract.assign_n', { n: view.sel.size }), 'crew_assign', { id: c.id }, { cls: 'primary sm' })}</div></div>`;
}

/** The last few contracts settled: who paid what, and the experience it brought. */
function recentHtml(sim) {
  const log = sim.state.contracts.log.filter((x) => x.how === 'done' || x.how === 'short').slice(-3).reverse();
  if (!log.length) return '';
  return `<h3>${escapeHtml(t('contract.recent'))}</h3>` + log.map((x) => {
    const crew = Object.entries(x.crew || {}).map(([id, xp]) => `${npcName(sim.npcs.byId(id)) || '—'} +${xp}`).join(', ');
    return `<div class="rumor">✔ ${escapeHtml(t(`contract.kind.${x.kind}`))}${x.issuer && x.issuer !== 'village' && sim.npcs.byId(x.issuer) ? ` · ${escapeHtml(npcName(sim.npcs.byId(x.issuer)))}` : ''} — ${escapeHtml(fmtMoney(x.paid))}${x.xp ? ` · ${escapeHtml(t('contract.xp_n', { n: x.xp }))}` : ''}${crew ? ` · 👷 ${escapeHtml(crew)} XP` : ''}</div>`;
  }).join('');
}

/** Your standing as a contractor: jobs done, how many at once, what's next. */
function rankHtml(sim) {
  const K = sim.contracts;
  if (!K.rank) return '';
  const r = K.rank();
  const next = K.nextRank();
  return `<div class="card"><b>${escapeHtml(t(`contractor_rank.${r.id}`))}</b> <span class="muted small">${escapeHtml(t('contract.rank_line', { done: sim.state.contracts.done, n: r.maxActive }))}${next ? ` · ${escapeHtml(t('contract.rank_next', { rank: t(`contractor_rank.${next.id}`), n: next.done }))}` : ''}</span></div>`;
}

export function contractsTab(sim) {
  const S = sim.state.contracts;
  let html = `<div class="muted small">${escapeHtml(t('contract.hint'))}</div>${rankHtml(sim)}`;
  if (S.active.length) html += `<h3>${escapeHtml(t('contract.yours'))}</h3>` + S.active.map((c) => contractCard(sim, c, 'active')).join('');
  html += `<h3>${escapeHtml(t('contract.offered'))}</h3>`;
  html += S.offers.map((c) => contractCard(sim, c, 'offer')).join('') || `<div class="muted">${escapeHtml(t('contract.none'))}</div>`;
  html += recentHtml(sim);
  html += `<div class="muted small">${escapeHtml(t('contract.record', { done: S.done, failed: S.failed }))}</div>`;
  return html;
}

/** Open the worker picker for a contract (with the workers already on it ticked). */
export function openCrew(sim, id) {
  const c = sim.state.contracts.active.find((x) => x.id === id);
  view.manage = id;
  view.sel = new Set(c?.workers || []);
}

/** Handle contract buttons (shared by panels). Returns true if handled. */
export function contractAction(sim, action, data) {
  const id = Number(data.id);
  if (action === 'contract_accept') {
    const r = sim.contracts.accept(id);
    if (!r.ok) sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    return true;
  }
  if (action === 'contract_decline') return sim.contracts.decline(id), true;
  if (action === 'contract_abandon') return sim.contracts.abandon(id), true;
  if (action === 'contract_ship') return sim.contracts.fulfilOrder(id), true;
  if (action === 'contract_track') return sim.contracts.track(id), true;
  if (action === 'contract_details') {
    view.details = view.details === id ? null : id;
    return true;
  }
  if (action === 'contract_manage') {
    if (view.manage === id) view.manage = null;
    else openCrew(sim, id);
    return true;
  }
  if (action === 'crew_toggle') {
    if (view.sel.has(data.npc)) view.sel.delete(data.npc);
    else view.sel.add(data.npc);
    return true;
  }
  if (action === 'crew_assign') {
    const r = sim.contracts.assign(id, [...view.sel]);
    if (r.ok) sim.toast(r.n ? 'toast.crew_assigned' : 'toast.crew_cleared', { n: r.n }, 'info');
    view.manage = null;
    return true;
  }
  return false;
}
