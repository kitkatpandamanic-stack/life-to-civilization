# From Nothing / С нуля

**Life → Settlement → City → Civilization.** A 2D life-simulation / settlement RPG.
You arrive in a river village with $25, a worn axe and two loaves of bread. Find work,
earn money, learn skills, make friends — and (in later phases) build a house, hire workers,
found a settlement and grow it into a city.

This is the **Phase 1 + Phase 2 prototype**: a playable living world with the full
*wake up → find work → work → get paid → buy food → eat → sleep → level up* loop.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
```

Dev tools:

```bash
node tools/simulate.mjs 60     # run the world headless for 60 days and print what happened
node tools/check-locales.mjs   # verify every localization key exists in en + ru
```

In dev mode the browser console has `dev.*` helpers (`dev.sim`, `dev.skip(minutes)`,
`dev.teleport(tx, ty)`, …) — see `src/debug/devTools.js`.

## Controls

| Key | Action |
| --- | --- |
| W A S D / Arrows | Walk |
| E / Space | Interact with what's in front of you |
| 1–9 | Pick an option in menus and conversations |
| I · C · J · M | Inventory · Character · Journal · Map |
| Q | Eat the most suitable food |
| Esc | Close window / game menu (save, load, language) |

## Technology: Phaser 3 + Vite + plain JavaScript

- **Phaser 3** is a mature 2D game engine: WebGL rendering, tilemaps, a camera that follows the
  player, arcade physics for collisions, animations, particles and tweens.
- **Vite** gives instant dev reloads and lets locale files be imported as JSON.
- **Plain JavaScript (ES modules)** keeps the code approachable for a beginner. No TypeScript
  build step, no framework magic.
- **All art is procedural**: textures are drawn with Canvas2D in `src/render/`, so there are no
  image assets, and seasonal variants (snow, autumn leaves) are just other palettes.
- **The HUD and panels are HTML/CSS** layered over the canvas. Crisp text in both languages, and
  instant re-rendering when the language changes. The *world* (characters, objects, prompts)
  is all Phaser.

## Architecture

The simulation knows nothing about Phaser. It runs on one central, JSON-serializable state object,
and the scene renders it. That separation is what makes save/load trivial, lets the whole world
run headless (`tools/simulate.mjs`), and will let distant settlements be simulated cheaply later.

```
src/
├── config/balance.js        every tunable number (time scale, prices, needs, XP curve...)
├── data/                    content: items, skills, jobs, occupations, businesses, villagers, layout
├── locales/en.json, ru.json every visible string
├── i18n/i18n.js             t(), gendered forms, plurals, live language switching
├── core/
│   ├── GameState.js         creates the central state (player, npcs, objects, businesses...)
│   ├── Simulation.js        owns the state + all systems
│   ├── EventBus.js          systems communicate through events
│   └── rng.js               seeded random + noise (same seed → same world)
├── world/
│   ├── WorldGenerator.js    terrain, river, lake, mountains, forests, roads, village
│   └── Pathfinder.js        A* (villagers prefer roads)
├── systems/                 the simulation (no Phaser here)
│   ├── TimeSystem           clock, calendar, seasons, fast-forward
│   ├── WeatherSystem        seasonal weather with gameplay effects
│   ├── EventSystem          droughts, good harvests, cold snaps, caravans...
│   ├── NeedsSystem          satiety, energy, health, comfort
│   ├── InventorySystem      weight-limited inventory, tools with durability
│   ├── ProgressionSystem    XP, levels, attributes, skills, reputation
│   ├── Modifiers            what every attribute and skill actually does
│   ├── EconomySystem        supply & demand prices, production, wages, trade
│   ├── ResourceSystem       trees, rocks, bushes, crops — and regrowth
│   ├── SocialSystem         relationships (player↔villager, villager↔villager)
│   ├── JobSystem            jobs + emergent favour requests
│   ├── NPCSystem            villager AI: schedules, needs, work, shopping, socializing
│   ├── PlayerActionSystem   chopping, mining, foraging, harvesting
│   └── SaveSystem           localStorage save slots + autosave
├── render/                  procedural textures (tiles, trees, buildings, characters, icons)
├── game/                    Phaser views: terrain, objects, buildings, NPCs, player, lighting, interaction
├── scenes/                  BootScene (textures + title), GameScene (the world)
└── ui/                      HUD, toasts, context menu, panels (inventory, character, journal, map,
                             dialogue, shop, job board, menu), title screen
```

## What's in this prototype

- **World:** a 120×90 tile map (3840×2880 px). Forests, a river with a bridge, a lake, mountains
  with stone/coal/iron, farm fields and a village of 15 buildings. There's a day/night cycle with
  lit windows and street lamps, weather (rain, snow, storms with lightning, fog), and four seasons
  that repaint the terrain.
- **Player:** health, energy, satiety and comfort; 8 attributes and 8 skills, each with a real
  effect; XP and levels that grant points and unlock jobs; a weight-limited inventory; tools that
  wear out; weekly rent.
- **Work:** 7 jobs across 6 businesses. Harvest wheat, deliver wood or stone, courier packages,
  tavern and store shifts, smith's apprentice. Openings depend on the season, the employer's money
  and even ripe crops.
- **Villagers:** 16 villagers with homes, families, jobs, traits, money, hunger and pantries. They
  wake, commute along roads, work (woodcutters really fell trees), eat at the tavern, shop, chat
  with each other, make friends, level up, get hired, quit when unpaid, and idle through winter.
- **Economy:** money flows between the player, villagers and businesses. Prices follow stock. Farm
  output depends on season, weather and events; the store bakes bread from wheat; the tavern buys
  bread for stew; producers export their surplus; tools wear out and get replaced at the smithy.
- **Stories:** the Journal's *Village news* records what happens on its own (friendships, hires,
  shortages, events), and villagers gossip about it.
- **Languages:** English and Russian, switchable at any time, with gendered Russian grammar.
- **Saves:** an autosave on every sleep, plus 3 manual slots.

## Roadmap (from the design brief)

1. ✅ Playable world: movement, camera, terrain, trees/rocks, NPCs, interaction, day/night, UI, EN/RU
2. ✅ Life: needs, money, inventory, jobs, XP/levels, attributes, skills, food, tools
3. ⏭ Property: buy land, build mode, construction sites (foundation → walls → roof), storage, crafting
4. Workers: hiring, assignments, worker AI and growth
5. Business: your own workshops, farms and stores
6. Settlement: migration, roads, population growth
7. City: districts, infrastructure, government
8. World: other settlements, regional trade, exploration

Design rules: never replace the world with menus, keep systems modular and data-driven, no fake
buttons, and let outcomes emerge from the simulation.
