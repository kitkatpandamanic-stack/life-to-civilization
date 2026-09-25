/**
 * The village hall — the village's affairs (see CivicSystem, LegacySystem).
 *
 * What the valley's settlement is and what it needs to become more; the headman
 * and council, the last election and the next; the policies (yours to set if
 * you're headman); the village fund and the institution being saved for; the
 * institutions the village has, wants and can't have yet; the bank; and your
 * family's renown and deeds.
 */
import { Panel } from '../Panel.js';
import { t, tn, npcName, fmtMoney } from '../../i18n/i18n.js';
import { escapeHtml, tr, dateString, deedText, villageName } from '../format.js';
import { button, portrait } from '../widgets.js';
import { INSTITUTIONS, INSTITUTION_ORDER, POLICIES } from '../../data/civic.js';
import { POSTS } from '../../data/academia.js';
import { FOUNDABLE } from '../../data/study.js';

export class HallPanel extends Panel {
  get id() {
    return 'hall';
  }
  title() {
    return `📜 ${escapeHtml(t('hall.title'))}`;
  }

  personName(id) {
    if (id === 'player') return t('hall.you');
    const n = this.sim.npcs.byId(id);
    return n ? npcName(n) : '—';
  }

  render() {
    const sim = this.sim;
    const C = sim.civic;
    const V = C.V;
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;
    const mine = C.isPlayerHeadman();

    // What the village is, and what it needs to become more.
    const next = C.nextStatus();
    const missing = C.statusMissing()
      .map((m) => (m.k === 'pop' ? t('hall.need_pop', { n: m.v }) : m.k === 'institutions' ? tn('hall.need_institutions', m.v) : ['literacy', 'school', 'graduates'].includes(m.k) ? t(`hall.need_${m.k}`, { n: m.v }) : t('hall.need_institution', { institution: t(`institution.${m.v}.name`) })))
      .join(' · ');
    const status = `
      <h3>${escapeHtml(villageName(sim))} — ${escapeHtml(t(`village_status.${V.status}`))}</h3>
      ${kv(t('hall.people'), C.pop())}
      ${next ? `<div class="muted small">${escapeHtml(t('hall.to_become', { status: t(`village_status.${next.id}`) }))} ${escapeHtml(missing || t('hall.soon'))}</div>` : `<div class="muted small">${escapeHtml(t('hall.top_status'))}</div>`}`;

    // Headman and council.
    const h = V.headman;
    const hNpc = h && h !== 'player' ? sim.npcs.byId(h) : null;
    const council = V.council.map((id) => this.personName(id)).join(', ') || '—';
    const days = Math.max(0, V.nextElection - sim.time.day);
    const votes = (V.lastElection?.votes || []).map((v) => `${this.personName(v.id)} ${v.n}`).join(' · ');
    const cands = C.candidates().map((c) => this.personName(c.id)).join(', ');
    const stand = C.canStand();
    const government = `
      <h3>${escapeHtml(t('hall.government'))}</h3>
      <div class="kv"><span>${escapeHtml(t('hall.headman'))}</span><b>${hNpc ? `${portrait(`npc_${sim.state.seed}_${hNpc.id}`, hNpc.look, 22)} ` : ''}${escapeHtml(this.personName(h))}</b></div>
      ${kv(t('hall.council'), escapeHtml(council))}
      ${kv(t('hall.approval'), `${C.approval()}%`)}
      ${kv(t('hall.next_election'), escapeHtml(t('hall.in_days', { n: days })))}
      ${votes ? `<div class="muted small">${escapeHtml(t('hall.last_votes'))} ${escapeHtml(votes)}</div>` : ''}
      <div class="muted small">${escapeHtml(t('hall.candidates'))} ${escapeHtml(cands)}</div>
      <div class="row">${
        V.standing
          ? button(t('hall.withdraw'), 'stand', { on: 0 })
          : button(t('hall.stand'), 'stand', { on: 1 }, { disabled: !stand.ok, title: stand.ok ? '' : tr(sim, `reason.${stand.reason}`, stand.params || {}) })
      }</div>
      ${!stand.ok && !V.standing ? `<div class="muted small">${escapeHtml(tr(sim, `reason.${stand.reason}`, stand.params || {}))}</div>` : ''}
      <div class="muted small">${escapeHtml(t('hall.election_hint'))}</div>`;

    // Policies: yours to set if you're headman.
    const policy = (kind) => {
      const cur = V.policies[kind];
      const opts = Object.keys(POLICIES[kind])
        .map((lv) => (mine ? button(t(`hall.level_${lv}`), 'policy', { kind, lv }, { cls: lv === cur ? 'primary' : '' }) : lv === cur ? `<b>${escapeHtml(t(`hall.level_${lv}`))}</b>` : ''))
        .join(' ');
      return `<div class="kv"><span>${escapeHtml(t(`hall.policy_${kind}`))}</span><span>${opts}</span></div>`;
    };
    const village = sim.state.village;
    const tax = village.taxLog?.slice(-1)[0];
    const project = V.project;
    const projectLine = project
      ? `${escapeHtml(t(`institution.${project}.name`))} · ${fmtMoney(V.fund)} / ${fmtMoney(C.costOf(project))}`
      : (() => {
          const site = sim.construction.list.find((c) => c.institution && c.status === 'site');
          return site ? escapeHtml(t('hall.being_built', { institution: t(`institution.${site.institution}.name`) })) : escapeHtml(t('hall.no_project'));
        })();
    const wanted = C.wanted();
    const projectPick = mine && wanted.length ? `<div class="row">${wanted.map((id) => button(`${INSTITUTIONS[id].icon} ${t(`institution.${id}.name`)}`, 'project', { id }, { cls: id === project ? 'primary' : '' })).join(' ')}</div>` : '';
    const affairs = `
      <h3>${escapeHtml(t('hall.affairs'))}</h3>
      ${policy('tax')}
      ${policy('relief')}
      ${policy('schooling')}
      ${kv(t('hall.treasury'), fmtMoney(village.treasury))}
      ${village.civicSaving ? kv(t('hall.saving_building'), `${escapeHtml(t(`vbuilding.${village.civicSaving.type}`))} · ${fmtMoney(village.civicSaving.amount)}`) : ''}
      ${tax ? kv(t('hall.taxes_week'), fmtMoney(tax.business + tax.property)) : ''}
      ${kv(t('hall.saving_for'), projectLine)}
      ${projectPick}
      <div class="muted small">${escapeHtml(t(mine ? 'hall.headman_hint' : 'hall.policy_hint'))}</div>
      ${this.worksHtml()}`;

    // Institutions: have, could found, not yet.
    const inst = INSTITUTION_ORDER.map((id) => {
      const def = INSTITUTIONS[id];
      const got = V.institutions[id];
      let state;
      if (got) state = t('hall.founded', { date: dateString(got.founded) }) + (got.byPlayer ? ` · ${t('hall.by_you')}` : '');
      else if (C.underway(id)) state = t('hall.underway');
      else {
        const miss = C.conditions(id).missing;
        state = miss.length ? t('hall.needs', { what: miss.map((m) => (m.k === 'tech' ? t(`tech.${m.v}.name`) : t(`hall.need_${m.k}`, { n: m.v }))).join(', ') }) : t('hall.wanted');
      }
      return `<div class="inst-row${got ? ' got' : ''}"><b>${def.icon} ${escapeHtml(t(`institution.${id}.name`))}</b> <span class="small ${got ? 'good' : 'muted'}">${escapeHtml(state)}</span><div class="muted small">${escapeHtml(t(`institution.${id}.desc`))}</div></div>`;
    }).join('');

    // The learned: the village's posts, and its young people studying in the towns (AcademiaSystem).
    const A = sim.academia;
    const postLine = (kind) => {
      const who = A.holders(kind);
      const where = A.postBuilding(kind);
      const val = who.length ? who.map((n) => npcName(n)).join(', ') : !where ? t(`hall.post_no_place.${kind}`) : t('hall.post_vacant', { field: t(`knowledge.${POSTS[kind].field}`), n: POSTS[kind].min });
      return kv(t(`hall.post.${kind}`), escapeHtml(val));
    };
    const students = A.students().map((n) => t('hall.student_line', { npc: npcName(n), field: t(`knowledge.${n.away.degree}`), settlement: t(`settlement_name.${n.away.study}`) }));
    // You: found a school, a trade school or an institute; pay for a gifted youngster's studies.
    const St = sim.study;
    const found = Object.keys(FOUNDABLE).map((type) => {
      const c = St.canFound(type);
      return button(t('hall.found', { vbuilding: t(`vbuilding.${type}`), money: fmtMoney(St.foundCost(type)) }), 'found', { type }, { disabled: !c.ok, title: c.ok ? '' : tr(sim, `reason.${c.reason}`, c.params || {}) });
    }).join('');
    const could = sim.state.npcs.map((n) => [n, St.sponsorable(n)]).filter(([, s]) => s).map(([n, s]) => `<div class="kv"><span>${escapeHtml(t('hall.could_study', { npc: npcName(n), field: t(`knowledge.${s.degree}`), settlement: t(`settlement_name.${s.uni}`) }))}</span>${button(t('hall.sponsor', { money: fmtMoney(s.cost) }), 'sponsor', { id: n.id }, { disabled: sim.state.player.money < s.cost })}</div>`).join('');
    const yours = `<div class="btn-row">${found}</div>${could ? `<div class="muted small">${escapeHtml(t('hall.could_study_hint'))}</div>${could}` : ''}`;
    const learned = `<h3>${escapeHtml(t('hall.learned'))}</h3>${yours}${postLine('doctor')}${postLine('engineer')}${postLine('researcher')}${kv(t('hall.students'), escapeHtml(students.length ? students.join('; ') : t('hall.no_students')))}${this.sim.state.education?.alumni?.length ? kv(t('hall.alumni'), this.sim.state.education.alumni.length) : ''}<div class="muted small">${escapeHtml(t('hall.learned_hint'))}</div>`;

    // The bank.
    const p = sim.state.player;
    const bank = C.has('bank')
      ? `<h3>💰 ${escapeHtml(t('institution.bank.name'))}</h3>${kv(t('hall.savings'), fmtMoney(p.bank || 0))}<div class="row">${button(t('hall.deposit', { money: fmtMoney(50) }), 'deposit', { n: 50 }, { disabled: p.money < 50 })}${button(t('hall.withdraw_money', { money: fmtMoney(50) }), 'withdraw', { n: 50 }, { disabled: (p.bank || 0) < 1 })}</div><div class="muted small">${escapeHtml(t('hall.bank_hint'))}</div>`
      : '';

    // Your family's legacy.
    const L = sim.legacy;
    const deeds = L.deeds()
      .slice(-8)
      .reverse()
      .map((d) => `<div class="chron"><span class="chron-date">${escapeHtml(dateString(d.day))}</span> ${escapeHtml(deedText(sim, d))}</div>`)
      .join('');
    const legacy = `
      <h3>${escapeHtml(t('hall.legacy'))}</h3>
      ${kv(t('hall.renown'), `${escapeHtml(t(`renown.${L.tier()}`))} (${L.renown()})`)}
      <div class="chronicle">${deeds || `<div class="muted small">${escapeHtml(t('hall.no_deeds'))}</div>`}</div>
      <div class="muted small">${escapeHtml(t('hall.legacy_hint'))}</div>`;

    return `<div class="char-cols"><div class="col">${status}${government}${affairs}</div><div class="col"><h3>${escapeHtml(t('hall.institutions'))}</h3>${inst}${learned}${bank}${legacy}</div></div>`;
  }

