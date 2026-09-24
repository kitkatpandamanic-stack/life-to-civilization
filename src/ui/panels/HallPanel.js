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
      .map((m) => (m.k === 'pop' ? t('hall.need_pop', { n: m.v }) : m.k === 'institutions' ? tn('hall.need_institutions', m.v) : t('hall.need_institution', { institution: t(`institution.${m.v}.name`) })))
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
      ${kv(t('hall.treasury'), fmtMoney(village.treasury))}
      ${tax ? kv(t('hall.taxes_week'), fmtMoney(tax.business + tax.property)) : ''}
      ${kv(t('hall.saving_for'), projectLine)}
      ${projectPick}
      <div class="muted small">${escapeHtml(t(mine ? 'hall.headman_hint' : 'hall.policy_hint'))}</div>`;

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

    return `<div class="char-cols"><div class="col">${status}${government}${affairs}</div><div class="col"><h3>${escapeHtml(t('hall.institutions'))}</h3>${inst}${bank}${legacy}</div></div>`;
  }

  onAction(action, data) {
    const C = this.sim.civic;
    switch (action) {
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

