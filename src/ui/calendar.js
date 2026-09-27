/**
 * What's coming up — for the Calendar screen and the HUD's "Today" card. Read from the systems (nothing of its
 * own): festivals, market days, town meetings and the election, weddings and funerals, your friends' name
 * days, orders from other towns and their deadlines, the traders' goods ready for you, your rent.
 *
 *   upcoming(sim, days) → [{ day, hour?, icon, key, params, kind }]   (sorted by day, then hour)
 *   todayLines(sim)     → up to five of today's (and tomorrow's most pressing), plus the best-paid work
 */
import { FESTIVALS } from '../systems/FestivalSystem.js';
import { t } from '../i18n/i18n.js';
import { COMMUNITY } from '../systems/CommunitySystem.js';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

export function upcoming(sim, days = 14) {
  const T = sim.time;
  const today = T.day;
  const out = [];
  const add = (day, icon, key, params = {}, hour = null, kind = 'event') => {
    if (day >= today && day < today + days) out.push({ day, hour, icon, key, params, kind });
  };
  for (let d = today; d < today + days; d++) {
    const season = SEASONS[Math.floor(d / 14) % 4];
    const dos = (d % 14) + 1;
    // Festivals on the square.
    for (const [id, f] of Object.entries(FESTIVALS)) if (f.season === season && f.day === dos) add(d, f.icon || '🎉', 'cal.festival', { fest: t(`festival.${id}.name`) }, f.hours[0], 'festival');
    // Market day.
    if (d % 7 === COMMUNITY.market.weekday) add(d, '🧺', 'cal.market', {}, COMMUNITY.market.from, 'market');
    // Friends' and family's name days.
    for (const n of sim.state.npcs) {
      if (n.age < 3 || !sim.community || sim.community.nameDayOf(n) !== d % 56) continue;
      const close = (n.rel || 0) >= 30 || (sim.lineage?.children?.() || []).some((c) => c.id === n.id);
      if (close) add(d, '🎂', 'cal.name_day', { npc: n.id }, null, 'people');
    }
  }
  // Weddings and funerals.
  for (const e of sim.community?.upcoming() || []) add(e.day, e.kind === 'wedding' ? '💐' : '🕯️', `cal.${e.kind}`, { npc: e.host[0], npc2: e.host[1] }, e.from, 'people');
  // The town meeting, the election.
  const m = sim.state.town?.meeting;
  if (m) add(m.day, '🏛️', 'cal.meeting', { proposal: m.proposal }, 18, 'village');
  const el = sim.state.civic?.nextElection;
  if (el !== undefined) add(el, '🗳️', 'cal.election', {}, null, 'village');
  // Orders from other towns you've taken on: when they're due.
  for (const o of sim.townOrders?.open() || []) if (o.taken) add(o.deadline, '📜', 'cal.order_due', { settlement: o.town, item: o.item, n: o.qty - o.delivered }, null, 'you');
  // The traders' goods you ordered: the next market day they're due.
  for (const o of sim.state.community?.traderOrders || []) {
    if (o.collected) continue;
    const due = o.due * 7 + COMMUNITY.market.weekday;
    add(Math.max(today, due), '📦', 'cal.trader_order', { item: o.item, qty: o.qty }, COMMUNITY.market.from, 'you');
  }
  // Rent.
  const rent = sim.state.player.rent;
  if (rent?.nextDueDay !== undefined && sim.state.player.homeId === 'shack') for (let d = rent.nextDueDay; d < today + days; d += 7) add(d, '🏠', 'cal.rent', { money: rent.amount || 0 }, null, 'you');
  return out.sort((a, b) => a.day - b.day || (a.hour ?? 99) - (b.hour ?? 99));
}

/** The HUD's "Today": what's on today (and anything pressing tomorrow), and the best-paid work. */
export function todayLines(sim) {
  const today = sim.time.day;
  const list = upcoming(sim, 2).filter((e) => e.day === today || (e.day === today + 1 && ['you', 'village'].includes(e.kind)));
  const out = list.slice(0, 4).map((e) => ({ ...e, tomorrow: e.day !== today }));
  const best = sim.jobs?.advice?.().find((a) => a.now);
  if (best) out.push({ icon: '💡', key: best.kind === 'job' ? 'cal.best_pay' : 'cal.best_pay_other', params: { job: best.kind === 'job' ? best.id : undefined, money: Math.round(best.perHour) }, kind: 'pay', best });
  return out;
}
