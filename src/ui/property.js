/**
 * Property in the UI: what state a building is in (as badges — icon and word, not only colour)
 * and what the rental market says about it (suggested rent, the going range, demand).
 */
import { t, fmtMoney } from '../i18n/i18n.js';
import { status } from './widgets.js';
import { RENT_LEVELS } from '../systems/PropertySystem.js';

/** The states a building is in: [{ key, kind, ico }] — the first is the main one. */
export function propStates(sim, id) {
  const P = sim.property;
  const r = P.rec(id);
  if (!r) return [];
  const out = [];
  const add = (key, kind, ico) => out.push({ key, kind, ico });
  if (sim.structures?.works(id)) add('works', 'info', '🏗️');
  if (r.ruined) add('ruin', 'danger', '🏚️');
  else if (r.abandoned) add('abandoned', 'danger', '🏚️');
  if (id === sim.state.player.homeId) add('your_home', 'good', '🏠');
  else if (sim.economy.businessAtBuilding(id)) add('business', 'info', '🏪');
  else if (P.isHome(id)) {
    const people = P.occupants(id);
    const landlord = people && sim.npcs.residentsOf(id).some((n) => P.landlord(n));
    if (people && landlord) add('rented', 'good', '🔑');
    else if (people) add('owner_occupied', 'neutral', '🏠');
    else if (sim.letting?.listed(id)) add('for_rent', 'warn', '📋');
    else add('vacant', 'warn', '🚪');
  }
  if (r.forSale) add('for_sale', 'info', '🏷️');
  if (r.arrears > 0) add('arrears', 'danger', '⚠️');
  if (!r.ruined && r.condition < 40) add('needs_repair', 'danger', '🔧');
  return out;
}

export function propBadges(sim, id) {
  return propStates(sim, id)
    .map((s) => status(t(`prop_state.${s.key}`), s.kind, s.ico))
    .join(' ');
}

/** What the market says: the rent at the normal level, the going range for homes this size, and demand. */
export function rentMarket(sim, id) {
  const P = sim.property;
  const cap = P.capacity(id);
  const r = P.rec(id);
  const base = Math.round(P.weeklyRent(id) / (RENT_LEVELS[r?.rentLevel] || 1));
  const like = P.homes().filter((h) => h !== id && !P.rec(h)?.ruined && Math.abs(P.capacity(h) - cap) <= 1 && h !== 'hall');
  const rents = like.map((h) => Math.round(P.weeklyRent(h) / (RENT_LEVELS[P.rec(h)?.rentLevel] || 1)));
  // The middle half of what similar homes go for (the odd bargain or palace aside).
  const sorted = [...rents, base].sort((a, b) => a - b);
  const lo = rents.length >= 3 ? Math.min(base, sorted[Math.floor(sorted.length * 0.25)]) : Math.round(base * 0.8);
  const hi = rents.length >= 3 ? Math.max(base, sorted[Math.ceil(sorted.length * 0.75) - 1]) : Math.round(base * 1.2);
  const d = P.demand();
  const demand = d >= 1.2 ? 'high' : d <= 0.9 ? 'low' : 'normal';
  return { suggested: base, lo, hi, demand, range: `${fmtMoney(lo)}–${fmtMoney(hi)}` };
}
