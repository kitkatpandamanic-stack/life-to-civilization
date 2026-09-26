/**
 * How contracts read on the notice board, in the Journal and in conversation: what's asked,
 * by whom, where; how pressing, how big, what it takes and what you'd make; how far along it
 * is, who's on it and what it's cost so far; your workers to put on the job (the best suited
 * first); your name as a contractor, your history, your firm.
 */
import { t, fmtMoney, npcName, cap } from '../i18n/i18n.js';
import { tr, escapeHtml, dateString, buildingLabel } from './format.js';
import { button, icon, bar, status, progress } from './widgets.js';
import { STATE_LOOK } from './transport.js';
import { QUALITY } from '../data/quality.js';
import { CONTRACT_FIELDS } from '../systems/ContractSystem.js';
import { COMPANY } from '../data/contracting.js';

/** Which card is open for managing workers or showing details, the workers picked, the history shown (UI only). */
const view = { manage: null, details: null, sel: new Set(), history: false };

const KIND_ICON = { harvest: '🌾', water: '💧', repair: '🛠️', build: '🔨', haul: '🛒', supply: '📦', craft: '🪚', order: '📜', job: '📋' };
const STATUS_LOOK = { accepted: ['info', '📋'], preparing: ['info', '🚶'], working: ['good', '🔨'], waiting: ['warn', '⏳'], late: ['danger', '⏰'], completed: ['good', '✔'], failed: ['danger', '✖'], cancelled: ['neutral', '✖'] };
const SIZE_ICON = { small: '•', medium: '••', large: '•••', major: '★' };
const GRADE_LOOK = { excellent: 'good', good: 'good', fair: 'info', poor: 'warn' };

/** One sentence describing what's asked. */
export function contractText(sim, c) {
  const who = c.issuer === 'village' ? t('owner.village') : null;
  const params = { qty: c.qty, item: c.item, building: c.building, building2: c.from, hours: c.hours, npc: c.issuer !== 'village' ? c.issuer : undefined };
  if (c.minQ !== undefined) params.quality = QUALITY[c.minQ].id;
  if (c.kind === 'job') return `${t(`job.${c.jobId}.name`)} — ${tr(sim, 'contract.job', { ...params, building: c.building })}`;
  if (c.kind === 'harvest') return tr(sim, 'contract.harvest', params);
  if (c.kind === 'water') return tr(sim, 'contract.water', params);
  if (c.kind === 'repair') return tr(sim, c.issuer === 'village' ? 'contract.repair_village' : 'contract.repair', { ...params, n: Math.round(sim.property.rec(c.building)?.condition ?? 0) });
  if (c.kind === 'build') {
    if (c.proposal?.what === 'new') return tr(sim, 'contract.build_new', { ...params, vbuilding: c.proposal.type });
    if (c.proposal?.what === 'works' || c.siteKind === 'works') return tr(sim, 'contract.build_works', { ...params, building: c.building });
    const site = sim.construction.byId(c.siteId);
    params.vbuilding = site?.type || 'house';
    return tr(sim, c.issuer === 'village' ? 'contract.build_village' : 'contract.build', params);
  }
  if (c.kind === 'haul') return tr(sim, 'contract.haul', { ...params, building: c.from, building2: c.building });
  if (c.kind === 'order') return tr(sim, c.feast ? (c.issuer === 'village' ? 'contract.order_feast_village' : 'contract.order_feast') : 'contract.order', { ...params, building2: sim.economy.biz(c.supplierBiz)?.building });
  if (c.kind === 'craft') return tr(sim, c.bizId ? 'contract.craft_biz' : 'contract.craft', params);
  if (c.kind === 'supply' && c.gather) return tr(sim, 'contract.gather', params);
  return tr(sim, 'contract.supply', params) + (who ? '' : '');
}

/** "Farmer Gregory · 📍 the farmhouse" — who asked, and where the work is (and how often you've worked for them). */
function clientLine(sim, c) {
  const K = sim.contracts;
  const who = c.issuer === 'village' ? t('owner.village') : npcName(sim.npcs.byId(c.issuer)) || '—';
  const where = K.location?.(c) || c.building;
  const k = c.issuer && c.issuer !== 'village' ? sim.state.contracts.clients?.[c.issuer] : null;
  const regular = k?.done ? ` · 🤝 ${escapeHtml(t('contract.regular', { n: k.done }))}` : '';
  return `<div class="muted small">👤 ${escapeHtml(t('contract.client', { name: who }))}${where ? ` · 📍 ${escapeHtml(tr(sim, 'contract.at', { building: where }))}` : ''}${regular}</div>`;
}

