/**
 * Stories (StorySystem): villagers with storylines — a chain of scenes, each a choice for you, with
 * consequences that last. The words are in the locale files (story.<id>.<stage>.text / .<choice>,
 * story.<id>.end.<ending>); here are who's in it, when each scene comes, and what each choice does.
 *
 *   cast(sim, api)          → { role: npcId } — who it's about (null: nobody fits, not now)
 *   stages[stage] = {
 *     with     — the role whose scene it is (you'll find the story when you talk to them)
 *     after    — days after the stage before (0: at once)
 *     timeout  — { days, choice }: left too long, this is what happens
 *     wait     — an event that moves it on without a choice ('journey:<role>' — you reach their town)
 *     auto     — a choice made by itself when the scene comes (the story just moves on; you're told)
 *     choices  — [{ id, requires(sim, st, api) → true | { reason, params }, run(fx) → next stage | 'end:<ending>' }]
 *   }
 * fx: rel(role, n) · bond(roleA, roleB, n) · mem(role, kind) · money(n) · rep(n) · xp(n) · skill(id, n)
 *     · chronicle(key) · arrive(from) → npcId · leave(role) · set(k, v) · get(k) · cast · sim
 */
export const STORY_TUNING = {
  everyDays: 9, // a new story may begin this often…
  maxActive: 2, // …if fewer than this are going
  minLevel: 3, // you, at least this level (you've found your feet)
  firstDay: 4,
};

/** Adults at home in the valley (not you, not away, not leaving, not in another story). */
const adults = (sim, api) => sim.state.npcs.filter((n) => n.age >= 20 && n.homeId && !n.away && !n.leaving && !api.busy(n.id));

