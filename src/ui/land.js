/**
 * Land in the UI: who owns a piece of land, in words — for the land panel, the HUD
 * chip that says whose land you're standing on, and the map.
 */
import { t } from '../i18n/i18n.js';
import { tr, parcelName } from './format.js';

/** "Your land" · "Village land" · "Nobody's land" · "Mira's land" · "Bakery's land". */
export function ownerLabel(sim, owner) {
  if (owner === 'player') return t('land_owner.player');
  if (owner === 'village') return t('land_owner.village');
  if (!owner) return t('land_owner.none');
  if (sim.npcs.byId(owner)) return tr(sim, 'land_owner.npc', { npc: owner });
  return t('land_owner.other');
}

/** The land at a tile, for the HUD chip: { id, name, owner, text } or null (roads, water). */
export function landHere(sim, tx, ty) {
  const p = sim.territory?.parcelAt(tx, ty);
  if (!p) return null;
  const owner = sim.territory.owner(p.id);
  const chk = owner === 'player' ? null : sim.territory.canBuy(p.id, 'player');
  const forSale = !!chk && (chk.ok || chk.reason === 'no_money' || chk.reason === 'locked');
  return { id: p.id, name: parcelName(sim, p.id), owner, forSale, text: ownerLabel(sim, owner) };
}
