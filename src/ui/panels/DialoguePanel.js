/**
 * Dialogue — talking to a villager.
 *
 * What they say comes from the simulation: their job, mood, money, the
 * weather, prices at the store, and recent village news (gossip).
 */
import { Panel } from '../Panel.js';
import { t, tPick, npcName, occupationName, itemName, fmtMoney, cap } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel } from '../format.js';
import { button, portrait, hearts, icon } from '../widgets.js';
import { ITEMS } from '../../data/items.js';
import { BUSINESSES } from '../../data/businesses.js';
import { JobBoardPanel } from './JobBoardPanel.js';

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
    return tPick(key, { gender: this.npc.gender, player: this.sim.state.player.name, name: npcName(this.npc), ...this.resolve(params) });
  }
  resolve(params) {
    const out = {};
    for (const [k, v] of Object.entries(params)) {
      if (k === 'item') out.item = itemName(v);
      else if (k === 'occ') out.occ = occupationName(v, this.npc.gender);
      else if (k.startsWith('npc')) out[k] = npcName(this.sim.npcs.byId(v));
      else if (k === 'money') out.money = fmtMoney(v);
      else if (k === 'building') out.building = buildingLabel(this.sim, v);
      else out[k] = v;
    }
    return out;
  }

  ownedBusiness() {
    return this.npc.owns;
  }

  greeting() {
    const npc = this.npc;
    const h = this.sim.time.hour;
    if (npc.task?.type === 'sleep') return this.say('dialog.sleepy');
    if (npc.hunger < 20) return this.say('dialog.hungry');
    const tier = this.sim.social.tier(npc);
    const tod = h < 12 ? 'morning' : h < 18 ? 'day' : 'evening';
    return `${this.say(`dialog.hello.${tod}`)} ${this.say(`dialog.greet.${tier}`)}`;
  }

  /** Something to talk about, chosen from what's actually going on. */
  chatLine() {
    const sim = this.sim;
    const npc = this.npc;
    const pool = [];
    const news = sim.state.chronicle.filter((e) => sim.time.day - e.day <= 5 && !Object.values(e.params).includes(npc.id) && e.key !== 'chronicle.player_arrived');
    if (news.length) {
      const e = news[Math.floor(Math.random() * news.length)];
      pool.push(`${this.say('dialog.gossip_prefix')} ${tr(sim, e.key, e.params)}`);
    }
    pool.push(this.say(`dialog.occ.${npc.occupation}`));
    pool.push(this.say(`dialog.weather.${sim.weather.type}`));
    pool.push(this.say(`dialog.season.${sim.time.season}`));
    const prices = sim.economy.priceNews();
    if (prices.expensive.length) pool.push(this.say('dialog.price_high', { item: prices.expensive[0] }));
    if (prices.cheap.length) pool.push(this.say('dialog.price_low', { item: prices.cheap[0] }));
    if (npc.money < 10 && npc.age >= 16) pool.push(this.say('dialog.poor'));
    if (npc.unpaidDays > 0) pool.push(this.say('dialog.unpaid'));
    if (npc.pantry <= 0 && npc.age >= 16) pool.push(this.say('dialog.empty_pantry'));
    const trait = npc.traits[Math.floor(Math.random() * npc.traits.length)];
    if (trait) pool.push(this.say(`dialog.trait.${trait}`));
    const friend = sim.social.bestFriend(npc);
    if (friend) pool.push(this.say(npc.family.includes(friend.id) ? 'dialog.family' : 'dialog.friend', { npc: friend.id }));
    return pool[Math.floor(Math.random() * pool.length)];
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
      opt(t('dialog.opt.work'), 'work');
      const req = sim.jobs.requestFor(npc.id);
      if (req && !req.accepted) opt(t('dialog.opt.help'), 'request');
      if (req && req.accepted) {
        const ok = sim.jobs.canFulfill(req);
        opt(tr(sim, 'dialog.opt.give_request', { qty: req.qty, item: req.item }), 'fulfill', { id: req.id }, !ok, ok ? '' : t('dialog.opt.have_n', { have: sim.inventory.count(req.item), qty: req.qty }));
      }
      opt(t('dialog.opt.gift'), 'gift_menu', {}, !sim.social.canGift(npc), sim.social.canGift(npc) ? '' : t('dialog.opt.gift_done'));
      const biz = this.ownedBusiness();
      if (biz && BUSINESSES[biz].kind === 'shop') {
        const open = sim.economy.isOpen(biz);
        opt(t('dialog.opt.trade'), 'trade', {}, !open, open ? '' : tr(sim, 'reason.closed', { hour: BUSINESSES[biz].openHours[0] }));
      }
      opt(t('dialog.opt.about'), 'about');
      opt(t('dialog.opt.bye'), 'close');
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

    opt(t('dialog.opt.back'), 'back');
    return opts.join('');
  }

  renderAbout() {
    const sim = this.sim;
    const npc = this.npc;
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`;
    const work = npc.owns ? t('ui.owner_of', { place: buildingLabel(sim, BUSINESSES[npc.owns].building) }) : npc.employer ? buildingLabel(sim, BUSINESSES[npc.employer].building) : '—';
    const family = npc.family.map((id) => npcName(sim.npcs.byId(id))).join(', ') || '—';
    const friend = sim.social.bestFriend(npc);
    const wealth = npc.money > 150 ? 'rich' : npc.money > 50 ? 'comfortable' : npc.money > 15 ? 'modest' : 'poor';
    const goal = npc.traits.includes('entrepreneur') || npc.traits.includes('ambitious') ? 'dialog.goal.business' : npc.occupation === 'unemployed' ? 'dialog.goal.job' : npc.occupation === 'child' ? 'dialog.goal.grow' : 'dialog.goal.steady';
    return `<div class="about">
      ${kv(t('ui.home'), buildingLabel(sim, npc.homeId))}
      ${kv(t('ui.work'), work)}
      ${kv(t('ui.family'), family)}
      ${kv(t('ui.best_friend'), friend ? npcName(friend) : '—')}
      ${kv(t('ui.wealth'), t(`wealth.${wealth}`))}
      <p class="desc">“${escapeHtml(this.say(goal))}”</p>
    </div>`;
  }

  onAction(action, data) {
    const sim = this.sim;
    const npc = this.npc;
    switch (action) {
      case 'chat':
        if (sim.social.chat(npc)) this.line = this.chatLine();
        else this.line = this.say('dialog.chat_again');
        break;
      case 'work': {
        const biz = this.ownedBusiness();
        if (biz && sim.jobs.jobsForBusiness(biz).length) {
          this.ui.openPanel(new JobBoardPanel(this.ui, biz, npc.id));
          return;
        }
        const employers = Object.entries(BUSINESSES).filter(([id]) => sim.jobs.jobsForBusiness(id).some((j) => (sim.state.jobs.openings[j] || 0) > 0));
        if (employers.length) {
          const [, def] = employers[Math.floor(Math.random() * employers.length)];
          this.line = this.say('dialog.work_hint', { npc: def.owner, building: def.building });
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
      case 'back':
        this.view = 'main';
        break;
    }
  }
}
