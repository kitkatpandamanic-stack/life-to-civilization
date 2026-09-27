/**
 * NewsSystem — the valley's newspaper. Every week (on the sixth day) an issue comes out: the week's biggest
 * news from the chronicle (what YOU did first), the prices of everyday goods and which way they went, the
 * week's thefts, the season to come — and the advertisements.
 *
 * Until the valley can print (TechSystem 'printing'), it's a hand-written sheet pinned to the notice board;
 * once it can, it's The Valley Gazette, printed — and you can place an advert for a business of yours:
 * for a week, more villagers choose your shop (EconomySystem.chooseShop asks adBoost).
 * When the paper tells of something you did, people take note: a little reputation.
 *
 * (It's the notice board's village news, too — its Gazette tab shows the latest issue.)
 *
 *   state.news = { issues: [{ no, day, printed, headlines: [{ key, params, day, you }], prices, thefts, ads }], ads: { bizId: untilDay }, no }
 */
import { headlineWeight } from '../data/headlines.js';

export const NEWS = {
  weekday: 6,
  headlines: 6,
  keep: 8,
  adCost: 30,
  adDays: 7,
  adBoost: 1.6, // added to an advertised shop's appeal
  youRep: 1, // a headline about you: this much reputation (up to youRepMax an issue)
  youRepMax: 2,
  prices: ['bread', 'apple', 'wheat', 'fish', 'wood', 'planks'],
  printFromPop: 30, // a village this big has a printed paper even before the printing trade comes (as the notice board's gazette always did)
};

export class NewsSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.news ??= { issues: [], ads: {}, no: 0 };
    sim.bus.on('time:day', () => sim.time.weekday === NEWS.weekday && this.publish());
  }

  get S() {
    return this.sim.state.news;
  }

  /** Can the valley print (the Gazette, with advertisements)? With the printing trade — or once it's a big enough village. */
  printed() {
    return !!this.sim.tech?.has('printing') || this.sim.state.npcs.length + 1 >= NEWS.printFromPop;
  }

  latest() {
    return this.S.issues[this.S.issues.length - 1] || null;
  }

  /** How newsworthy a chronicle entry is (data/headlines.js): your doings first, then the big news. 0: not news. */
  score(e) {
    const you = e.key.includes('player') || e.params?.npc === 'player' || e.params?.who === 'player';
    const w = headlineWeight(e.key);
    return { s: (you ? 10 : 0) + w, you };
  }

  /** The week's issue. */
  publish() {
    const sim = this.sim;
    const day = sim.time.day;
    const since = day - 7;
    const week = sim.state.chronicle.filter((e) => e.day > since && e.key !== 'chronicle.paper_out');
    const ranked = week
      .map((e, i) => ({ e, i, ...this.score(e) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || b.i - a.i)
      .slice(0, NEWS.headlines)
      .sort((a, b) => a.i - b.i)
      .map(({ e, you }) => ({ key: e.key, params: e.params, day: e.day, you }));
    const now = sim.history?.prices() || {};
    const last = this.latest()?.prices || {};
    const prices = {};
    for (const item of NEWS.prices) if (now[item] !== undefined) prices[item] = { p: now[item], was: last[item]?.p ?? null };
    const thefts = (sim.state.crime?.cases || []).filter((c) => c.day > since).length;
    const ads = Object.entries(this.S.ads).filter(([id, until]) => until >= day && sim.economy.biz(id)).map(([id]) => id);
    const woods = sim.forestry ? { status: sim.forestry.status(), h: Math.round(sim.forestry.health() * 100) } : null;
    const issue = { no: ++this.S.no, day, printed: this.printed(), headlines: ranked, prices, thefts, ads, woods };
    this.S.issues.push(issue);
    if (this.S.issues.length > NEWS.keep) this.S.issues.shift();
    // (old advertisements run out)
    for (const [id, until] of Object.entries(this.S.ads)) if (until < day) delete this.S.ads[id];
    const aboutYou = ranked.filter((h) => h.you).length;
    if (aboutYou) sim.progression.addReputation(Math.min(NEWS.youRepMax, aboutYou * NEWS.youRep));
    sim.toast(issue.printed ? 'toast.gazette_out' : 'toast.news_sheet_out', { n: issue.no }, 'info');
    return issue;
  }

  // ------------------------------------------------------------------ advertisements

  canAdvertise(bizId) {
    if (!this.printed()) return { ok: false, reason: 'no_press' };
    if (!this.sim.holdings.isMine(bizId)) return { ok: false, reason: 'not_yours' };
    if ((this.S.ads[bizId] || -1) >= this.sim.time.day) return { ok: false, reason: 'ad_running' };
    if (this.sim.state.player.money < NEWS.adCost) return { ok: false, reason: 'no_money' };
    return { ok: true };
  }

  advertise(bizId) {
    const chk = this.canAdvertise(bizId);
    if (!chk.ok) return chk;
    this.sim.state.player.money -= NEWS.adCost;
    this.S.ads[bizId] = this.sim.time.day + NEWS.adDays;
    this.sim.bus.emit('player:changed');
    return { ok: true };
  }

  /** An advertised shop's extra pull on customers (EconomySystem.chooseShop). */
  adBoost(bizId) {
    return (this.S.ads[bizId] ?? -1) >= this.sim.time.day ? NEWS.adBoost : 0;
  }
}
