/**
 * Inspect — look at a villager's life without talking to them:
 * what they're doing, how they feel, their routine, work, family and friends.
 */
import { Panel } from '../Panel.js';
import { t, npcName, npcFullName, fmtMoney, cap } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel, npcRole, workLabel, agoText } from '../format.js';
import { bar, portrait, hearts, button } from '../widgets.js';
import { BALANCE } from '../../config/balance.js';

export function lifeStage(npc) {
  if (npc.age < 3) return 'baby';
  if (npc.age < 13) return 'child';
  if (npc.age < 18) return 'teen';
  if (npc.age < 60) return 'adult';
  return 'elder';
}

export class InspectPanel extends Panel {
  constructor(ui, npcId) {
    super(ui);
    this.npc = this.sim.npcs.byId(npcId);
  }
  get id() {
    return 'inspect';
  }
  title() {
    return `🔍 ${escapeHtml(npcName(this.npc))}`;
  }

  /** Refresh a few times per second so needs and activity update live. */
  tick(delta) {
    this.timer = (this.timer || 0) - delta;
    if (this.timer <= 0) {
      this.timer = 500;
      this.ui.renderPanel();
    }
  }

  render() {
    const sim = this.sim;
    const npc = this.npc;
    const npcs = sim.npcs;
    const act = npcs.activity(npc);
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;
    const need = (label, v, cls) => `<div class="need-row"><span>${escapeHtml(label)}</span>${bar(v, cls, String(Math.round(v)))}</div>`;
    const moodKey = npc.mood >= 75 ? 'happy' : npc.mood >= 50 ? 'content' : npc.mood >= 30 ? 'unhappy' : 'miserable';
    const work = workLabel(sim, npc);
    const wealth = npc.money > 150 ? 'rich' : npc.money > 50 ? 'comfortable' : npc.money > 15 ? 'modest' : 'poor';
    const nextLevel = npcs.xpForNext(npc.level);

    const schedule = npcs
      .schedule(npc)
      .map((s) => `<div class="sched-row"><span class="sched-h">${String(Math.floor(s.hour)).padStart(2, '0')}:${s.hour % 1 ? '30' : '00'}</span>${escapeHtml(t(`schedule.${s.key}`))}</div>`)
      .join('');

    // Relationships: family and work ties first, then the strongest feelings either way.
    const rels = Object.entries(npc.relations)
      .map(([id, v]) => ({ other: npcs.byId(id), v }))
      .filter((r) => r.other && (npc.family.includes(r.other.id) || Math.abs(r.v.f) >= 20 || r.v.c >= 30))
      .sort((a, b) => (npc.family.includes(b.other.id) - npc.family.includes(a.other.id)) || Math.abs(b.v.f) + b.v.c - (Math.abs(a.v.f) + a.v.c))
      .slice(0, 7)
      .map((r) => {
        const tags = sim.social.relTags(npc, r.other).slice(0, 2).map((tag) => t(`npc_rel.${tag}`, { gender: r.other.gender }));
        const tip = `${t('ui.trust')} ${Math.round(r.v.t)} · ${t('ui.respect')} ${Math.round(r.v.r)} · ${t('ui.tension')} ${Math.round(r.v.c)}`;
        return `<div class="rel-row" title="${escapeHtml(tip)}"><span>${escapeHtml(npcName(r.other))}</span><span class="muted small">${escapeHtml(tags.join(' · '))}</span>${r.v.f >= 0 ? hearts(r.v.f) : '<span class="rel-neg">💢</span>'}</div>`;
      })
      .join('');
    const day = sim.time.day;
    const memories = sim.memory
      .strongest(npc, 6)
      .map((m) => {
        const text = tr(sim, `memory.${m.k}`, { gender: npc.gender, ...(m.p || {}) });
        const mood = sim.memory.def(m.k).val;
        return `<div class="mem-row ${mood > 0 ? 'pos' : mood < 0 ? 'neg' : ''}"><span class="muted small">${escapeHtml(cap(agoText(day - m.d)))}</span> ${escapeHtml(text)}${m.n > 1 ? ` <span class="muted small">×${m.n}</span>` : ''}</div>`;
      })
      .join('');
    const h = npc.habits || {};
    const wdName = (d) => (d === null || d === undefined ? '—' : t(`weekday.${d}`));
    const fav = sim.habits.favouritePlace(npc);
    const goal = sim.dialogue.goal(npc);
    const pb = sim.social.playerBond(npc);

    const traits = npc.traits.map((tr_) => `<div class="trait-row"><b>${escapeHtml(t(`trait.${tr_}.name`))}</b> <span class="muted small">${escapeHtml(t(`trait.${tr_}.desc`))}</span></div>`).join('');
    const prod = Math.round(npcs.productivity(npc) * 100);

    return `
      <div class="dlg-head">
        ${portrait(`npc_${sim.state.seed}_${npc.id}`, npc.look, 80)}
        <div>
          <div class="dlg-name">${escapeHtml(npcFullName(npc))}</div>
          <div class="muted">${escapeHtml(npcRole(sim, npc))} · ${escapeHtml(t('ui.level_n', { level: npc.level }))} · ${escapeHtml(t('ui.age_n', { age: npc.age }))} · ${escapeHtml(t(`life_stage.${lifeStage(npc)}`))}</div>
          ${bar((npc.xp / nextLevel) * 100, 'xp', t('ui.xp_progress', { xp: Math.floor(npc.xp), need: nextLevel }))}
          <div class="activity">▶ ${escapeHtml(tr(sim, `activity.${act.key}`, { gender: npc.gender, ...act.params }))}</div>
        </div>
      </div>
      <div class="char-cols">
        <div class="col">
          <h3>${escapeHtml(t('ui.needs'))}</h3>
          ${need(t('stat.hunger'), npc.hunger, npc.hunger < 25 ? 'warn' : '')}
          ${need(t('stat.energy'), npc.energy, npc.energy < 20 ? 'warn' : 'energy')}
          ${need(t('stat.health'), npc.health, npc.health < 40 ? 'warn' : 'health')}
          ${kv(t('ui.mood'), escapeHtml(t(`mood.${moodKey}`, { gender: npc.gender })) + ` (${npc.mood})`)}
          ${need(t('ui.company'), npc.social ?? 60, (npc.social ?? 60) < 25 ? 'warn' : '')}
          ${kv(t('ui.productivity'), `${prod}%`)}
          ${kv(t('ui.goal'), escapeHtml(tr(sim, `goal_label.${goal.type}`, { money: goal.saved, money2: goal.target })))}
          <h3>${escapeHtml(t('ui.life'))}</h3>
          ${kv(t('ui.home'), escapeHtml(npc.homeId ? buildingLabel(sim, npc.homeId) : t('ui.homeless')))}
          ${kv(t('ui.work'), escapeHtml(work))}
          ${this.careerKey() ? kv(t('ui.career'), escapeHtml(t(`career.${this.careerKey()}`))) : ''}
          ${npc.employer && npc.employer !== 'player' && npc.jobSat !== undefined ? kv(t('ui.job_satisfaction'), npc.jobSat) : ''}
          ${npc.education ? kv(t('ui.education'), escapeHtml(t(`education.${npc.education >= 30 ? 'high' : npc.education >= 12 ? 'good' : 'some'}`))) : ''}
          ${npc.mentor && sim.family.person(npc.mentor) ? kv(t('ui.mentor'), escapeHtml(npcName(sim.family.person(npc.mentor)))) : ''}
          ${sim.state.tech?.teacher === npc.id ? kv(t('ui.role'), escapeHtml(t('ui.village_teacher', { gender: npc.gender }))) : ''}
          ${kv(t('ui.wealth'), `${escapeHtml(t(`wealth.${wealth}`))} · ${fmtMoney(npc.money)}`)}
          ${npc.unpaidDays > 0 ? kv(t('ui.unpaid_days'), npc.unpaidDays) : ''}
          ${kv(t('ui.family_tree'), this.familyHtml())}
          ${npc.partner && npcs.byId(npc.partner) ? kv(t('ui.partner'), escapeHtml(npcName(npcs.byId(npc.partner)))) : ''}
          <h3>${escapeHtml(t('ui.personality'))}</h3>
          ${traits}
        </div>
        <div class="col">
          <h3>${escapeHtml(t('ui.daily_routine'))}</h3>
          <div class="schedule">${schedule}</div>
          <h3>${escapeHtml(t('ui.habits'))}</h3>
          ${kv(t('ui.rhythm'), escapeHtml(t(`chronotype.${h.chronotype || 'normal'}`)))}
          ${h.hobby ? kv(t('ui.hobby'), escapeHtml(cap(t(`hobby.${h.hobby}`)))) : ''}
          ${h.tavernNight !== null && h.tavernNight !== undefined ? kv(t('ui.tavern_night'), escapeHtml(wdName(h.tavernNight))) : ''}
          ${h.marketDay !== null && h.marketDay !== undefined ? kv(t('ui.market_day'), escapeHtml(wdName(h.marketDay))) : ''}
          ${h.familyDay !== null && h.familyDay !== undefined ? kv(t('ui.family_day'), escapeHtml(wdName(h.familyDay))) : ''}
          ${fav ? kv(t('ui.favourite_place'), escapeHtml(buildingLabel(sim, fav))) : ''}
          <h3>${escapeHtml(t('ui.relationships'))}</h3>
          ${rels || `<div class="muted small">${escapeHtml(t('ui.no_relationships'))}</div>`}
          <h3>${escapeHtml(t('ui.with_you'))}</h3>
          <div class="rel-row"><span>${escapeHtml(t(`rel_tier.${sim.social.tier(npc)}`))}</span>${hearts(npc.rel)}</div>
          <div class="muted small">${escapeHtml(t('ui.trust'))} ${Math.round(pb.t)} · ${escapeHtml(t('ui.respect'))} ${Math.round(pb.r)} · ${escapeHtml(t('ui.tension'))} ${Math.round(pb.c)}</div>
          <h3>${escapeHtml(t('ui.memories'))}</h3>
          ${memories || `<div class="muted small">${escapeHtml(t('ui.no_memories'))}</div>`}
        </div>
      </div>
      <div class="btn-row">${button(t('dialog.opt.talk_instead'), 'talk', {}, { cls: 'primary' })}</div>
      <div class="muted small">${escapeHtml(t('ui.inspect_hint', { r: BALANCE.npc.ranks.skilled }))}</div>`;
  }

