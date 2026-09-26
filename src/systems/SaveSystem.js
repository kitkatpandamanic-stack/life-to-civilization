/**
 * SaveSystem — saves the whole game state to the browser's localStorage.
 *
 * Slots: 'auto' (written every time you sleep, and every few minutes of play) + three manual slots.
 * The terrain isn't saved — it's regenerated from the seed. Everything that
 * changes during play (player, NPCs, objects, businesses, time...) is saved.
 *
 * Safety: before a slot is written, what was in it is kept as that slot's backup; a save is read
 * back to check it was written whole; if the browser's storage is full, the other slots' backups
 * are cleared to make room. Loading a slot that turns out to be damaged (it won't read, or the game
 * won't start from it) falls back to its backup — and says so (SaveSystem.lastLoad).
 */
import { SAVE_VERSION } from '../core/GameState.js';
import { rand } from '../core/rng.js';

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
    delete n.starved;
    delete n.sleptRough;
  }
  for (const id in copy.objects) delete copy.objects[id].reservedBy;
  copy.player.sleeping = false;
  // Saved while inside your home? Store the position outside the front door instead.
  if (copy.player.indoors && copy.player.outsideX !== undefined) {
    copy.player.x = copy.player.outsideX;
    copy.player.y = copy.player.outsideY;
  }
  copy.player.indoors = false;
  return copy;
}

export const SaveSystem = {
  save(slot, sim) {
    sim.state.rngState = rand.getState();
    const t = sim.time;
    const p = sim.state.player;
    const data = {
      meta: {
        version: SAVE_VERSION,
        name: p.name || null,
        nameIdx: p.nameIdx,
        gender: p.gender,
        level: p.level,
        money: Math.round(p.money),
        day: t.dayOfSeason,
        season: t.season,
        year: t.year,
        savedAt: Date.now(),
      },
      state: sanitize(sim.state),
    };
    const raw = JSON.stringify(data);
    const write = () => {
      // The last good save of this slot is kept as its backup.
      const prev = localStorage.getItem(PREFIX + slot);
      if (prev && readable(prev)) localStorage.setItem(PREFIX + slot + BACKUP, prev);
      localStorage.setItem(PREFIX + slot, raw);
      // Read it back: written whole?
      return localStorage.getItem(PREFIX + slot)?.length === raw.length;
    };
    try {
      return write();
    } catch (e) {
      // Storage full: make room (other slots' backups first), then try once more.
      try {
        for (const s of SAVE_SLOTS) if (s !== slot) localStorage.removeItem(PREFIX + s + BACKUP);
        return write();
      } catch (e2) {
        console.error('Save failed', e2);
        return false;
      }
    }
  },

  /** Does this slot have a backup (the save before the last)? */
  hasBackup(slot) {
    try {
      return readable(localStorage.getItem(PREFIX + slot + BACKUP));
    } catch {
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

  load(slot, { backup = false } = {}) {
    try {
      const raw = localStorage.getItem(PREFIX + slot + (backup ? BACKUP : ''));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data?.state?.player || !Array.isArray(data.state.npcs)) throw new Error('incomplete save');
      return migrate(data.state);
    } catch (e) {
      console.warn('Load failed:', e?.message);
      return null;
    }
  },

  /**
   * Load a slot and start the game from it — or, if it's damaged (unreadable, or the game won't
   * start from it), from its backup. make(state) builds the game. Returns the game or null;
   * SaveSystem.lastLoad says which it was ('ok' | 'backup' | 'failed').
   */
  loadGame(slot, make) {
    for (const backup of [false, true]) {
      const state = this.load(slot, { backup });
      if (!state) continue;
      try {
        const game = make(state);
        this.lastLoad = backup ? 'backup' : 'ok';
        return game;
      } catch (e) {
        console.warn(backup ? 'The backup would not start either:' : 'The save would not start — trying its backup:', e?.message);
      }
    }
    this.lastLoad = 'failed';
    return null;
  },

  /** The most recently written slot, or null. */
  latest() {
    let best = null;
    for (const s of this.list()) if (s.meta && (!best || s.meta.savedAt > best.meta.savedAt)) best = s;
    return best;
  },
};

const BACKUP = '.bak';

/** Can this be read as a save? */
function readable(raw) {
  if (!raw) return false;
  try {
    return !!JSON.parse(raw)?.state?.player;
  } catch {
    return false;
  }
}

/** Upgrade old save formats here as the game evolves. */
function migrate(state) {
  if (!state.version) state.version = 1;
  return state;
}
