/**
 * The building card — what you see when you walk up to a building (E) or click it in the world:
 *
 *   🏠 Anna's house                      [● Lived in]
 *   Medium house · Lv 2/4 · Quality 64%   Owner: Anna
 *   Condition ████████░░ 82%
 *   People: 3 / 4 residents · Workers: 2 / 3
 *   Value $1,240 · Rent $30/wk
 *   (a works site: progress, materials, time left)
 *   [1] Talk to Anna  [2] …                (the things you can do here, when you're next to it)
 *   [Inspect F] [Upgrade] [Manage]         (the bigger screens, always)
 *
 * Everything here is read from the world (StructureSystem.sheet, PropertySystem, ConstructionSystem).
 */
import { t, fmtMoney, npcName, itemName, occupationName } from '../i18n/i18n.js';
import { escapeHtml, buildingLabel } from './format.js';
import { status, condBar, progress, resRow, icon } from './widgets.js';
import { stateBadge } from './transport.js';

/** The icon for a building: its business's, or what it is. */
const BUILDING_ICONS = [
  [/school|univers|institute|library/, '🏫'],
  [/hall|council/, '🏛️'],
  [/church|chapel|temple/, '⛪'],
  [/station|rail/, '🚉'],
  [/barn|stable/, '🐄'],
  [/warehouse|depot|shed/, '📦'],
  [/clinic|doctor/, '⚕️'],
  [/watch/, '🛡️'],
  [/market/, '🏷️'],
  [/office/, '🗂️'],
  [/apartment|flats/, '🏢'],
  [/shack|hut/, '🛖'],
  [/farm/, '🌾'],
  [/works|factory|mill/, '🏭'],
];
export function buildingIcon(sim, id) {
  if (id === sim.state.player.homeId) return '🏡';
  const biz = sim.economy?.businessAtBuilding(id);
  const def = biz && sim.economy.def(biz);
  if (def?.icon) return def.icon;
  const type = `${sim.property?.type?.(id) || ''} ${sim.world.buildings[id]?.type || ''}`;
  return BUILDING_ICONS.find(([re]) => re.test(type))?.[1] || '🏠';
}

/** Whose it is, in a word: You · the village · a villager's name · (a firm). */
export function ownerName(sim, owner) {
  if (owner === 'player') return t('bcard.owner_you');
  if (owner === 'village' || !owner) return t('bcard.owner_village');
  const npc = sim.npcs.byId(owner);
  return npc ? npcName(npc) : t('bcard.owner_other');
}

/** How much of a site is done, whether it's waiting for anything, who's on it, and how long it'll take. */
export function siteInfo(sim, c) {
  const C = sim.construction;
  const pct = Math.min(100, Math.round((c.labor / Math.max(1, c.laborNeeded)) * 100));
  const state = C.siteState(c);
  const hands = sim.state.npcs.filter((n) => n.task?.site === c.id || n.task?.siteId === c.id || sim.workers.contract(n.id)?.task?.target === c.id);
  const hoursLeft = Math.max(0, (c.laborNeeded - c.labor) / 60);
  // A builder does about 8 hours a day; with nobody on it, it isn't getting any closer.
  const days = hands.length ? Math.max(0.1, hoursLeft / (8 * hands.length)) : null;
  return { pct, state, hands, hoursLeft, days, missing: C.missing(c), mat: Math.round(C.materialsFraction(c) * 100) };
}