/** Size, how pressing, what kind of work: small chips. */
function chips(sim, c) {
  const K = sim.contracts;
  const out = [];
  if (c.size) out.push(`<span class="chip">${SIZE_ICON[c.size] || ''} ${escapeHtml(t(`contract.size.${c.size}`))}</span>`);
  if (c.category) out.push(`<span class="chip">${escapeHtml(t(`contract.cat.${c.category}`))}</span>`);
  if (K.isUrgent?.(c)) out.push(`<span class="chip warn">⚡ ${escapeHtml(t('contract.urgent'))}</span>`);
  if (c.proposal) out.push(`<span class="chip">🤝 ${escapeHtml(t('contract.from_regular'))}</span>`);
  return out.length ? `<div class="chips">${out.join('')}</div>` : '';
}

/** Work done so far in words: "12 / 18 plants", "40 / 65 repair points"… */
function progressLabel(sim, c) {
  if (c.kind === 'build' && c.proposal) return t('contract.built_pct', { n: Math.round(sim.contracts.progress(c) * 100) });
  if (c.kind === 'build' || (c.kind === 'job' && c.type === 'shift')) return t('contract.hours_done', { n: c.done, of: c.hours });
  if (c.kind === 'job' && (c.type === 'courier' || c.type === 'rounds')) return t('contract.posted_n', { n: Math.floor(c.done || 0), of: c.qty });
  if (c.kind === 'job') return t('contract.delivered_n', { n: Math.floor(c.done || 0), of: c.qty });
  if (c.kind === 'harvest') return t('contract.plants_done', { n: Math.floor(c.done || 0), of: c.qty });
  if (c.kind === 'water') return t('contract.watered_n', { n: Math.floor(c.done || 0), of: c.qty });
  if (c.kind === 'repair') return t('contract.points_done', { n: Math.floor(c.done || 0), of: c.qty });
  if (c.kind === 'haul') return t('contract.hauled', { n: c.delivered, got: c.collected, of: c.qty });
  return t('contract.delivered_n', { n: c.delivered, of: c.qty });
}

function workLabel(c) {
  if (c.kind === 'job') return c.type === 'shift' ? t('contract.work.build', { n: c.hours }) : t('contract.work.goods', { n: c.qty });
  if (['supply', 'craft', 'order'].includes(c.kind)) return t('contract.work.goods', { n: c.qty });
  if (c.kind === 'water') return t('contract.work.water', { n: c.qty });
  return t(`contract.work.${c.kind}`, { n: c.kind === 'build' ? c.hours : c.qty });
}

/** What it asks of you: the skilled hand (and whether you have one), the materials. */
function reqLine(sim, c) {
  const K = sim.contracts;
  if (!K.requirements) return '';
  const r = K.requirements(c);
  const out = [];
  if (r.level) {
    const ok = K.meets(c);
    out.push(`${ok ? '✔' : r.required ? '✖' : '•'} ${t(r.required ? 'contract.req_required' : 'contract.req_recommended', { field: t(`knowledge.${r.field}`), n: r.level })}`);
  }
  const mats = r.materials || (c.proposal ? c.proposal.materials : null);
  if (mats && Object.keys(mats).length) out.push(`🧱 ${Object.entries(mats).map(([i, q]) => `${tr(sim, 'contract.mat', { item: i })} ${q}`).join(', ')}`);
  return out.length ? `<div class="small">${escapeHtml(out.join(' · '))}</div>` : '';
}

/** Where the work is: { label, x, y } (the building, or the site going up). */
export function contractPlace(sim, c) {
  const C = sim.contracts;
  const site = c.siteId && sim.construction.byId(c.siteId);
  if (site) return { label: site.kind === 'works' ? buildingLabel(sim, site.target) : t(`vbuilding.${site.type}`), x: (site.tx + site.w / 2) * 32, y: (site.ty + site.h) * 32 };
  const id = C.location?.(c) || c.building;
  const b = id && sim.world.buildings[id];
  return b ? { label: buildingLabel(sim, id), x: b.door.tx * 32 + 16, y: b.door.ty * 32 } : null;
}

