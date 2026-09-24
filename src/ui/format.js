/**
 * Formatting helpers shared by the UI.
 *
 * Game events store ids (npc: 'egor', item: 'bread', job: 'courier'), never
 * finished sentences — so when the language changes, old toasts and the whole
 * chronicle re-render correctly. resolveParams() turns ids into display names.
 */
import { QUALITY, STANDARD } from '../data/quality.js';
import { t, tn, fmtMoney, itemName, npcName, occupationName, cap, tList } from '../i18n/i18n.js';
import { BALANCE } from '../config/balance.js';

export function buildingLabel(sim, id) {
  const rec = sim.world?.buildings[id];
  // A business a villager opened (in a house or old premises) goes by its name.
  const bizId = sim.economy?.businessAtBuilding(id);
  const b = bizId && sim.economy.biz(bizId);
  if (b && b.nameIdx !== undefined) return cap(t('ui.biz_label', { name: t(`biz_name.${b.type}.${b.nameIdx}`), type: t(`biz_type.${b.type}`) }));
  if (rec?.player) {
    if (id === sim.state.player.homeId) return t('building.your_home');
    const c = sim.construction.byId(id);
    return t(`buildable.${c?.type || rec.type}.name`);
  }
  // Built by villagers during the game: "Anna's house", or what it is.
  if (id && id.startsWith('vb')) {
    const residents = sim.state.npcs.filter((n) => n.homeId === id && n.age >= 16);
    if (residents.length) return t('building.house_of', { name: npcName(residents[0]) });
    const c = sim.construction?.byId(id);
    return cap(t(`vbuilding.${c?.type || 'house'}`));
  }
  if (id && id.startsWith('house_')) {
    const residents = sim.state.npcs.filter((n) => n.homeId === id && n.age >= 16);
    if (residents.length) return t('building.house_of', { name: npcName(residents[0]) });
    return t('building.house');
  }
  return t(`building.${id}`);
}

/** "North Lanes" / "Жилая слобода на севере" — a district's name from its kind and place. */
export function districtLabel(d) {
  if (!d) return '';
  return t('district.name', { where: t(`district.where.${d.name.where}`), type: t(`district.type.${d.type}.${d.name.variant}`) });
}

/** Where a villager works, as a label (their own business, an employer, you, or nothing). */
export function workLabel(sim, npc) {
  if (npc.owns) return t('ui.owner_of', { place: buildingLabel(sim, sim.economy.biz(npc.owns)?.building) });
  if (npc.employer === 'player') return t('ui.works_for_you');
  if (npc.employer) return buildingLabel(sim, sim.economy.biz(npc.employer)?.building);
  return '—';
}

/** "Skilled Woodcutter" / "Опытный лесоруб" — occupation with professional rank. */
export function npcRole(sim, npc) {
  const contract = sim.workers?.contract(npc.id);
  if (contract) return cap(t(`worker_rank.${contract.rank}`, { gender: npc.gender }));
  const occ = occupationName(npc.occupation, npc.gender);
  const rank = sim.npcs.rank(npc);
  const s = rank && rank !== 'regular' ? t(`rank.${rank}`, { occ, gender: npc.gender }) : occ;
  return cap(s);
}

export function resolveParams(sim, params = {}) {
  const out = { ...params };
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (k === 'name' && typeof v === 'object') out[k] = npcName(v);
    else if (k.startsWith('npc')) out[k] = npcName(sim.npcs.byId(v) || sim.family?.person(v));
    else if (k === 'item') out[k] = itemName(v);
    else if (k === 'job') out[k] = t(`job.${v}.name`);
    else if (k === 'building') out[k] = buildingLabel(sim, v);
    else if (k === 'occ') out[k] = occupationName(v, params.gender);
    else if (k === 'skill') out[k] = t(`skill.${v}.name`);
    else if (k === 'attr') out[k] = t(`attr.${v}.name`);
    else if (k === 'money') out[k] = fmtMoney(v);
    else if (k === 'hour' || k === 'hour2') out[k] = `${String(v).padStart(2, '0')}:00`;
    else if (k === 'plot') out[k] = t(`plot.${v}`);
    else if (k === 'building_type') out[k] = t(`buildable.${v}.name`);
    else if (k === 'tier') out[k] = t(`home_tier.${v}`);
    else if (k === 'worker_rank') out[k] = t(`worker_rank.${v}`, { gender: params.gender });
    else if (k === 'money2') out[k] = fmtMoney(v);
    else if (k === 'biz_type') out[k] = t(`biz_type.${v}`);
    else if (k === 'region') out[k] = t(`region.${v}`);
    else if (k === 'region_name') out[k] = t(`region_name.${v}`);
    else if (k === 'tech') out[k] = t(`tech.${v}.name`);
    else if (k === 'quality') out[k] = t(`quality.${v}`);
    else if (k === 'perk') out[k] = t(`perk.${v}.name`);
    else if (k === 'ambition') out[k] = t(`ambition.${v}.name`);
    else if (k === 'site') out[k] = t(`site.${v}.name`);
    else if (k === 'hamlet') out[k] = hamletName(v);
    else if (k === 'district') out[k] = districtLabel(sim.state.districts?.list.find((d) => d.cells.includes(v))) || t('district.unnamed');
    else if (k === 'from' || k === 'to') out[k] = t(`district.kind.${v}`);
    else if (k === 'vbuilding') out[k] = t(`vbuilding.${v}`);
    else if (k === 'rumor') out[k] = rumorText(sim, v);
    else if (k === 'purpose') out[k] = t(`purpose.${v}`);
    else if (k === 'building2') out[k] = buildingLabel(sim, v);
    else if (k === 'item2') out[k] = itemName(v);
    else if (k === 'ago') out[k] = agoText(v);
    else if (k === 'hobby') out[k] = t(`hobby.${v}`);
    else if (k === 'kin') out[k] = kinText(v);
    else if (k === 'kin_your') out[k] = t(`kin_your.${String(v).split(':')[0]}`, { gender: String(v).split(':')[1] });
    else if (k === 'event') out[k] = t(`event.${v}.name`);
    else if (k === 'rank') out[k] = t(`rank.${v}`, { occ: occupationName(params.occ, params.gender), gender: params.gender });
    else if (k === 'chronicle') out[k] = tr(sim, v.key, v.params);
    else if (k === 'goal') out[k] = t(`goal_short.${v}`);
    else if (k === 'settlement') out[k] = t(`settlement_name.${v}`);
    else if (k === 'size') out[k] = t(`settlement_size.${v}`);
    else if (k === 'transport') out[k] = t(`transport.${v}.name`);
    else if (k === 'reason') out[k] = t(`goal_why.${v}`, { gender: params.gender });
    else if (k === 'trait') out[k] = t(`trait.${v}.name`);
    else if (k === 'institution') out[k] = t(`institution.${v}.name`);
    else if (k === 'status') out[k] = t(`village_status.${v}`);
    else if (k === 'renown') out[k] = t(`renown.${v}`);
    else if (k === 'deed') out[k] = deedText(sim, v);
    else if (k === 'letting') out[k] = t(`reason.letting_${v}`);
  }
  return out;
}