/** What's going on at a building, as one badge: [kind, icon, words]. */
export function buildingActivity(sim, id) {
  const P = sim.property;
  const E = sim.economy;
  const pr = P.rec(id);
  if (sim.disasters?.fireAt(id)) return ['danger', '🔥', t('bstate.fire')];
  if (pr?.ruined) return ['danger', '🏚️', t('bstate.ruined')];
  const own = sim.construction.byId(id);
  if (own && own.status === 'site') {
    const s = sim.construction.siteState(own);
    return s === 'waiting_materials' ? ['warn', '📦', t('bstate.waiting_materials')] : ['info', '🏗️', t('bstate.constructing')];
  }
  const works = sim.structures?.works(id);
  if (works) return sim.construction.siteState(works) === 'waiting_materials' ? ['warn', '📦', t('bstate.waiting_materials')] : ['info', '🔨', t('bstate.upgrading')];
  if (pr?.abandoned) return ['warn', '🕸️', t('bstate.abandoned')];
  const biz = E.businessAtBuilding(id);
  const def = biz && E.def(biz);
  if (def) {
    if (E.biz(biz)?.closed) return ['warn', '🚫', t('bstate.closed_down')];
    if (def.openHours) return E.isOpen(biz) ? ['good', '🟢', t('bstate.open')] : ['neutral', '🌙', t('bstate.closed_now')];
    return sim.npcs.staffOf(biz).length ? ['good', '⚙️', t('bstate.producing')] : ['warn', '👷', t('bstate.no_staff')];
  }
  if (P.isHome(id)) {
    if (P.occupants(id) > 0) return ['good', '🏠', t('bstate.lived_in')];
    if (pr?.forSale) return ['money', '🏷️', t('bstate.for_sale')];
    return ['neutral', '🚪', t('bstate.empty')];
  }
  return ['good', '✓', t('bstate.in_use')];
}

/** Someone who lives or works here, on one line (click: go and see them). */
function personLine(sim, npc, what) {
  const c = sim.workers.contract(npc.id);
  const tag = c ? stateBadge(c.state) : `<span class="muted small">${escapeHtml(what)}</span>`;
  return `<div class="bc-person clickable" data-cmd="person" data-npc="${npc.id}"><span class="bc-pname">${escapeHtml(npcName(npc))}</span>${tag}</div>`;
}

/** A works site (a new building, a new level, a renovation): how far, what's missing, who's on it, time left. */
export function siteBlock(sim, c) {
  const s = siteInfo(sim, c);
  const waiting = s.state === 'waiting_materials';
  const rows = Object.entries(c.required || {}).map(([item, n]) => resRow(item, itemName(item), Math.min(n, c.delivered?.[item] || 0), n)).join('');
  const time = s.days === null ? t('bcard.nobody_on_it') : t('bcard.days_left', { n: s.days < 1 ? '<1' : Math.round(s.days * 10) / 10 });
  return `<div class="bc-site">
    ${progress(s.pct, { label: waiting ? t('bstate.waiting_materials') : t('bcard.progress'), kind: waiting ? 'warn' : '' })}
    <div class="bc-line"><span>👷 ${escapeHtml(t('bcard.builders', { n: s.hands.length }))}</span><span>⏱ ${escapeHtml(time)}</span></div>
    ${rows ? `<div class="bc-sub">${escapeHtml(t('ui.materials'))} · ${s.mat}%</div>${rows}` : ''}
    ${waiting || Object.keys(s.missing).length ? `<div class="bc-actions">${cmdButton('📦', t('bcard.view_missing'), 'site', { site: c.id })}</div>` : ''}
  </div>`;
}

function cmdButton(ico, label, cmd, data = {}, cls = 'sm') {
  const attrs = Object.entries(data)
    .map(([k, v]) => `data-${k}="${escapeHtml(v)}"`)
    .join(' ');
  return `<button class="btn ${cls}" data-cmd="${cmd}" ${attrs}><span class="b-ico">${ico}</span>${escapeHtml(label)}</button>`;
}

/**
 * The card's information (everything above the list of actions).
 * Returns { head, body, foot } — the head replaces the menu title, the foot holds the big-screen buttons.
 */
