/**
 * Dialogue — talking to a villager.
 *
 * What they say comes from the simulation: their job, mood, money, the
 * weather, prices at the store, and recent village news (gossip).
 */
import { Panel } from '../Panel.js';
import { t, tPick, npcName, occupationName, itemName, fmtMoney, cap } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel, workLabel, resolveParams, goalWhyText } from '../format.js';
import { button, portrait, hearts, icon } from '../widgets.js';
import { ITEMS } from '../../data/items.js';
import { JobBoardPanel } from './JobBoardPanel.js';
import { GOAL_AGAINST } from '../../data/goals.js';

export class DialoguePanel extends Panel {
  constructor(ui, npcId) {
    super(ui);
    this.npc = this.sim.npcs.byId(npcId);
    this.view = 'main';
    const firstMeeting = !this.npc.met;
    this.sim.social.meet(this.npc);
    this.line = firstMeeting ? this.say('dialog.intro', { occ: this.npc.occupation }) : this.greeting();
  }
  get id() {
    return 'dialogue';
  }

  onOpen() {
    this.sim.npcs.setTalking(this.npc, true);
  }
  onClose() {
    this.sim.npcs.setTalking(this.npc, false);
  }

  /** Localized line with this NPC's gender and the player's name available. */
  say(key, params = {}) {
    const p = { gender: this.npc.gender, ...params };
    return tPick(key, { player: npcName(this.sim.state.player), name: npcName(this.npc), ...resolveParams(this.sim, p) });
  }

  ownedBusiness() {
    return this.npc.owns;
  }

  greeting() {
    const npc = this.npc;
    const h = this.sim.time.hour;
    if (npc.task?.type === 'sleep') return this.say('dialog.sleepy');
    if (npc.hunger < 20) return this.say('dialog.hungry');
    const kin = this.sim.family.kinship(npc, this.sim.lineage.person());
    const p = this.sim.state.player;
    if (kin === 'spouse' || kin === 'sibling') return this.say(`dialog.greet.kin_${kin}`);
    if (kin === 'parent' || kin === 'grandparent') return this.say(`dialog.greet.kin_${kin}_${p.gender}`);
    if (kin === 'child' || kin === 'grandchild') return this.say(`dialog.greet.kin_${kin}`);
    if (p.partner === npc.id) return this.say('dialog.greet.partner');
    const tier = this.sim.social.tier(npc);
    // Someone who distrusts you skips the pleasantries.
    if (tier === 'wary' || tier === 'hostile') return this.say(`dialog.greet.${tier}`);
    const tod = h < 12 ? 'morning' : h < 18 ? 'day' : 'evening';
    return `${this.say(`dialog.hello.${tod}`)} ${this.say(`dialog.greet.${tier}`)}`;
  }

  /** Something to talk about, generated from the villager's actual life (see DialogueSystem). */
  topicLine(mode = 'chat') {
    const topic = this.sim.dialogue.pick(this.npc, mode);
    return this.say(topic.key, topic.params);
  }

  title() {
    return `💬 ${escapeHtml(npcName(this.npc))}`;
  }

  render() {
    const sim = this.sim;
    const npc = this.npc;
    const tier = sim.social.tier(npc);
    const occ = cap(occupationName(npc.occupation, npc.gender));
    const head = `
      <div class="dlg-head">
        ${portrait(`npc_${sim.state.seed}_${npc.id}`, npc.look, 80)}
        <div>
          <div class="dlg-name">${escapeHtml(npcName(npc))}</div>
          <div class="muted">${escapeHtml(occ)} · ${escapeHtml(t('ui.level_n', { level: npc.level }))} · ${escapeHtml(t('ui.age_n', { age: npc.age }))}</div>
          <div class="dlg-rel">${escapeHtml(t(`rel_tier.${tier}`))} ${hearts(npc.rel)}</div>
          <div class="chips">${npc.traits.map((tr_) => `<span class="chip" title="${escapeHtml(t(`trait.${tr_}.desc`))}">${escapeHtml(t(`trait.${tr_}.name`))}</span>`).join('')}</div>
        </div>
      </div>
      <div class="dlg-line">“${escapeHtml(this.line)}”</div>`;
    return head + `<div class="dlg-options">${this.renderOptions()}</div>`;
  }