/** A rumor as someone would say it (the details may have grown in the telling). */
export function rumorText(sim, r) {
  if (!r) return '';
  const p = { ...(r.params || {}) };
  const params = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'item' && v === 'gold') params.item = t('rumor.gold');
    else params[k] = v;
  }
  const res = resolveParams(sim, params);
  if (p.item === 'gold') res.item = t('rumor.gold');
  let text = t(`rumor.${r.kind}`, res);
  for (const extra of ['rich', 'everyone', 'very', 'engaged']) if (p[extra]) text += ` ${t(`rumor.extra_${extra}`)}`;
  return text;
}

/** The village's name. */
export function villageName(sim) {
  return t(`village_names.${sim.state.settlement?.nameIdx ?? 0}`);
}

/** "yesterday", "3 days ago", "last season", "2 years ago" (a season is two weeks). */
export function agoText(days) {
  const { daysPerSeason: dps, seasons } = BALANCE.time;
  const year = dps * seasons.length;
  if (days <= 0) return t('ago.today');
  if (days === 1) return t('ago.yesterday');
  if (days < 7) return tn('ago.days', days);
  if (days < dps) return t('ago.last_week');
  if (days < dps * 2) return t('ago.last_season');
  if (days < year) return tn('ago.seasons', Math.floor(days / dps));
  if (days < year * 2) return t('ago.last_year');
  return tn('ago.years', Math.floor(days / year));
}

/** "spouse:f" → "my wife" / "моя жена". */
export function kinText(v) {
  const [kin, gender] = String(v).split(':');
  return t(`kin_my.${kin}`, { gender });
}

/** Translate with id-params resolved to names. */
export function tr(sim, key, params = {}) {
  return t(key, resolveParams(sim, params));
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** "Day 3 of Spring, Year 1" for any absolute day index. */
export function dateString(day) {
  const { daysPerSeason: dps, seasons } = BALANCE.time;
  const season = seasons[Math.floor(day / dps) % seasons.length];
  const year = Math.floor(day / (dps * seasons.length)) + 1;
  return t('ui.date_short', { day: (day % dps) + 1, season: t(`season.${season}`), year });
}

/** An item's name with its quality: "Chair · fine" (standard goods: just the name). */
export function slotName(slot) {
  const q = slot?.q;
  if (q === undefined || q === STANDARD) return itemName(slot.id);
  return t('quality.named', { item: itemName(slot.id), quality: t(`quality.${QUALITY[q].id}`) });
}

/** A small corner badge for crafted goods of notable quality (★ fine, ★★ masterwork, ▼ crude). */
export function qualityBadge(q) {
  if (q === undefined || q === STANDARD) return '';
  const mark = q === 0 ? '▾' : q === 2 ? '★' : '★★';
  return `<span class="qbadge q${q}" title="${escapeHtml(t(`quality.${QUALITY[q].id}`))}">${mark}</span>`;
}

/** One reason behind a villager's goal (see GoalSystem): 'long_walk', 'trait:careful', 'opportunity:bakery'… */
export function goalWhyText(npc, w) {
  const [key, arg] = String(w).split(':');
  if (key === 'trait') return t('goal_why.trait', { trait: t(`trait.${arg}.name`) });
  if (key === 'opportunity') return t('goal_why.opportunity', { biz_type: t(`biz_type.${arg}`) });
  return t(`goal_why.${key}`, { gender: npc.gender });
}

/** One of your family's deeds, told in the third person: "Anna built a workshop." */
export function deedText(sim, d) {
  if (!d) return '';
  return tr(sim, `deed.${d.key}`, { ...(d.params || {}), name: d.name || '?', gender: d.gender });
}

/** A hamlet's name (from the same list villages are named from). */
export function hamletName(idx) {
  const list = tList('village_names');
  return list.length ? list[idx % list.length] : '?';
}