export function buildingCard(sim, id, { near = true } = {}) {
  const S = sim.structures;
  const P = sim.property;
  const E = sim.economy;
  const b = sim.world.buildings[id];
  if (!b) return null;
  const sheet = S?.sheet(id);
  const pr = P.rec(id);
  const [kind, ico, words] = buildingActivity(sim, id);
  // Identity: what it is, its level and quality, whose it is.
  const lvl = sheet?.level ? t('bcard.level', { n: sheet.level, max: sheet.maxLevel }) : '';
  const typeName = sheet?.level ? t(`structure.level.${S.rec(id).fam}.${sheet.level}`) : '';
  const owner = pr?.owner ? ownerName(sim, pr.owner) : '';
  const idLine = [typeName, lvl, sheet?.level ? t('bcard.quality', { n: sheet.quality }) : ''].filter(Boolean).join(' · ');
  const head = `<div class="bc-head">
      <span class="bc-ico">${buildingIcon(sim, id)}</span>
      <div class="bc-id"><div class="bc-name">${escapeHtml(buildingLabel(sim, id))}</div>${idLine ? `<div class="bc-type">${escapeHtml(idLine)}</div>` : ''}</div>
      ${status(words, kind, ico)}
    </div>`;
  let body = '';
  if (owner) body += `<div class="bc-line"><span>${escapeHtml(t('bcard.owner'))}</span><b>${escapeHtml(owner)}</b></div>`;
  if (pr && !pr.ruined) body += `<div class="bc-cond">${condBar(pr.condition ?? 100)}</div>`;
  // Building work under way (its own construction, or a new level / room / renovation).
  const own = sim.construction.byId(id);
  const site = own && own.status === 'site' ? own : S?.works(id);
  if (site) body += siteBlock(sim, site);
  // People: who lives here, who works here.
  const residents = sim.state.npcs.filter((n) => n.homeId === id && !n.away);
  const workers = (sheet?.workers || []).map((n) => sim.npcs.byId(n)).filter(Boolean);
  const people = [];
  // (you count too, in your own home)
  const living = residents.length + (id === sim.state.player.homeId ? 1 : 0);
  if (P.isHome(id) && (sheet?.capacity || living)) people.push(`🏠 ${t('bcard.residents', { n: living, cap: Math.max(sheet?.capacity || 0, living) })}`);
  if (sheet?.staffCap || workers.length) people.push(`👷 ${t('bcard.workers', { n: workers.length, cap: Math.max(sheet?.staffCap || 0, workers.length) })}`);
  if (people.length) {
    body += `<div class="bc-line"><span>${escapeHtml(people.join(' · '))}</span></div>`;
    const list = [...workers.slice(0, 4).map((n) => personLine(sim, n, n.occupation ? occupationName(n.occupation, n.gender) : '')), ...residents.filter((n) => !workers.includes(n)).slice(0, workers.length ? 2 : 4).map((n) => personLine(sim, n, n.age < 16 ? t('bcard.child') : t('bcard.lives_here')))];
    if (list.length) body += `<div class="bc-people">${list.join('')}</div>`;
  }
  // Storage: what's kept here (the top few), against the room there is.
  const stock = Object.entries(sheet?.storage?.stock || {}).sort((a, b2) => b2[1] - a[1]);
  if (stock.length) {
    const total = stock.reduce((s2, [, q]) => s2 + q, 0);
    const cap = sheet.storage.cap;
    body += `<div class="bc-sub">${escapeHtml(t('bcard.stored'))}${cap ? ` · ${total} / ${cap}` : ''}</div><div class="bc-stock">${stock
      .slice(0, 6)
      .map(([item, q]) => `<span class="bc-item" title="${escapeHtml(itemName(item))}">${icon(item, 18)}${q}</span>`)
      .join('')}${stock.length > 6 ? `<span class="muted small">+${stock.length - 6}</span>` : ''}</div>`;
  }
  // Money: what it's worth; the rent; your business's week.
  const money = [];
  if (sheet?.value) money.push(`${t('bcard.value')} <b>${fmtMoney(sheet.value)}</b>`);
  if (pr?.lease) money.push(`${t('bcard.rent')} <b>${fmtMoney(pr.lease.rent)}</b>/${t('bcard.week')}`);
  const biz = E.businessAtBuilding(id);
  if (biz && sim.holdings.isMine(biz) && sim.enterprise?.books) {
    const bk = sim.enterprise.books(biz, 7);
    money.push(`${t('bcard.profit_week')} <b class="${bk.profit >= 0 ? 'good' : 'neg'}">${fmtMoney(bk.profit)}</b>`);
  } else if (sheet?.operatingCost && pr?.owner === 'player') money.push(`${t('bcard.costs_day')} <b>${fmtMoney(sheet.operatingCost)}</b>`);
  if (money.length) body += `<div class="bc-money">${money.map((m) => `<span>${m}</span>`).join('')}</div>`;
  if (!near) body += `<div class="hint bc-far">🚶 ${escapeHtml(t('bcard.walk_up'))}</div>`;
  // For developers only (dev.cards = true): the building as the simulation sees it.
  if (typeof window !== 'undefined' && window.dev?.cards) {
    const rows = [['id', id], ['type', b.type], ['level', sheet?.level ?? '—'], ['condition', Math.round(pr?.condition ?? 100)], ['workers', (sheet?.workers || []).join(',') || '—'], ['works', site ? `${site.id} ${Math.round((site.labor / Math.max(1, site.laborNeeded)) * 100)}% ${sim.construction.siteState(site)}` : '—']];
    body += `<div class="dev-info">${rows.map(([k, v]) => `<div><span>${k}</span><code>${escapeHtml(String(v))}</code></div>`).join('')}</div>`;
  }

  // The bigger screens: always the same few, only the ones that make sense here.
  const mine = pr?.owner === 'player';
  const foot = [];
  if (pr) foot.push(cmdButton('🔍', t('bcard.inspect'), 'inspect', {}, 'sm'));
  if (mine && sheet?.upgrade && !site) foot.push(cmdButton('⬆', t('bcard.upgrade'), 'upgrade', {}, sheet.upgrade.check?.ok ? 'sm primary' : 'sm'));
  if (mine && pr && (pr.condition ?? 100) < 70 && !site) foot.push(cmdButton('🔧', t('bcard.repair'), 'upgrade', {}, 'sm'));
  if (biz && sim.holdings.isMine(biz)) foot.push(cmdButton('💼', t('bcard.manage'), 'manage', { biz }, 'sm'));
  if (site) foot.push(cmdButton('🏗️', t('bcard.site'), 'site', { site: site.id }, 'sm'));
  foot.push(cmdButton('🎯', t('bcard.locate'), 'locate', {}, 'sm ghost'));
  return { head, body, foot: foot.join('') };
}