  /** Public works: the fund, what it did last, the village's roads, cobbles, bridges, lamps and wells (InfrastructureSystem). */
  worksHtml() {
    const sim = this.sim;
    const I = sim.infra;
    if (!I) return '';
    const st = I.stats();
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;
    const last = I.S.log.filter((l) => l.by === 'village').slice(-3).reverse().map((l) => `<div class="small"><span class="muted">${escapeHtml(dateString(l.day))}</span> ${escapeHtml(tr(sim, `infra_log.${l.k}`, { n: l.n }))}</div>`).join('');
    return `<h3>${escapeHtml(t('infra_ui.works'))}</h3>
      ${kv(t('infra_ui.fund'), fmtMoney(I.S.fund))}
      ${kv(t('infra_ui.network'), escapeHtml(t('infra_ui.summary', { roads: st.roads, paved: st.paved, bridges: st.bridges, lamps: st.lamps, linked: st.linked, homes: st.homes })))}
      ${kv(t('infra_ui.wells'), st.wells)}${st.carting ? kv(t('infra_ui.carting'), '✓') : ''}
      ${last || `<div class="muted small">${escapeHtml(t('infra_ui.nothing_yet'))}</div>`}
      <div class="row">${button(t('infra_ui.give', { money: fmtMoney(50) }), 'give_works', { n: 50 }, { disabled: sim.state.player.money < 50 })}</div>
      <div class="muted small">${escapeHtml(t('infra_ui.works_hint'))}</div>
      ${this.developersHtml()}`;
  }

