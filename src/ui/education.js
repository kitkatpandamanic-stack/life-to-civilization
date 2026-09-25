/**
 * What someone knows — shared by the villager Inspect panel, your character
 * sheet, and the school.
 */
import { t, cap, npcName } from '../i18n/i18n.js';
import { escapeHtml, tr } from './format.js';
import { bar } from './widgets.js';
import { KNOWLEDGE, APTITUDES, TEMPERAMENT, INTERESTS } from '../data/education.js';
import { TECHS } from '../data/tech.js';

const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;

export function motivationWord(m) {
  return m >= 75 ? 'keen' : m >= 55 ? 'willing' : m >= 35 ? 'so_so' : 'reluctant';
}

export function interestText(e) {
  if (!e?.interest || !INTERESTS[e.interest]) return null;
  const strength = e.istr >= 55 ? 'devoted' : e.istr >= 25 ? 'keen' : 'curious';
  return `${INTERESTS[e.interest].icon} ${t(`interest_str.${strength}`, { interest: t(`interest_obj.${e.interest}`) })}`;
}

export function fieldName(field) {
  return `${KNOWLEDGE[field]?.icon || ''} ${cap(t(`knowledge.${field}`))}`;
}

/** One line per field: name, level, knowledge bar, experience bar. */
export function knowledgeRows(sim, who, fields) {
  const Ed = sim.education;
  return fields
    .map(({ field }) => {
      const k = Ed.know(who, field);
      const x = Ed.exp(who, field);
      return `<div class="know-row" title="${escapeHtml(t('learn.know_tip', { k: Math.round(k), x: Math.round(x) }))}">
        <span class="know-name">${escapeHtml(fieldName(field))}</span>
        <span class="know-level muted small">${escapeHtml(t(`know_level.${Ed.levelOf(k)}`))}</span>
        ${bar(k, 'xp', String(Math.round(k)))}
        ${bar(x, 'skill', String(Math.round(x)))}
      </div>`;
    })
    .join('');
}

/** The Learning page for a villager (or you). */
export function learningHtml(sim, who, { isPlayer = false } = {}) {
  const Ed = sim.education;
  const e = Ed.profile(who);
  const gender = who.gender;
  const lines = [];
  // Schooling and what they're doing about it.
  lines.push(`<h3>${escapeHtml(t('learn.schooling'))}</h3>`);
  lines.push(kv(t('learn.level'), escapeHtml(t(`edu_level.${e.level}`))));
  const status = sim.schools?.statusOf(who) || sim.academia?.statusOf(who);
  if (status) lines.push(kv(t('learn.now'), escapeHtml(tr(sim, `learn.status.${status.key}`, { gender, ...status.params }))));
  if (e.enrol && e.enrol.stage !== 'evening' && sim.schools) {
    const p = sim.schools.progress(who, e.enrol.stage);
    lines.push(`<div class="need-row"><span>${escapeHtml(t('learn.to_pass'))}</span>${bar(p * 100, p >= 1 ? 'good' : 'xp', `${Math.round(p * 100)}%`)}</div>`);
  }
  if (e.left && !e.enrol) lines.push(kv(t('learn.left'), escapeHtml(t(`learn.left_why.${e.left.why}`, { gender, stage: t(`stage.${e.left.stage}`) }))));
  if (e.degree) lines.push(kv(t('learn.degree'), escapeHtml(cap(t(`knowledge.${e.degree}`)))));
  if ((who.fame || 0) > 0) lines.push(kv(t('learn.fame'), escapeHtml(t(who.fame >= 50 ? 'learn.famous' : 'learn.known_for', { gender }))));
  if (e.talented) lines.push(`<div class="muted small">⭐ ${escapeHtml(t('learn.talented', { gender }))}</div>`);
  lines.push(kv(t('learn.letters'), escapeHtml(t(Ed.literate(who) ? 'learn.literate' : Ed.know(who, 'reading') >= 10 ? 'learn.some_letters' : 'learn.illiterate', { gender }))));
  if (!isPlayer) {
    lines.push(`<div class="need-row"><span>${escapeHtml(t('learn.motivation'))}</span>${bar(e.mot, e.mot < 35 ? 'warn' : 'xp', t(`learn.mot.${motivationWord(e.mot)}`))}</div>`);
    const it = interestText(e);
    lines.push(kv(t('learn.interest'), escapeHtml(it || t('learn.no_interest'))));
  }
  // Work: how good they are at what they do, and where they stand in the trade.
  const field = isPlayer ? null : Ed.fieldOf(who);
  if (field) {
    const c = Math.round(Ed.competence(who, field));
    lines.push(kv(t('learn.at_work'), escapeHtml(t('learn.competence', { field: t(`knowledge.${field}`), n: c }))));
    const tier = sim.careers?.tier(who, field);
    if (tier) lines.push(kv(t('learn.standing'), escapeHtml(t(`career_title.${tier}`, { occ: t(`knowledge.${field}`), gender }))));
  }
  // Learning a trade from a master.
  const ap = who.apprentice;
  if (ap) {
    const master = ap.master === 'player' ? t('hall.you') : sim.npcs.byId(ap.master) ? npcName(sim.npcs.byId(ap.master)) : '—';
    lines.push(kv(t('learn.apprentice_of'), escapeHtml(t('learn.apprentice_line', { npc: master, field: t(`knowledge.${ap.field}`), n: ap.days }))));
  }
  if (e.retrain) lines.push(kv(t('learn.wants_trade'), escapeHtml(cap(t(`knowledge.${e.retrain}`)))));
  if (e.quals?.length) lines.push(kv(t('learn.quals'), escapeHtml(e.quals.map((q) => t(`learn.qual.${q.how}`, { field: t(`knowledge.${q.field}`) })).join(', '))));
  // Gifts: how they learn (villagers only — you know yourself).
  if (!isPlayer) {
    lines.push(`<h3>${escapeHtml(t('learn.gifts'))}</h3>`);
    for (const a of [...APTITUDES, ...TEMPERAMENT]) {
      const v = e.apt[a] ?? 50;
      lines.push(`<div class="need-row"><span>${escapeHtml(t(`apt.${a}`))}</span>${bar(v, v >= 65 ? 'good' : v < 35 ? 'warn' : 'skill', t(`apt_word.${v >= 80 ? 'excellent' : v >= 65 ? 'good' : v >= 35 ? 'average' : 'weak'}`))}</div>`);
    }
  }
  // Know-how: the village's techniques, and how well they know each (KnowHowSystem).
  const kh = isPlayer ? [] : sim.knowhow?.of(who) || [];
  if (kh.length) {
    lines.push(`<h3>${escapeHtml(t('learn.knowhow'))}</h3>`);
    for (const x of kh) lines.push(kv(`${TECHS[x.id]?.icon || ''} ${t(`tech.${x.id}.name`)}`, escapeHtml(t(`know_level.${x.level}`))));
  }
  // Knowledge and experience.
  const top = Ed.topFields(who, 10);
  lines.push(`<h3>${escapeHtml(t('learn.knowledge'))}</h3>`);
  lines.push(`<div class="know-row know-head muted small"><span></span><span></span><span>${escapeHtml(t('learn.knows'))}</span><span>${escapeHtml(t('learn.has_done'))}</span></div>`);
  lines.push(top.length ? knowledgeRows(sim, who, top) : `<div class="muted small">${escapeHtml(t('learn.knows_little', { gender }))}</div>`);
  return lines.join('');
}