export const STORIES = {
  // Two neighbours fall out — over a boundary, a fence, an old grudge.
  feud: {
    icon: '⚔️',
    cast(sim, api) {
      const list = adults(sim, api).filter((n) => n.age < 70);
      let best = null;
      for (const a of list) {
        for (const b of list) {
          if (a.id >= b.id || a.homeId === b.homeId) continue;
          const ha = sim.world.buildings[a.homeId];
          const hb = sim.world.buildings[b.homeId];
          if (!ha || !hb) continue;
          const d = Math.abs(ha.tx - hb.tx) + Math.abs(ha.ty - hb.ty);
          const score = d - sim.social.npcRel(a, b) * 0.2 + api.hash(`${a.id}${b.id}`) * 3;
          if (d < 22 && (!best || score < best.score)) best = { a: a.id, b: b.id, score };
        }
      }
      return best ? { a: best.a, b: best.b } : null;
    },
    stages: {
      start: {
        with: 'a',
        after: 0,
        timeout: { days: 5, choice: 'ignore' },
        choices: [
          { id: 'side_a', run: (fx) => (fx.rel('a', 10), fx.rel('b', -12), fx.bond('a', 'b', -10), fx.mem('b', 'player_took_side'), 'worse') },
          { id: 'side_b', run: (fx) => (fx.rel('b', 10), fx.rel('a', -12), fx.bond('a', 'b', -10), fx.mem('a', 'player_took_side'), 'worse') },
          {
            id: 'mediate',
            requires: (sim) => (sim.state.player.reputation || 0) >= 15 || { reason: 'need_reputation', params: { value: 15 } },
            run: (fx) => (fx.rel('a', 6), fx.rel('b', 6), fx.bond('a', 'b', 15), fx.mem('a', 'player_made_peace'), fx.mem('b', 'player_made_peace'), fx.rep(3), fx.xp(40), 'end:peace'),
          },
          { id: 'ignore', run: (fx) => (fx.bond('a', 'b', -8), 'worse') },
        ],
      },
      worse: {
        with: 'b',
        after: 4,
        timeout: { days: 5, choice: 'let_be' },
        choices: [
          {
            id: 'pay_repairs',
            requires: (sim) => sim.state.player.money >= 40 || { reason: 'no_money', params: { money: 40 } },
            run: (fx) => (fx.money(-40), fx.rel('a', 8), fx.rel('b', 8), fx.bond('a', 'b', 12), fx.rep(2), fx.mem('a', 'player_made_peace'), fx.mem('b', 'player_made_peace'), 'end:mended'),
          },
          { id: 'headman', run: (fx) => (fx.rel('b', 6), fx.rel('a', -8), fx.rep(1), 'end:judged') },
          { id: 'let_be', run: (fx) => (fx.bond('a', 'b', -15), 'end:bitter') },
        ],
      },
    },
  },

  // A lonely old villager with family somewhere out in the world.
  heir: {
    icon: '👵',
    cast(sim, api) {
      const known = sim.settlements?.known() || [];
      if (!known.length) return null;
      const old = adults(sim, api)
        .filter((n) => n.age >= 58 && !n.kin?.spouse && !(n.kin?.children || []).some((c) => sim.npcs.byId(c)))
        .sort((x, y) => y.age - x.age)[0];
      if (!old) return null;
      return { elder: old.id, place: known[Math.floor(api.hash(old.id) * known.length)] };
    },
    stages: {
      start: {
        with: 'elder',
        after: 0,
        timeout: { days: 7, choice: 'decline' },
        choices: [
          { id: 'go', run: (fx) => (fx.rel('elder', 8), 'search') },
          {
            id: 'write',
            requires: (sim) => sim.state.player.money >= 30 || { reason: 'no_money', params: { money: 30 } },
            run: (fx) => (fx.money(-30), fx.rel('elder', 6), fx.set('letterDay', fx.sim.time.day), 'letter'),
          },
          { id: 'decline', run: (fx) => (fx.rel('elder', -4), 'end:alone') },
        ],
      },
      // You go there yourself: it moves on when you arrive in their town (a trade journey).
      search: { with: 'elder', after: 0, wait: 'journey:place', timeout: { days: 40, choice: 'give_up' }, choices: [{ id: 'give_up', run: (fx) => (fx.rel('elder', -6), 'end:alone') }] },
      // A letter: an answer in a week.
      letter: { with: 'elder', after: 7, auto: 'answer', choices: [{ id: 'answer', run: () => 'found' }] },
      found: {
        with: 'elder',
        after: 0,
        choices: [
          {
            id: 'welcome',
            run: (fx) => {
              const kin = fx.arrive(fx.cast.place);
              if (kin) {
                fx.cast.kin = kin;
                fx.bond('elder', 'kin', 60);
              }
              fx.rel('elder', 15);
              fx.mem('elder', 'player_found_kin');
              fx.money(60);
              fx.rep(4);
              fx.xp(80);
              return 'end:reunited';
            },
          },
        ],
      },
    },
  },

  // A quiet newcomer who keeps to themselves — and a past they don't talk about.
  stranger: {
    icon: '🧳',
    needs: (sim) => sim.progression.hasUnlock('hire_worker'),
    cast(sim, api) {
      const trade = ['construction', 'smithing', 'carpentry'][Math.floor(api.hash(`trade${sim.time.day}`) * 3)];
      return { trade, newcomer: true };
    },
    begin(fx) {
      // They arrive now (with the road or the train, like any newcomer).
      const id = fx.arrive(null);
      if (!id) return false;
      fx.cast.s = id;
      return true;
    },
    stages: {
      start: {
        with: 's',
        after: 1,
        timeout: { days: 6, choice: 'ignore' },
        choices: [
          {
            id: 'hire',
            requires: (sim, st) => {
              const c = sim.workers.canHire(sim.npcs.byId(st.cast.s));
              return c.ok || { reason: c.reason, params: c.params };
            },
            run: (fx) => (fx.hire('s'), fx.rel('s', 15), fx.mem('s', 'player_helped_stranger'), 'secret'),
          },
          {
            id: 'help',
            requires: (sim) => sim.state.player.money >= 20 || { reason: 'no_money', params: { money: 20 } },
            run: (fx) => (fx.money(-20), fx.rel('s', 12), fx.mem('s', 'player_helped_stranger'), 'secret'),
          },
          { id: 'ignore', run: (fx) => (fx.rel('s', -5), 'gone') },
        ],
      },
      secret: {
        with: 's',
        after: 6,
        choices: [
          { id: 'learn', run: (fx) => (fx.skill(fx.cast.trade, 180), fx.rel('s', 10), fx.xp(60), fx.chronicle('chronicle.story_master'), 'end:master') },
          { id: 'keep', run: (fx) => (fx.rel('s', 20), fx.rep(2), fx.xp(40), 'end:friend') },
        ],
      },
      gone: { with: 's', after: 3, auto: 'ok', choices: [{ id: 'ok', run: (fx) => (fx.leave('s'), 'end:left') }] },
    },
  },
};