  /** Villagers developing the valley themselves (DevelopmentSystem): lots bought for homes, rows of houses, land held. */
  developersHtml() {
    const sim = this.sim;
    const rows = sim.state.npcs
      .filter((n) => n.landPlan)
      .map((n) => {
        const p = n.landPlan;
        const text = p.k === 'develop' ? tr(sim, 'dev_ui.row', { npc: n.id, built: (p.built || []).length, n: p.n }) : p.k === 'home' ? tr(sim, 'dev_ui.lot', { npc: n.id }) : tr(sim, 'dev_ui.hold', { npc: n.id, plot: p.plot });
        return `<div class="small">🏗️ ${escapeHtml(text)}</div>`;
      })
      .join('');
    return `<h3>${escapeHtml(t('dev_ui.villagers_building'))}</h3>${rows || `<div class="muted small">${escapeHtml(t('dev_ui.none'))}</div>`}`;
  }

  onAction(action, data) {
    const C = this.sim.civic;
    switch (action) {
      case 'give_works':
        if (this.sim.state.player.money >= data.n) {
          this.sim.state.player.money -= Number(data.n);
          this.sim.infra.S.fund += Number(data.n);
          this.sim.progression.addReputation(1);
          this.sim.bus.emit('player:changed');
        }
        break;
      case 'found':
        this.sim.study.found(data.type);
        break;
      case 'sponsor': {
        const n = this.sim.npcs.byId(data.id);
        if (n) this.sim.study.sponsor(n);
        break;
      }
      case 'stand':
        C.stand(data.on === '1');
        break;
      case 'policy':
        C.setPolicy(data.kind, data.lv);
        break;
      case 'project':
        C.setProject(data.id);
        break;
      case 'deposit':
        C.deposit(Number(data.n));
        break;
      case 'withdraw':
        C.withdraw(Number(data.n));
        break;
    }
  }
}

