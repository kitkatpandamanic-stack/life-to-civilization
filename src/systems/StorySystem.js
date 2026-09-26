/**
 * StorySystem — villagers' storylines (data/stories.js): a chain of scenes, each a choice for you,
 * with consequences that last (friendships, feuds, money, your name, what you learn — and the
 * chronicle remembers how each one ended).
 *
 *   state.stories = { active: [{ id, story, cast: { role: npcId }, stage, due, readyDay, told, data }],
 *                     done: [{ story, ending, day, cast }], nextId, lastStart }
 *
 * Every few days, if fewer than two stories are going and you've found your feet, one begins — the
 * first (in the order they're written) whose cast can be found among the villagers now. A scene comes
 * when it's due: you're told, it's in your journal, and the villager it's with has "📜" when you talk
 * to them. Leave it too long and the story moves on without you (its timeout choice).
 * Nothing here rolls the game's dice (a hash chooses among equals); only a stranger arriving does.
 */
import { STORIES, STORY_TUNING as ST } from '../data/stories.js';
import { hashStr } from '../core/rng.js';

export class StorySystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.stories ??= { active: [], done: [], nextId: 1, lastStart: -99 };
    sim.bus.on('time:day', () => this.daily());
    sim.bus.on('journey:arrived', (j) => this.arrivedAt(j?.to));
  }

  get S() {
    return this.sim.state.stories;
  }

  api() {
    const sim = this.sim;
    return {
      hash: (s) => hashStr(`story_${s}`, sim.state.seed | 0),
      busy: (id) => this.S.active.some((st) => Object.values(st.cast).includes(id)),
    };
  }

  // ------------------------------------------------------------------ beginning

  canBegin() {
    const sim = this.sim;
    return sim.state.player.level >= ST.minLevel && sim.time.day >= ST.firstDay && this.S.active.length < ST.maxActive && sim.time.day - this.S.lastStart >= ST.everyDays;
  }

  daily() {
    const sim = this.sim;
    const day = sim.time.day;
    if (this.canBegin()) {
      for (const [id, def] of Object.entries(STORIES)) {
        if (this.S.done.some((d) => d.story === id) || this.S.active.some((a) => a.story === id)) continue;
        if (def.needs && !def.needs(sim)) continue;
        if (this.begin(id)) break;
      }
    }
    for (const st of this.S.active.slice()) this.tick(st, day);
  }

  begin(id) {
    const sim = this.sim;
    const def = STORIES[id];
    const cast = def.cast(sim, this.api());
    if (!cast) return null;
    const st = { id: this.S.nextId++, story: id, cast, stage: 'start', due: sim.time.day + (def.stages.start.after || 0), readyDay: null, told: false, data: {} };
    if (def.begin && def.begin(this.fx(st)) === false) return null;
    this.S.active.push(st);
    this.S.lastStart = sim.time.day;
    sim.bus.emit('stories:changed');
    return st;
  }

  // ------------------------------------------------------------------ scenes coming due

  stage(st) {
    return STORIES[st.story].stages[st.stage];
  }

  /** A scene waiting for you (due, not a wait-for-something stage). */
  ready(st) {
    const sg = this.stage(st);
    return !!sg && this.sim.time.day >= st.due && !sg.wait;
  }

  tick(st, day) {
    const sim = this.sim;
    const sg = this.stage(st);
    if (!sg) return this.finish(st, 'lost');
    // Someone in it is gone (moved away, died): the story ends there.
    for (const [role, id] of Object.entries(st.cast)) if (typeof id === 'string' && role !== 'place' && role !== 'trade' && !sim.npcs.byId(id)) return this.finish(st, 'lost');
    if (day < st.due) return;
    if (st.readyDay === null) st.readyDay = day;
    if (sg.auto) return this.choose(st.id, sg.auto, true);
    if (!st.told && !sg.wait) {
      st.told = true;
      sim.toast('toast.story_scene', { story: st.story, npc: st.cast[sg.with] }, 'info');
      sim.bus.emit('stories:changed');
    }
    if (sg.timeout && day - st.readyDay >= sg.timeout.days) this.choose(st.id, sg.timeout.choice, true);
  }

  /** You reached a town (a trade journey): a story waiting for that moves on. */
  arrivedAt(place) {
    for (const st of this.S.active.slice()) {
      const sg = this.stage(st);
      if (sg?.wait === 'journey:place' && st.cast.place === place) this.goTo(st, 'found');
    }
  }

  goTo(st, next) {
    const sim = this.sim;
    if (String(next).startsWith('end:')) return this.finish(st, next.slice(4));
    st.stage = next;
    const sg = this.stage(st);
    st.due = sim.time.day + (sg?.after || 0);
    st.readyDay = null;
    st.told = false;
    sim.bus.emit('stories:changed');
    // Due now: say so at once.
    if (sg && st.due <= sim.time.day) this.tick(st, sim.time.day);
  }

  // ------------------------------------------------------------------ choosing

  get(id) {
    return this.S.active.find((st) => st.id === Number(id)) || null;
  }

  /** A scene is a conversation: you've met whoever it's with. */
  meet(st) {
    const n = this.sim.npcs.byId(st.cast[this.stage(st)?.with]);
    if (n) this.sim.social.meet(n);
  }

  /** The choices in the scene now: [{ id, ok, reason, params }]. */
  choices(st) {
    const sg = this.stage(st);
    return (sg?.choices || []).map((c) => {
      const r = c.requires ? c.requires(this.sim, st, this.api()) : true;
      return { id: c.id, ok: r === true, reason: r === true ? null : r.reason, params: r === true ? null : r.params };
    });
  }

  choose(id, choiceId, auto = false) {
    const st = this.get(id);
    if (!st) return { ok: false, reason: 'nothing_here' };
    const sg = this.stage(st);
    const c = sg?.choices.find((x) => x.id === choiceId);
    if (!c) return { ok: false, reason: 'nothing_here' };
    if (!auto && !this.ready(st)) return { ok: false, reason: 'not_yet' };
    if (!auto) this.meet(st); // (you're talking to them)
    if (!auto && c.requires) {
      const r = c.requires(this.sim, st, this.api());
      if (r !== true) return { ok: false, reason: r.reason, params: r.params };
    }
    const next = c.run(this.fx(st));
    st.data.choices = [...(st.data.choices || []), `${st.stage}:${choiceId}`];
    if (auto && sg.auto) this.sim.toast(`story.${st.story}.${st.stage}.told`, this.params(st), 'info');
    this.goTo(st, next);
    return { ok: true, next };
  }

  finish(st, ending) {
    const sim = this.sim;
    this.S.active.splice(this.S.active.indexOf(st), 1);
    this.S.done.push({ story: st.story, ending, day: sim.time.day, cast: st.cast });
    if (ending !== 'lost') {
      sim.chronicle(`story.${st.story}.end.${ending}`, this.params(st));
      sim.toast('toast.story_end', { story: st.story, ending: `${st.story}.${ending}` }, 'good');
    }
    sim.bus.emit('stories:changed');
  }

  /** Names for the words: every role that's a villager (resolved at display time). */
  params(st) {
    const out = {};
    for (const [role, v] of Object.entries(st.cast)) {
      if (role === 'place') out.settlement = v;
      else if (role === 'trade') out.trade = v;
      else if (typeof v === 'string') out[`npc_${role}`] = v;
    }
    return out;
  }

  // ------------------------------------------------------------------ what choices do

  fx(st) {
    const sim = this.sim;
    const npc = (role) => sim.npcs.byId(st.cast[role]);
    const fx = {
      sim,
      cast: st.cast,
      rel: (role, n) => npc(role) && sim.social.addRel(npc(role), n),
      bond: (a, b, n) => npc(a) && npc(b) && sim.social.adjust(npc(a), npc(b), { f: n, t: n / 2 }),
      mem: (role, kind) => npc(role) && sim.memory.remember(npc(role), kind, { who: 'player' }),
      money: (n) => this.storyMoney(n),
      rep: (n) => sim.progression.addReputation(n),
      xp: (n) => sim.progression.addXp(n),
      skill: (id, n) => sim.progression.addSkillXp(id, n),
      chronicle: (key) => sim.chronicle(key, this.params(st)),
      set: (k, v) => (st.data[k] = v),
      get: (k) => st.data[k],
      hire: (role) => {
        const n = npc(role);
        if (n && sim.workers.canHire(n).ok) sim.workers.hire(n, sim.workers.expectedSalary(n));
      },
      leave: (role) => npc(role) && sim.growth.leave([npc(role)]),
      /** Someone comes to the valley (from a settlement, or from nowhere in particular): their id. */
      arrive: (from) => {
        const people = sim.growth.arrive({ size: 1, from: from || undefined });
        return people?.[0]?.id || null;
      },
    };
    return fx;
  }

  storyMoney(n) {
    this.sim.state.player.money += n;
  }

  // ------------------------------------------------------------------ for the others

  /** The story waiting for you with this villager (for the "📜" when you talk to them). */
  sceneWith(npcId) {
    return this.S.active.find((st) => this.ready(st) && st.cast[this.stage(st).with] === npcId) || null;
  }

  waiting() {
    return this.S.active.filter((st) => this.ready(st));
  }

  advice(AP) {
    return this.waiting().map((st) => ({ id: 'story_waiting', prio: AP.opportunity + 10, icon: STORIES[st.story].icon, params: { story: st.story, npc: st.cast[this.stage(st).with] }, go: { story: st.id } }));
  }
}