  renderOptions() {
    const sim = this.sim;
    const npc = this.npc;
    const opts = [];
    let n = 1;
    const opt = (label, action, data = {}, disabled = false, note = '') =>
      opts.push(`<div class="dlg-opt${disabled ? ' disabled' : ''}" data-action="${action}" data-hotkey="${n}" ${Object.entries(data).map(([k, v]) => `data-${k}="${escapeHtml(v)}"`).join(' ')}><kbd>${n++}</kbd>${escapeHtml(label)}${note ? `<span class="note">${escapeHtml(note)}</span>` : ''}</div>`);

    if (this.view === 'main') {
      const canChat = sim.social.canChat(npc);
      opt(t('dialog.opt.chat'), 'chat', {}, false, canChat ? '' : t('dialog.opt.chat_done'));
      opt(t('dialog.opt.news'), 'news');
      opt(t('dialog.opt.life'), 'life');
      if (npc.age >= 16) {
        // Someone packing to leave gets asked about it first.
        const leaving = npc.goal?.type === 'leave' && npc.goal.packDay;
        opt(t(leaving ? 'dialog.opt.plans_leaving' : 'dialog.opt.plans'), 'plans');
      }
      opt(t('dialog.opt.work'), 'work');
      const req = sim.jobs.requestFor(npc.id);
      if (req && !req.accepted) opt(t('dialog.opt.help'), 'request');
      if (req && req.accepted) {
        const ok = sim.jobs.canFulfill(req);
        opt(tr(sim, 'dialog.opt.give_request', { qty: req.qty, item: req.item }), 'fulfill', { id: req.id }, !ok, ok ? '' : t('dialog.opt.have_n', { have: sim.inventory.count(req.item), qty: req.qty }));
      }
      opt(t('dialog.opt.gift'), 'gift_menu', {}, !sim.social.canGift(npc), sim.social.canGift(npc) ? '' : t('dialog.opt.gift_done'));
      // A house of yours standing empty: ask if they'd like to rent it (LettingSystem).
      if (npc.age >= 18 && npc.homeId !== sim.state.player.homeId && Object.keys(sim.property.all).some((id) => sim.letting.lettable(id))) opt(t('dialog.opt.offer_house'), 'offer_house', {}, npc.houseAskedDay === sim.time.day, npc.houseAskedDay === sim.time.day ? t('dialog.opt.asked_already') : '');
      // Learning from them, teaching them, paying for their studies (StudySystem).
      const St = sim.study;
      const tut = St.tutoring(npc);
      if (tut && npc.age >= 18) {
        const c = St.canTutor(npc);
        opt(tr(sim, 'dialog.opt.ask_lessons', { field: tut.field, money: tut.fee }), 'ask_lessons', {}, !c.ok, c.ok ? '' : tr(sim, `reason.${c.reason}`, c.params || {}));
      }
      if (St.masterTrade(npc) && !St.e.apprentice) {
        const c = St.canAskApprentice(npc);
        opt(tr(sim, 'dialog.opt.ask_apprentice', { field: St.masterTrade(npc).field }), 'ask_apprentice', {}, !c.ok, c.ok ? '' : tr(sim, `reason.${c.reason}`, c.params || {}));
      }
      if (St.yourTrade() && sim.careers.seekers().includes(npc) && !npc.apprentice) {
        const c = St.canTakeApprentice(npc);
        opt(tr(sim, 'dialog.opt.offer_apprentice', { field: St.yourTrade().field }), 'offer_apprentice', {}, !c.ok, c.ok ? '' : tr(sim, `reason.${c.reason}`, c.params || {}));
      }
      const spon = St.sponsorable(npc);
      if (spon) {
        const c = St.canSponsor(npc);
        opt(tr(sim, 'dialog.opt.offer_sponsor', { money: spon.cost, settlement: spon.uni }), 'offer_sponsor', {}, !c.ok, c.ok ? '' : tr(sim, `reason.${c.reason}`, c.params || {}));
      }
      const L = sim.lineage;
      if (sim.state.player.partner === npc.id) {
        const c = L.canPropose(npc);
        opt(t('dialog.opt.propose'), 'propose', {}, !c.ok, c.ok ? '' : t(`reason.love_${c.reason || 'not_ready'}`));
      } else if (L.canCourt(npc).ok && npc.courtRefusedDay !== sim.time.day) opt(t('dialog.opt.court'), 'court');
      if (sim.workers.contract(npc.id)) {
        opt(t('dialog.opt.how_is_work'), 'how_work');
        opt(t('dialog.opt.manage_workers'), 'manage');
      } else if (npc.age >= 16 && !['child', 'elder'].includes(npc.occupation) && !npc.owns) {
        const chk = sim.workers.canHire(npc);
        opt(t('dialog.opt.hire'), 'hire_view', {}, !chk.ok, chk.ok ? '' : tr(sim, `reason.${chk.reason}`, chk.params || {}));
      }
      const biz = this.ownedBusiness();
      if (biz && sim.economy.def(biz).kind === 'shop') {
        const open = sim.economy.isOpen(biz);
        opt(t('dialog.opt.trade'), 'trade', {}, !open, open ? '' : tr(sim, 'reason.closed', { hour: sim.economy.def(biz).openHours[0] }));
      }
      opt(t('dialog.opt.about'), 'about');
      opt(t('dialog.opt.bye'), 'close');
      return opts.join('');
    }

    if (this.view === 'hire') {
      const expected = sim.workers.expectedSalary(npc);
      const low = Math.max(1, Math.round(expected * 0.85));
      opt(t('dialog.opt.hire_at', { money: fmtMoney(expected) }), 'hire_offer', { salary: expected });
      opt(t('dialog.opt.hire_haggle', { money: fmtMoney(low) }), 'hire_offer', { salary: low });
      opt(t('dialog.opt.never_mind'), 'back');
      return opts.join('');
    }

    if (this.view === 'request') {
      const req = sim.jobs.requestFor(npc.id);
      opt(t('dialog.opt.accept_request'), 'accept_request', { id: req?.id });
      opt(t('dialog.opt.decline'), 'back');
      return opts.join('');
    }

    if (this.view === 'gift') {
      const items = sim.inventory.slots.filter((s) => !ITEMS[s.id].tool && !ITEMS[s.id].questItem);
      const seen = new Set();
      for (const s of items) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        opts.push(`<div class="dlg-opt" data-action="give_gift" data-item="${s.id}" data-hotkey="${n}"><kbd>${n++}</kbd>${icon(s.id, 20)} ${escapeHtml(itemName(s.id))} ×${sim.inventory.count(s.id)}</div>`);
      }
      if (!seen.size) opts.push(`<div class="muted">${escapeHtml(t('dialog.no_gifts'))}</div>`);
      opt(t('dialog.opt.back'), 'back');
      return opts.join('');
    }

