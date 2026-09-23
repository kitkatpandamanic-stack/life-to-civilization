/**
 * GameState — creates the single central state object for a new game.
 *
 * The state is plain JSON-friendly data (no classes, no Maps) so it can be
 * saved and loaded directly. Systems read and modify it; views render it.
 *
 * state
 *  ├── time, weather, events
 *  ├── player        (stats, attributes, skills, inventory, rent...)
 *  ├── npcs[]        (every villager with needs, money, job, traits, relationships)
 *  ├── objects{}     (trees, rocks, bushes, crops and their growth state)
 *  ├── businesses{}  (money and stock of every business)
 *  ├── jobs          (today's openings, the active job, favour requests)
 *  ├── chronicle[]   (the village's history — emergent stories)
 *  └── stats         (lifetime counters)
 */
import { BALANCE } from '../config/balance.js';
import { SKILLS } from '../data/skills.js';
import { ITEMS } from '../data/items.js';
import { BUSINESSES } from '../data/businesses.js';
import { NPC_ROSTER, LOOK_PALETTE } from '../data/npcs.js';
import { Rng } from './rng.js';

export const SAVE_VERSION = 1;

export function createNewState({ playerName, seed, world }) {
  const rng = new Rng(seed + 999);
  return {
    version: SAVE_VERSION,
    seed,
    time: { totalMinutes: BALANCE.time.startDayMinute },
    weather: { type: 'sunny', untilMinute: BALANCE.time.startDayMinute + 5 * 60 },
    events: { active: [], lastCaravanDay: 0 },
    player: createPlayer(playerName, world.spawn),
    npcs: createStartingNPCs(world, rng),
    objects: JSON.parse(JSON.stringify(world.initialObjects)),
    businesses: createBusinesses(),
    jobs: { openings: {}, active: null, requests: [], lastRefreshDay: -1, nextRequestId: 1 },
    chronicle: [],
    stats: { jobsCompleted: 0, treesChopped: 0, rocksMined: 0, cropsHarvested: 0, moneyEarned: 0, requestsDone: 0 },
  };
}

function createPlayer(name, spawn) {
  const P = BALANCE.player;
  const skills = {};
  for (const id of Object.keys(SKILLS)) skills[id] = { level: 0, xp: 0 };
  const inventory = [];
  for (const s of P.startInventory) {
    const def = ITEMS[s.id];
    if (def.tool) for (let i = 0; i < s.qty; i++) inventory.push({ id: s.id, qty: 1, dur: def.tool.durability });
    else inventory.push({ id: s.id, qty: s.qty });
  }
  return {
    name,
    x: spawn.x,
    y: spawn.y,
    facing: 'down',
    health: 100,
    energy: 90,
    hunger: 80,
    comfort: P.shackComfort,
    money: P.startMoney,
    age: P.startAge,
    reputation: 0,
    xp: 0,
    level: 1,
    attributePoints: 0,
    skillPoints: 0,
    attributes: { ...P.startAttributes },
    skills,
    inventory,
    sleeping: false,
    homeId: 'shack',
    rent: { amount: BALANCE.rent.amount, nextDueDay: BALANCE.rent.periodDays, debt: 0 },
    lastWellMinute: -99999,
    look: { skin: '#e8b98f', hair: '#4a2f1d', hairStyle: 'short', shirt: '#2f8f83', pants: '#3d3a4f', shoes: '#2a1d14', hat: true },
  };
}

function createBusinesses() {
  const out = {};
  for (const [id, def] of Object.entries(BUSINESSES)) {
    out[id] = { id, money: def.money, stock: { ...def.stock }, daysUnpaid: 0 };
  }
  return out;
}

export function randomLook(rng, gender, age) {
  const P = LOOK_PALETTE;
  const hair = age >= 60 ? rng.pick(['#b8b8b8', '#d6d6d6', '#9a9a9a']) : rng.pick(P.hair);
  return {
    skin: rng.pick(P.skin),
    hair,
    hairStyle: gender === 'f' ? rng.pick(['long', 'bun', 'long']) : rng.pick(['short', 'short', 'messy', age >= 55 ? 'bald' : 'short']),
    shirt: rng.pick(P.shirt),
    pants: rng.pick(P.pants),
    shoes: rng.pick(P.shoes),
    dress: gender === 'f' && rng.chance(0.6),
    beard: gender === 'm' && age >= 30 && rng.chance(0.4),
  };
}

function createStartingNPCs(world, rng) {
  return NPC_ROSTER.map((r, i) => {
    const home = world.buildings[r.home];
    const start = world.tileCenter(home.door.tx, home.door.ty);
    const skills = {};
    return {
      id: r.key,
      nameIdx: r.name,
      gender: r.gender,
      age: r.age,
      look: randomLook(rng, r.gender, r.age),
      homeId: r.home,
      occupation: r.occupation,
      employer: r.employer || null, // business id they work for
      owns: r.owns || null, // business id they own
      family: r.family || [],
      traits: r.traits,
      money: r.money,
      hunger: 60 + rng.int(0, 35),
      energy: 90,
      pantry: 3,
      level: r.occupation === 'child' ? 1 : Math.max(1, Math.round((r.age - 16) / 6)),
      xp: 0,
      skills,
      rel: 0, // relationship with the player (0–100)
      met: false,
      lastChatDay: -1,
      lastGiftDay: -1,
      relations: {}, // relationships with other NPCs
      x: start.x + (i % 3) * 4,
      y: start.y,
      facing: 'down',
      inside: r.home, // everyone starts at home (it's early morning)
      task: null,
      nextThink: 0,
      workedToday: false,
      unpaidDays: 0,
    };
  });
}