/** A construction site that isn't a building yet (a new house going up). */
export function siteCard(sim, siteId, { near = true } = {}) {
  const c = sim.construction.byId(siteId);
  if (!c) return null;
  const s = siteInfo(sim, c);
  const name = sim.construction.isPlayers(c) ? t(`buildable.${c.type}.name`) : t(`vbuilding.${c.type}`);
  const waiting = s.state === 'waiting_materials';
  const head = `<div class="bc-head"><span class="bc-ico">🏗️</span><div class="bc-id"><div class="bc-name">${escapeHtml(t('ui.site_of', { name }))}</div><div class="bc-type">${escapeHtml(sim.construction.isPlayers(c) ? t('bcard.your_site') : ownerName(sim, c.owner || 'village'))}</div></div>${waiting ? status(t('bstate.waiting_materials'), 'warn', '📦') : status(t('bstate.constructing'), 'info', '🏗️')}</div>`;
  let body = siteBlock(sim, c);
  if (!near) body += `<div class="hint bc-far">🚶 ${escapeHtml(t('bcard.walk_up'))}</div>`;
  const foot = [cmdButton('🏗️', t('bcard.site'), 'site', { site: c.id }), cmdButton('🎯', t('bcard.locate'), 'locate', {}, 'sm ghost')].join('');
  return { head, body, foot };
}
