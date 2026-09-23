/**
 * SaveSystem — saves the whole game state to the browser's localStorage.
 *
 * Slots: 'auto' (written every time you sleep) + three manual slots.
 * The terrain isn't saved — it's regenerated from the seed. Everything that
 * changes during play (player, NPCs, objects, businesses, time...) is saved.
 */
import { SAVE_VERSION } from '../core/GameState.js';

const PREFIX = 'fromnothing.save.';
export const SAVE_SLOTS = ['auto', '1', '2', '3'];

/** Strip runtime-only fields before saving. */
function sanitize(state) {
  const copy = JSON.parse(JSON.stringify(state));
  for (const n of copy.npcs) {
    delete n.moving;
    delete n.simLevel;
    delete n.talkingToPlayer;
    delete n.task;
  }
  for (const id in copy.objects) delete copy.objects[id].reservedBy;
  copy.player.sleeping = false;
  return copy;
}

export const SaveSystem = {
  save(slot, sim) {
    const t = sim.time;
    const p = sim.state.player;
    const data = {
      meta: {
        version: SAVE_VERSION,
        name: p.name,
        level: p.level,
        money: Math.round(p.money),
        day: t.dayOfSeason,
        season: t.season,
        year: t.year,
        savedAt: Date.now(),
      },
      state: sanitize(sim.state),
    };
    try {
      localStorage.setItem(PREFIX + slot, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('Save failed', e);
      return false;
    }
  },

  /** Returns [{ slot, meta }] with meta = null for empty slots. */
  list() {
    return SAVE_SLOTS.map((slot) => {
      try {
        const raw = localStorage.getItem(PREFIX + slot);
        return { slot, meta: raw ? JSON.parse(raw).meta : null };
      } catch {
        return { slot, meta: null };
      }
    });
  },

  load(slot) {
    try {
      const raw = localStorage.getItem(PREFIX + slot);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return migrate(data.state);
    } catch (e) {
      console.error('Load failed', e);
      return null;
    }
  },

  /** The most recently written slot, or null. */
  latest() {
    let best = null;
    for (const s of this.list()) if (s.meta && (!best || s.meta.savedAt > best.meta.savedAt)) best = s;
    return best;
  },
};

/** Upgrade old save formats here as the game evolves. */
function migrate(state) {
  if (!state.version) state.version = 1;
  return state;
}