    if (this.view === 'about') {
      opts.push(this.renderAbout());
      opt(t('dialog.opt.back'), 'back');
      return opts.join('');
    }

    if (this.view === 'plans') {
      // Why they want it (only people who trust you tell you that much).
      const g = sim.dialogue.goal(npc);
      const why = g.why.filter((w) => !GOAL_AGAINST.includes(w)).slice(0, 4);
      if (why.length) opts.push(`<div class="plans muted small goal-why">${escapeHtml(t('ui.goal_because'))} ${escapeHtml(why.map((w) => goalWhyText(npc, w)).join(' · '))}</div>`);
      for (const h of sim.goals.helpOptions(npc)) {
        if (h.kind === 'back') opt(t('dialog.opt.back_business', { money: fmtMoney(h.amount), n: Math.round(h.share * 100) }), 'back_business', {}, !h.ok, h.ok ? '' : t('reason.no_money', { money: fmtMoney(h.amount) }));
        if (h.kind === 'stay') opt(t('dialog.opt.ask_stay'), 'ask_stay', {}, !h.ok, h.ok ? '' : t('dialog.opt.asked_already'));
      }
      // Out of work, or after a better job: you could be the answer.
      if (['job', 'better_job', 'leave'].includes(g.type) && !sim.workers.contract(npc.id) && !npc.owns && sim.workers.canHire(npc).ok) opt(t('dialog.opt.offer_job'), 'hire_view');
      opt(t('dialog.opt.back'), 'back');
      return opts.join('');
    }