  /** Where they are on the ladder: apprentice → worker → experienced → specialist → manager → owner. */
  careerKey() {
    const npc = this.npc;
    const sim = this.sim;
    if (npc.owns) return 'owner';
    if (npc.employer && npc.employer !== 'player' && sim.economy.biz(npc.employer)?.manager === npc.id) return 'manager';
    return sim.npcs.rank(npc);
  }

  /** "Wife: Nina · Daughter: Sofia · Father: Gregory †" — the living and the remembered. */
  familyHtml() {
    const sim = this.sim;
    const npc = this.npc;
    const F = sim.family;
    const k = npc.kin || {};
    const ids = [k.spouse, npc.widowOf, ...(k.parents || []), ...(k.children || []), ...(k.siblings || []), ...npc.family].filter(Boolean);
    const out = [];
    for (const id of [...new Set(ids)]) {
      const p = F.person(id);
      if (!p) continue;
      const living = !!sim.npcs.byId(id);
      const kin = F.kinship(npc, p) || (id === npc.widowOf ? 'spouse' : 'relative');
      const name = living ? npcName(p) : t('ui.late', { name: npcName(p) });
      out.push(`<span class="${living ? 'clickable' : 'muted'}" ${living ? `data-action="inspect_npc" data-id="${id}"` : ''}>${escapeHtml(t(`npc_rel.${kin}`, { gender: p.gender }))}: ${escapeHtml(name)}</span>`);
    }
    return out.join(' · ') || '—';
  }

  onAction(action, data) {
    if (action === 'talk') this.ui.openDialogue(this.npc.id);
    if (action === 'inspect_npc' && data?.id) this.ui.openInspect(data.id);
  }
}
