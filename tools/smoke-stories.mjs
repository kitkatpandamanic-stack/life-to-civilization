// Headless test for villagers' storylines (StorySystem, data/stories.js):
//   beginning — not for a newcomer; later, stories begin one at a time, with real villagers in them
//   the feud  — a scene waits for you; your choice changes friendships; ignored, it moves on without
//               you; a good name lets you make peace; the ending goes in the chronicle
//   the heir  — you promise to look; arriving in their town (a trade journey) brings the family to live
//               in the valley
//   stranger  — a newcomer arrives; help them and their secret comes out (they teach you their craft)
//   and       — saved
// Usage: node tools/smoke-stories.mjs
import { Simulation } from '../src/core/Simulation.js';
import { STORY_TUNING } from '../src/data/stories.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(4000);
};
function setup(seed) {
  const sim = Simulation.newGame('T', seed);
  sim.state.player.money = 5000;
  sim.progression.addXp(20000);
  return sim;
}

// ================================================================== beginning
{
  const sim = Simulation.newGame('T', 9971);
  runOn(sim)(12 * 1440);
  check('A newcomer to the valley has no stories yet', !sim.stories.S.active.length);
  const s2 = setup(9972);
  runOn(s2)((STORY_TUNING.firstDay + 2) * 1440);
  const st = s2.stories.S.active[0];
  check('Found your feet: a story begins', !!st, st?.story);
  check('…about real villagers', st && Object.entries(st.cast).filter(([r, v]) => typeof v === 'string' && r !== 'place' && r !== 'trade').every(([, id]) => s2.npcs.byId(id)));
  check('…one at a time (not all at once)', s2.stories.S.active.length <= STORY_TUNING.maxActive);
}

// ================================================================== the feud
{
  const sim = setup(9973);
  const S = sim.stories;
  const st = S.begin('feud');
  check('A quarrel between neighbours begins', !!st && st.cast.a !== st.cast.b);
  const a = sim.npcs.byId(st.cast.a);
  const b = sim.npcs.byId(st.cast.b);
  const seen = [];
  sim.bus.on('toast', (e) => seen.push(e.key));
  S.daily();
  check('The scene waits for you (you\'re told; they have it when you talk to them)', S.ready(st) && seen.includes('toast.story_scene') && S.sceneWith(a.id) === st);
  check('The guide mentions it', sim.guide.advice(12).some((x) => x.id === 'story_waiting'));
  a.rel = 30;
  b.rel = 30;
  const ra = a.rel;
  const rb = b.rel;
  check('Taking a side', S.choose(st.id, 'side_a').ok);
  check('…the one you backed likes you more, the other less', a.rel > ra && b.rel < rb);
  check('…and it gets worse between them (the next scene, in a few days)', st.stage === 'worse' && !S.ready(st));
  for (let i = 0; i < 5; i++) {
    sim.state.time.totalMinutes += 1440;
    S.daily();
  }
  check('Then it\'s with the other one', S.ready(st) && S.sceneWith(b.id) === st);
  const m0 = sim.state.player.money;
  S.choose(st.id, 'pay_repairs');
  check('Paying for the repairs mends it (it cost you)', sim.state.player.money === m0 - 40 && S.S.done.some((d) => d.story === 'feud' && d.ending === 'mended'));
  check('The chronicle remembers how it ended', sim.state.chronicle.some((e) => e.key === 'story.feud.end.mended'));
  // Another one, ignored.
  S.S.done = [];
  const st2 = S.begin('feud');
  for (let i = 0; i < 20 && S.S.active.includes(st2); i++) {
    sim.state.time.totalMinutes += 1440;
    S.daily();
  }
  check('Left alone, a story moves on without you (and ends)', !S.S.active.includes(st2) && S.S.done.some((d) => d.story === 'feud' && d.ending === 'bitter'));
  // Peace needs a good name.
  S.S.done = [];
  const st3 = S.begin('feud');
  S.daily();
  sim.state.player.reputation = 0;
  check('Making peace needs a good name', !S.choose(st3.id, 'mediate').ok);
  sim.state.player.reputation = 40;
  check('…with one, peace', S.choose(st3.id, 'mediate').ok && S.S.done.some((d) => d.ending === 'peace'));
}

// ================================================================== the heir
{
  const sim = setup(9974);
  const S = sim.stories;
  const st = S.begin('heir');
  if (!st) check('An old villager with family far away', false, 'no cast');
  else {
    S.daily();
    check('An old villager asks you to find their family', S.ready(st) && !!st.cast.place);
    S.choose(st.id, 'go');
    check('You promise to look (it waits for you to go there)', st.stage === 'search' && !S.ready(st));
    const pop0 = sim.state.npcs.length;
    sim.bus.emit('journey:arrived', { to: st.cast.place });
    check('Arriving in their town, you find them', st.stage === 'found' && S.ready(st));
    const m0 = sim.state.player.money;
    S.choose(st.id, 'welcome');
    check('The family comes to live in the valley (and you\'re thanked)', sim.state.npcs.length > pop0 && sim.state.player.money > m0 && S.S.done.some((d) => d.ending === 'reunited'));
  }
}

// ================================================================== the stranger
{
  const sim = setup(9975);
  const S = sim.stories;
  const pop0 = sim.state.npcs.length;
  const st = S.begin('stranger');
  check('A stranger arrives in the valley', !!st && sim.state.npcs.length > pop0 && !!sim.npcs.byId(st.cast.s));
  runOn(sim)(2 * 1440);
  check('…and keeps to themselves until you speak with them', S.ready(st));
  S.choose(st.id, 'hire');
  check('You take them on', !!sim.workers.contract(st.cast.s) && st.stage === 'secret');
  for (let i = 0; i < 7; i++) {
    sim.state.time.totalMinutes += 1440;
    S.daily();
  }
  const skill = st.cast.trade;
  const xp0 = sim.state.player.skills[skill].xp + sim.state.player.skills[skill].level * 1000;
  check('Their secret comes out', S.ready(st));
  S.choose(st.id, 'learn');
  const xp1 = sim.state.player.skills[skill].xp + sim.state.player.skills[skill].level * 1000;
  check('A master of their craft: they teach you', xp1 > xp0 && S.S.done.some((d) => d.ending === 'master'), skill);

  // Saved.
  const st2 = S.begin('feud');
  const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
  check('Stories (going and done) are saved', copy.stories.S.active.length === S.S.active.length && copy.stories.S.done.length === S.S.done.length && !!st2);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll story checks passed');
process.exit(failures ? 1 : 0);