/** The money side, at a glance: the reward, what the workers (and materials) should cost, what's left. */
function moneyGrid(sim, c) {
  const K = sim.contracts;
  if (!K.estimate) return '';
  const e = K.estimate(c);
  if (e.noSource) return `<div class="warn small">⚠️ ${escapeHtml(tr(sim, 'contract.need_goods', { item: c.item }))}</div>`;
  const cost = Math.round(e.wages + e.materials + e.spent);
  return `<div class="money-grid">
    <div><span>${escapeHtml(t('contract.m_reward'))}</span><b class="money-text">${fmtMoney(c.pay)}</b></div>
    <div><span>${escapeHtml(t('contract.m_cost'))}</span><b>≈ ${fmtMoney(cost)}</b></div>
    <div><span>${escapeHtml(t('contract.m_profit'))}</span><b class="${e.profit >= 0 ? 'good' : 'neg'}">≈ ${fmtMoney(e.profit)}</b></div>
  </div>`;
}

/** What you'd make: pay, what materials and wages should cost, the difference (an estimate). */
function profitLine(sim, c, hands = null) {
  const K = sim.contracts;
  if (!K.estimate) return '';
  const e = K.estimate(c, hands);
  if (e.noSource) return `<div class="warn small">⚠️ ${escapeHtml(tr(sim, 'contract.need_goods', { item: c.item }))}</div>`;
  return `<div class="small">${escapeHtml(t('contract.estimate', { days: e.days < 1 ? '<1' : Math.ceil(e.days), n: e.hands }))} · ${escapeHtml(t('contract.costs', { money: fmtMoney(e.wages + e.materials + e.spent) }))} · <b class="${e.profit >= 0 ? '' : 'warn'}">${escapeHtml(t('contract.profit', { money: fmtMoney(e.profit) }))}</b></div>`;
}

