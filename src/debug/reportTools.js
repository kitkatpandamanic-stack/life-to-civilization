/**
 * The economy and the village at a glance — for balancing (tools/report-year.mjs runs a whole
 * year and prints this week by week; dev.eco.report() in the browser shows it now).
 *
 *   people    — villagers, adults, homeless, out of work, their money (average, poorest quarter)
 *   economy   — businesses open / closed, the treasury, what things cost at the store
 *   work      — what a day's work pays: a job at the notice board, a hired hand's wage, a contract hour
 *   progress  — know-how, the village's standing, events, festivals
 */
import { ITEMS } from '../data/items.js';

export function snapshot(sim) {
  const npcs = sim.state.npcs;
  const adults = npcs.filter((n) => n.age >= 16);
  const money = adults.map((n) => n.money).sort((a, b) => a - b);
  const q1 = money.length ? money[Math.floor(money.length / 4)] : 0;
  const E = sim.economy;
  const store = E.ofType('general_store')[0];
  const price = (item) => Math.round((store && (E.stock(store, item) > 0 || E.def(store).sells?.includes(item)) ? E.unitPrice(store, item) : (ITEMS[item]?.basePrice || 0) * (E.priceFactor?.(store, item) || 1)) * 10) / 10;
  const active = E.active();
  const types = {};
  for (const id of active) types[E.def(id).type] = (types[E.def(id).type] || 0) + 1;
  return {
    day: sim.time.day,
    pop: npcs.length,
    adults: adults.length,
    homeless: adults.filter((n) => !n.homeId || n.homeId === 'hall').length,
    jobless: adults.filter((n) => n.occupation === 'unemployed').length,
    avgMoney: adults.length ? Math.round(money.reduce((a, b) => a + b, 0) / adults.length) : 0,
    poorQuarter: Math.round(q1),
    businesses: active.length,
    closed: Object.values(sim.state.businesses).filter((b) => b.closed).length,
    types,
    treasury: Math.round(sim.state.village.treasury || 0),
    prices: { bread: price('bread'), wood: price('wood'), planks: price('planks'), stone: price('stone'), bricks: price('bricks') },
    techs: Object.keys(sim.state.tech?.known || {}).length,
    status: sim.state.civic?.status || 'village',
    events: (sim.state.events?.history || []).length,
    festivals: (sim.state.festivals?.history || []).length,
    clayPits: sim.industry?.clayPits().filter((o) => o.state === 'full').length ?? 0,
    cold: sim.seasons?.S.cold.length ?? 0, // households with no firewood (winter)
  };
}

/** Warnings: numbers that look out of balance. */
export function warnings(rows) {
  const out = [];
  const last = rows[rows.length - 1];
  const first = rows[0];
  if (last.homeless > Math.max(2, last.adults * 0.12)) out.push(`homeless ${last.homeless} of ${last.adults} adults`);
  if (last.jobless > last.adults * 0.3) out.push(`out of work ${last.jobless} of ${last.adults}`);
  if (last.poorQuarter < 5) out.push(`the poorest quarter have almost nothing ($${last.poorQuarter})`);
  if (last.businesses < first.businesses - 2) out.push(`businesses shrank ${first.businesses} → ${last.businesses}`);
  if (last.prices.bread > first.prices.bread * 1.8) out.push(`bread got dear: $${first.prices.bread} → $${last.prices.bread}`);
  if (last.pop < first.pop * 0.8) out.push(`the village shrank ${first.pop} → ${last.pop}`);
  const cold = Math.max(...rows.map((r) => r.cold || 0));
  if (cold > Math.max(2, last.adults * 0.15)) out.push(`${cold} households went without firewood in winter`);
  return out;
}

export function reportTools(dev) {
  const sim = () => dev.sim;
  return {
    /** The village knows how to make bricks, saw planks, run a factory. */
    industry: () => {
      for (const id of ['better_tools', 'brickmaking', 'sawing', 'manufacture']) sim().tech.T.known[id] ??= sim().time.day;
      return `known: ${Object.keys(sim().tech.T.known).join(', ')} · clay pits ${sim().industry.clayPits().length}`;
    },
    /** A festival on the square now (today becomes its day). */
    festival: (id = 'spring_fair') => {
      const F = sim().festivals;
      if (F.S.current) F.finish();
      F.begin(id);
      return JSON.stringify(F.S.current);
    },
    bandits: () => JSON.stringify(sim().events.start('bandits')),
    /** Steam and railways known, a station built, and a railway to the nearest town you know (or the first). */
    railway: () => {
      const S = sim();
      for (const id of ['manufacture', 'stone_bridges', 'steam_engine', 'railways']) S.tech.T.known[id] ??= S.time.day;
      S.tech.mods = null;
      if (!S.settlements.station()) dev.tr.build('rail_station');
      const to = S.settlements.known()[0] || S.settlements.ids()[0];
      S.settlements.makeContact(to, 'debug');
      S.settlements.get(to).road = 4;
      return `station ${S.settlements.station()?.id} · railway to ${to}: ${S.settlements.days(to)} days`;
    },
    /** The route cache: searches done vs answers remembered. */
    paths: () => JSON.stringify(dev.pathStats || {}),
    report: () => {
      const s = snapshot(dev.sim);
      console.table([{ ...s, types: JSON.stringify(s.types), prices: JSON.stringify(s.prices) }]);
      return s;
    },
  };
}