    opt(t('dialog.opt.back'), 'back');
    return opts.join('');
  }

  renderAbout() {
    const sim = this.sim;
    const npc = this.npc;
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`;
    const work = workLabel(sim, npc);
    const family = npc.family.map((id) => npcName(sim.npcs.byId(id))).join(', ') || '—';
    const friend = sim.social.bestFriend(npc);
    const wealth = npc.money > 150 ? 'rich' : npc.money > 50 ? 'comfortable' : npc.money > 15 ? 'modest' : 'poor';
    return `<div class="about">
      ${kv(t('ui.home'), buildingLabel(sim, npc.homeId))}
      ${kv(t('ui.work'), work)}
      ${kv(t('ui.family'), family)}
      ${kv(t('ui.best_friend'), friend ? npcName(friend) : '—')}
      ${kv(t('ui.wealth'), t(`wealth.${wealth}`))}
      <p class="desc">“${escapeHtml(this.goalLine())}”</p>
    </div>`;
  }

  /** What they say about their plans (the goal the GoalSystem worked out for them). */
  goalLine() {
    const g = this.sim.dialogue.goal(this.npc);
    const key = g.type === 'leave' && g.packing ? 'leave_packing' : g.type;
    return this.say(`talk.goal.${key}`, { money: g.saved, money2: g.target, occ: this.npc.occupation, biz_type: g.biz || undefined });
  }

  onAction(action, data) {
    const sim = this.sim;
    const npc = this.npc;
    switch (action) {
      case 'chat':
        if (sim.social.chat(npc)) this.line = this.topicLine('chat');
        else this.line = this.say('dialog.chat_again');
        break;
      case 'news':
        this.line = this.topicLine('news');
        break;
      case 'court':
        if (sim.lineage.court(npc)) this.line = this.say('dialog.court_yes');
        else {
          npc.courtRefusedDay = sim.time.day;
          this.line = this.say('dialog.court_no');
        }
        break;
      case 'propose':
        this.line = this.say(sim.lineage.propose(npc) ? 'dialog.propose_yes' : 'dialog.propose_no');
        break;
      case 'life':
        this.line = this.topicLine('life');
        break;
      case 'plans': {
        if (!sim.dialogue.isOpen(npc)) {
          this.line = this.say('talk.deflect');
          break;
        }
        this.line = this.goalLine();
        this.view = 'plans';
        break;
      }
      case 'back_business': {
        const r = sim.goals.back(npc);
        this.line = r.ok ? this.say('dialog.backed_thanks', { money: r.amount }) : tr(sim, `reason.${r.reason}`, r.params || {});
        break;
      }
      case 'ask_stay': {
        const r = sim.goals.askToStay(npc);
        this.line = this.say(r.stays ? 'dialog.stay_yes' : 'dialog.stay_no');
        if (r.stays) this.view = 'main';
        break;
      }
      case 'work': {
        const biz = this.ownedBusiness();
        if (biz && sim.jobs.jobsForBusiness(biz).length) {
          this.ui.openPanel(new JobBoardPanel(this.ui, biz, npc.id));
          return;
        }
        const employers = sim.economy.active().map((id) => [id, sim.economy.def(id)]).filter(([id]) => sim.jobs.jobsForBusiness(id).some((j) => (sim.state.jobs.openings[j] || 0) > 0));
        if (employers.length) {
          const [bizId, def] = employers[Math.floor(Math.random() * employers.length)];
          this.line = this.say('dialog.work_hint', { npc: sim.economy.ownerId(bizId), building: def.building });
        } else this.line = this.say('dialog.work_none');
        break;
      }
      case 'request': {
        const req = sim.jobs.requestFor(npc.id);
        if (!req) break;
        this.line = this.say(req.reward > 0 ? 'dialog.request_ask' : 'dialog.request_ask_free', { qty: req.qty, item: req.item, money: req.reward });
        this.view = 'request';
        break;
      }
      case 'accept_request':
        sim.jobs.acceptRequest(Number(data.id));
        this.line = this.say('dialog.request_thanks');
        this.view = 'main';
        break;
      case 'fulfill':
        if (sim.jobs.fulfill(Number(data.id))) this.line = this.say('dialog.request_done');
        break;
      case 'gift_menu':
        this.view = 'gift';
        break;
      case 'ask_lessons': {
        const c = sim.study.canTutor(npc);
        if (!c.ok) break;
        this.ui.closePanel();
        this.ui.scene.study('tutor', npc.id);
        return;
      }
      case 'ask_apprentice': {
        const r = sim.study.askApprentice(npc);
        this.line = r.ok ? this.say('dialog.apprentice_yes', { field: r.field }) : this.say('dialog.apprentice_no');
        break;
      }
      case 'offer_apprentice': {
        const r = sim.study.takeApprentice(npc);
        this.line = r.ok ? this.say('dialog.become_apprentice_yes', { field: r.field, money: r.salary }) : this.say('dialog.become_apprentice_no');
        break;
      }
      case 'offer_sponsor': {
        const r = sim.study.sponsor(npc);
        this.line = r.ok ? this.say('dialog.sponsor_yes', { settlement: r.uni, field: r.degree }) : this.say('dialog.sponsor_no');
        break;
      }
      case 'offer_house': {
        npc.houseAskedDay = sim.time.day;
        const r = sim.letting.ask(npc);
        this.line = r.ok ? this.say('dialog.let_yes', { building: r.building, money: sim.property.weeklyRent(r.building) }) : this.say(`dialog.let_no.${r.reason}`, { building: r.building });
        break;
      }
      case 'give_gift': {
        const r = sim.social.gift(npc, data.item);
        if (r) this.line = this.say(r.liked ? 'dialog.gift_love' : 'dialog.gift_ok', { item: data.item });
        this.view = 'main';
        break;
      }
      case 'trade':
        this.ui.openShop(this.ownedBusiness());
        return;
      case 'about':
        this.view = 'about';
        this.line = this.say('dialog.about_intro');
        break;
      case 'hire_view': {
        const expected = sim.workers.expectedSalary(npc);
        this.line = this.say(npc.employer ? 'dialog.hire_employed' : 'dialog.hire_ask', { money: expected });
        this.view = 'hire';
        break;
      }
      case 'hire_offer': {
        const r = sim.workers.offer(npc, Number(data.salary));
        if (r.accepted) {
          this.line = this.say('dialog.hire_yes');
          this.view = 'main';
        } else {
          this.line = r.reason === 'offer_refused' ? this.say('dialog.hire_no') : tr(sim, `reason.${r.reason}`, r.params || {});
          this.view = 'main';
        }
        break;
      }
      case 'how_work': {
        const c = sim.workers.contract(npc.id);
        const key = c.unpaid > 0 ? 'dialog.worker_unpaid' : c.satisfaction >= 70 ? 'dialog.worker_happy' : c.satisfaction >= 40 ? 'dialog.worker_ok' : 'dialog.worker_raise';
        this.line = this.say(key, { money: sim.workers.expectedSalary(npc, c.rank) });
        break;
      }
      case 'manage':
        this.ui.openWorkers();
        return;
      case 'back':
        this.view = 'main';
        break;
    }
  }
}