export function contractCard(sim, c, mode) {
  const C = sim.contracts;
  C.assess?.(c);
  const head = `<div class="job-top"><div class="job-name">${c.item && c.kind !== 'harvest' && c.kind !== 'build' ? icon(c.item, 24) : KIND_ICON[c.kind] || '🔨'} ${escapeHtml(t(`contract.kind.${c.kind}`))}</div><div class="job-pay">💰 ${escapeHtml(fmtMoney(c.pay))}</div></div>`;
  const body = `<div class="job-desc">${escapeHtml(contractText(sim, c))}</div>${clientLine(sim, c)}${chips(sim, c)}`;
  const delegable = C.canDelegate?.(c);
  if (mode === 'offer') {
    const chk = C.canAccept(c.id);
    const facts = [t('contract.time_allowed', { n: c.days }), delegable ? t('contract.hands', { n: C.recommended(c) }) : null, t('contract.xp_reward', { n: C.playerXp(c) })].filter(Boolean).join(' · ');
    // Taking it on: for a building, who brings the materials — they do, you do with their money, or you do on your own account.
    const accept = c.proposal
      ? ['client', 'included', 'player'].map((m) => button(t(`contract.accept_${m}`, { money: fmtMoney(m === 'player' ? Math.round(c.proposal.value * 1.25) : c.proposal.value) }), 'contract_accept', { id: c.id, materials: m }, { cls: m === 'client' ? 'primary sm' : 'sm', disabled: !chk.ok })).join('')
      : button(t('contract.accept'), 'contract_accept', { id: c.id }, { cls: 'primary', disabled: !chk.ok });
    const haggle = C.canNegotiate ? `${C.canNegotiate(c, 'pay') ? button(t('contract.ask_pay', { money: fmtMoney(Math.round(c.pay * 1.2)) }), 'contract_negotiate', { id: c.id, what: 'pay' }, { cls: 'sm ghost' }) : ''}${C.canNegotiate(c, 'time') ? button(t('contract.ask_time'), 'contract_negotiate', { id: c.id, what: 'time' }, { cls: 'sm ghost' }) : ''}` : '';
    return `<div class="job-card">${head}${body}
      <div class="muted small">${escapeHtml(facts)}</div>
      ${reqLine(sim, c)}${delegable ? profitLine(sim, c) : ''}
      <div class="btn-row">${accept}${haggle}${button(t('contract.decline'), 'contract_decline', { id: c.id }, { cls: 'sm ghost' })}</div>
      ${chk.ok ? '' : `<div class="warn small">${escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</div>`}</div>`;
  }
  const done = C.progress(c);
  const late = c.deadline - sim.time.day;
  const st = C.statusOf ? C.statusOf(c) : 'working';
  const [kind, ico] = STATUS_LOOK[st] || STATUS_LOOK.working;
  const crew = (c.workers || []).map((id) => npcName(sim.npcs.byId(id))).filter(Boolean);
  const tracked = sim.state.contracts.tracked === c.id;
  // Who chose the crew: you (your manager leaves it be) or your manager.
  const M = sim.workers.mgr?.();
  const who = !delegable ? '' : c.manual && M ? ` · 👤 ${escapeHtml(t('contract.crew_by_you'))}` : M && !c.manual ? ` · 🧑‍💼 ${escapeHtml(t('contract.crew_by_manager', { name: npcName(sim.npcs.byId(M.npc)) }))}` : '';
  // The crew, each with what they're doing right now (click a name: follow them).
  const crewChips = (c.workers || [])
    .map((id) => sim.npcs.byId(id))
    .filter(Boolean)
    .map((n) => `<button class="crew-chip" data-action="contract_follow" data-npc="${n.id}" data-id="${c.id}" title="${escapeHtml(t('wcard2.follow'))}">${STATE_LOOK[sim.workers.contract(n.id)?.state || 'idle']?.[1] || '•'} ${escapeHtml(npcName(n))}</button>`)
    .join('');
  const crewLine = delegable
    ? `<div class="small">👷 ${escapeHtml(t('contract.workers_n', { n: crew.length, of: C.recommended(c) }))}${who}${c.manual && M ? ` ${button(t('contract.let_manager'), 'contract_automate', { id: c.id }, { cls: 'sm ghost' })}` : ''}</div>${crewChips ? `<div class="crew-chips">${crewChips}</div>` : ''}`
    : '';
  const place = contractPlace(sim, c);
  const left = c.deadline - sim.time.day;
  const handover = c.kind === 'harvest' && (c.owed || 0) > 0 ? `<div class="warn small">${escapeHtml(tr(sim, 'contract.owed', { qty: c.owed, item: c.item, building: c.building }))}</div>` : '';
  const stuck = C.blocker?.(c);
  const blocked = stuck ? `<div class="warn small">⚠️ ${escapeHtml(tr(sim, stuck.key, stuck.params))}</div>` : c.kind === 'job' && !(c.workers || []).length ? `<div class="warn small">${escapeHtml(t('contract.job_needs_workers'))}</div>` : '';
  const risk = C.atRisk?.(c) ? `<div class="warn small">⏰ ${escapeHtml(t('contract.at_risk'))}</div>` : '';
  let html = `<div class="job-card active">${head}${body}
    <div class="contract-meta">${status(t(`contract.status.${st}`), kind, ico)}<span class="muted small">#${c.id}</span>${place ? `<span class="small">📍 ${escapeHtml(place.label)}</span>` : ''}<span class="small ${left <= 1 ? 'warn' : ''}">⏳ ${escapeHtml(left > 0 ? t('contract.days_left', { n: left }) : t('contract.due_today'))}</span></div>
    ${progress(done * 100, { label: progressLabel(sim, c), kind: 'gold' })}
    ${crewLine}${handover}${blocked}${risk}
    ${delegable ? moneyGrid(sim, c) : ''}
    <div class="muted small ${late <= 1 ? 'warn' : ''}">${escapeHtml(t('contract.deadline', { date: dateString(c.deadline) }))} · ${escapeHtml(t('contract.xp_line', { p: C.playerXp(c), w: delegable ? C.workerXp(c) : 0 }))}</div>
    <div class="btn-row">${c.kind === 'order' ? button(t('contract.ship', { n: Math.floor(sim.economy.stock(c.supplierBiz, c.item)) }), 'contract_ship', { id: c.id }, { cls: 'primary', disabled: sim.economy.stock(c.supplierBiz, c.item) < 1 }) : ''}${delegable ? button(t('contract.manage_workers'), 'contract_manage', { id: c.id }, { cls: view.manage === c.id ? 'selected sm' : 'sm' }) : ''}${C.objective ? button(t(tracked ? 'contract.tracking' : 'contract.go_to'), 'contract_track', { id: c.id }, { cls: tracked ? 'selected sm' : 'sm' }) : ''}${place ? button(t('contract.view_place'), 'contract_locate', { id: c.id }, { cls: 'sm ghost', ico: '🎯' }) : ''}${(c.workers || []).length ? button(t('contract.follow_worker'), 'contract_follow', { id: c.id, npc: c.workers[0] }, { cls: 'sm ghost', ico: '👁' }) : ''}${button(t('contract.details'), 'contract_details', { id: c.id }, { cls: view.details === c.id ? 'selected sm ghost' : 'sm ghost' })}${button(t('contract.abandon'), 'contract_abandon', { id: c.id }, { cls: 'sm ghost' })}</div>`;
  if (view.details === c.id) html += detailsHtml(sim, c);
  // For developers only (dev.cards = true): the contract as the simulation holds it.
  if (typeof window !== 'undefined' && window.dev?.cards) html += `<div class="dev-info"><div><span>id</span><code>${c.id} ${escapeHtml(c.kind)} ${escapeHtml(st)}</code></div><div><span>workers</span><code>${escapeHtml((c.workers || []).join(',') || '—')}</code></div><div><span>progress</span><code>${Math.round(done * 1000) / 10}% · deadline day ${c.deadline} (today ${sim.time.day})</code></div></div>`;
  if (view.manage === c.id && delegable) html += crewPicker(sim, c);
  return html + '</div>';
}

/** The job in full: the work, the hands it wants, the rewards, what it's cost, who's done what so far. */
function detailsHtml(sim, c) {
  const C = sim.contracts;
  const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`;
  const rows = [
    kv(t('contract.d.work'), workLabel(c)),
    C.canDelegate(c) ? kv(t('contract.d.hands'), String(C.recommended(c))) : '',
    kv(t('contract.d.pay'), fmtMoney(c.pay) + (c.advance ? ` (${t('contract.advance', { money: fmtMoney(c.advance) })})` : '')),
    kv(t('contract.d.deadline'), dateString(c.deadline)),
    kv(t('contract.d.xp'), t('contract.xp_n', { n: C.playerXp(c) })),
    C.canDelegate(c) ? kv(t('contract.d.wxp'), t('contract.xp_n', { n: C.workerXp(c) })) : '',
    c.costs ? kv(t('contract.d.spent'), t('contract.spent', { money: fmtMoney(Math.round(c.costs.materials)), money2: fmtMoney(Math.round(c.costs.wages)) }) + (c.costs.equipment ? ` · ${t('contract.spent_eq', { money: fmtMoney(Math.ceil(c.costs.equipment)) })}` : '')) : '',
    c.materialsMode ? kv(t('contract.d.materials'), t(`contract.mode.${c.materialsMode}`)) : '',
  ];
  const crew = Object.entries(c.crew || {}).map(([who, w]) => `${who === 'player' ? t('contract.you') : npcName(sim.npcs.byId(who)) || '—'}: ${Math.round(w * 10) / 10}`);
  if (!['harvest', 'repair', 'build', 'haul', 'water'].includes(c.kind)) rows.push(`<div class="hint">${escapeHtml(t(`contract.how.${c.kind === 'job' ? c.type : c.kind}`))}</div>`);
  if (crew.length) rows.push(kv(t('contract.d.done_by'), crew.join(' · ')));
  return `<div class="card" style="margin-top:6px">${rows.join('')}</div>`;
}

/**
 * Your workers, to put on the job or take off it — the best suited for this work first: their
 * level at it (0–10), their role, what they're doing now.
 */
export function crewPicker(sim, c) {
  const W = sim.workers;
  const K = sim.contracts;
  const field = K.fieldOf?.(c) || CONTRACT_FIELDS[c.kind] || 'trade';
  const list = W.list();
  if (!list.length) return `<div class="card" style="margin-top:6px"><div class="muted small">${escapeHtml(t('contract.no_workers'))}</div></div>`;
  const req = K.requirements?.(c);
  const rows = list
    .map((wc) => ({ wc, npc: sim.npcs.byId(wc.npcId), lvl: K.workerLevel?.(wc.npcId, field) ?? 0 }))
    .filter((x) => x.npc)
    .sort((a, b) => b.lvl - a.lvl)
    .map(({ wc, npc, lvl }, i) => {
      const on = view.sel.has(npc.id);
      const other = K.jobOf(npc.id);
      const now = other && other.id !== c.id ? t('contract.on_other') : t(`wstate.${wc.state || 'idle'}`);
      const good = req?.level && lvl >= req.level;
      return `<div class="setting-row"><div><b>${escapeHtml(npcName(npc))}</b> <span class="muted small">${escapeHtml(cap(t(`knowledge.${field}`)))} ${lvl}${good ? ' ✔' : ''} · ${escapeHtml(t(`assignment.${wc.assignment?.type || 'idle'}`))} · ${escapeHtml(now)}${i === 0 && list.length > 1 && lvl > 0 ? ` · ⭐ ${escapeHtml(t('contract.best_suited'))}` : ''}</span></div>
        ${button(on ? '☑' : '☐', 'crew_toggle', { id: c.id, npc: npc.id }, { cls: on ? 'selected sm' : 'sm ghost' })}</div>`;
    })
    .join('');
  const est = view.sel.size ? profitLine(sim, c, view.sel.size) : '';
  return `<div class="card" style="margin-top:6px"><div class="stat-label">${escapeHtml(t('contract.available_workers', { n: K.recommended(c) }))}</div>${rows}${est}
    <div class="btn-row">${button(t('contract.assign_n', { n: view.sel.size }), 'crew_assign', { id: c.id }, { cls: 'primary sm' })}</div></div>`;
}

/** Every contract you've had: who for, what, how it ended, the pay, the grade (the latest first). */
function historyHtml(sim) {
  const log = sim.contracts.history ? sim.contracts.history() : [];
  if (!log.length) return '';
  const rows = (view.history ? log : log.slice(0, 3)).map((x) => {
    const who = x.issuer && x.issuer !== 'village' && sim.npcs.byId(x.issuer) ? npcName(sim.npcs.byId(x.issuer)) : x.issuer === 'village' ? t('owner.village') : '—';
    const how = t(`contract.how_ended.${x.how}`);
    const grade = x.grade ? ` · ${status(t(`contract.grade.${x.grade}`), GRADE_LOOK[x.grade] || 'info')}` : '';
    const late = x.late ? ` · ⏰ ${escapeHtml(t('contract.was_late'))}` : '';
    const crew = Object.entries(x.crew || {}).map(([id, xp]) => `${npcName(sim.npcs.byId(id)) || '—'} +${xp}`).join(', ');
    const profit = x.cost ? ` · ${escapeHtml(t('contract.profit', { money: fmtMoney(Math.round((x.paid || 0) - x.cost)) }))}` : '';
    return `<div class="rumor">${x.how === 'done' || x.how === 'short' ? '✔' : '✖'} <b>${escapeHtml(who)}</b> — ${escapeHtml(x.jobId ? t(`job.${x.jobId}.name`) : t(`contract.kind.${x.kind}`))} · ${escapeHtml(how)} · ${escapeHtml(fmtMoney(x.paid || 0))}${grade}${late}${profit}${x.xp ? ` · ${escapeHtml(t('contract.xp_n', { n: x.xp }))}` : ''}${crew ? ` · 👷 ${escapeHtml(crew)}` : ''}</div>`;
  }).join('');
  return `<h3>${escapeHtml(t('contract.history'))}</h3>${rows}${log.length > 3 ? `<div class="btn-row">${button(t(view.history ? 'contract.history_less' : 'contract.history_all', { n: log.length }), 'contract_history', {}, { cls: 'sm ghost' })}</div>` : ''}`;
}

/** Your name and standing as a contractor, where you are on the way to a firm — and the firm. */
function standingHtml(sim) {
  const K = sim.contracts;
  if (!K.rank) return '';
  const S = sim.state.contracts;
  const r = K.rank();
  const next = K.nextRank();
  const rep = Math.round(K.rep());
  const stage = K.stage();
  let html = `<div class="card"><div class="card-head"><div><div class="card-title">${escapeHtml(t(`contract.stage.${stage}`))} · ${escapeHtml(t(`contractor_rank.${r.id}`))}</div>
    <div class="card-sub">${escapeHtml(t('contract.rank_line', { done: S.done, n: K.maxActive() }))}${next ? ` · ${escapeHtml(t('contract.rank_next2', { rank: t(`contractor_rank.${next.id}`), n: next.done, rep: next.rep }))}` : ''}</div></div></div>
    <div class="aff-row"><span>${escapeHtml(t('contract.reputation'))}</span>${bar(rep, rep >= 60 ? 'good' : rep < 35 ? 'warn' : 'xp')}<b>${rep}</b></div>`;
  if (S.company) {
    const b = K.books();
    html += `<div class="small">🏢 <b>${escapeHtml(S.company.name || t('contract.company_name', { name: sim.state.player.name }))}</b> · ${escapeHtml(t('contract.books', { money: fmtMoney(b.revenue), money2: fmtMoney(b.costs), n: b.jobs }))} · <b>${escapeHtml(t('contract.profit', { money: fmtMoney(b.profit) }))}</b></div>`;
  } else {
    const chk = K.canFound();
    html += `<div class="btn-row">${button(t('contract.found', { money: fmtMoney(COMPANY.fee) }), 'company_found', {}, { cls: chk.ok ? 'primary sm' : 'sm', disabled: !chk.ok, title: chk.ok ? t('contract.found_tip') : tr(sim, `reason.${chk.reason}`, chk.params || {}) })}${chk.ok ? '' : `<span class="hint">${escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</span>`}</div>`;
  }
  // Several jobs at once: who's where, and who's free.
  const ov = K.overview();
  if (ov.active.length > 1 || (ov.active.length && ov.free.length)) {
    html += `<div class="small muted">${escapeHtml(t('contract.overview', { n: ov.active.length, free: ov.free.length }))}</div>`;
  }
  return html + '</div>';
}

export function contractsTab(sim) {
  const S = sim.state.contracts;
  let html = `<div class="muted small">${escapeHtml(t('contract.hint'))}</div>${standingHtml(sim)}`;
  if (S.active.length) html += `<h3>${escapeHtml(t('contract.yours'))}</h3>` + S.active.map((c) => contractCard(sim, c, 'active')).join('');
  html += `<h3>${escapeHtml(t('contract.offered'))}</h3>`;
  html += S.offers.map((c) => contractCard(sim, c, 'offer')).join('') || `<div class="muted">${escapeHtml(t('contract.none'))}</div>`;
  html += historyHtml(sim);
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
    const r = sim.contracts.accept(id, { materials: data.materials });
    if (!r.ok) sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    return true;
  }
  if (action === 'contract_negotiate') {
    const o = sim.contracts.get(id);
    const r = sim.contracts.negotiate(id, data.what);
    const who = o?.issuer !== 'village' ? o?.issuer : undefined;
    if (r.ok) sim.toast(data.what === 'pay' ? 'toast.haggle_pay_yes' : 'toast.haggle_time_yes', { npc: who, money: r.pay, n: r.days }, 'good');
    else if (r.walked) sim.toast('toast.haggle_walked', { npc: who }, 'danger');
    else if (r.refused) sim.toast('toast.haggle_no', { npc: who }, 'warn');
    return true;
  }
  if (action === 'contract_locate') {
    const c = sim.contracts.S.active.find((x) => x.id === id);
    const p = c && contractPlace(sim, c);
    if (p) sim.bus.emit('ui:look', { x: p.x, y: p.y });
    return true;
  }
  if (action === 'contract_follow') {
    if (data.npc) sim.bus.emit('ui:follow', { npc: data.npc });
    return true;
  }
  if (action === 'contract_decline') return sim.contracts.decline(id), true;
  if (action === 'contract_abandon') return sim.contracts.abandon(id), true;
  if (action === 'contract_ship') return sim.contracts.fulfilOrder(id), true;
  if (action === 'contract_track') return sim.contracts.track(id), true;
  if (action === 'contract_automate') return sim.contracts.automate(id), true;
  if (action === 'contract_history') return (view.history = !view.history), true;
  if (action === 'company_found') {
    const r = sim.contracts.found();
    if (!r.ok) sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    return true;
  }
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
