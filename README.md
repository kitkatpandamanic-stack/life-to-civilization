# From Nothing / С нуля

**Life → Settlement → City → Civilization.** A 2D life simulation and settlement RPG.
You arrive in a river village with $25, a worn axe and two loaves of bread. Find work,
earn money, learn skills and make friends. Then build a home, hire workers and run a business.
Marry and raise children, explore beyond the valley, and hand everything on to the next generation.
Meanwhile the village lives its own life around you.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
```

Headless tools (the simulation runs without the browser):

```bash
node tools/simulate.mjs 60          # run the world for 60 days and print what happened
node tools/check-locales.mjs        # every localization key exists in en + ru
node tools/smoke-v2.mjs             # V2: land, building, crafting, workers, your business
node tools/smoke-living.mjs         # memories, habits, kinship, dialogue topics
node tools/smoke-life.mjs 3         # 3 years of village life: births, deaths, businesses, housing
node tools/smoke-business.mjs       # villager businesses, competition, startups, failures
node tools/smoke-nature.mjs 3       # forests, ore, fish and game populations
node tools/smoke-growth.mjs 3       # villagers build, migrants arrive, districts form
node tools/smoke-logistics.mjs      # goods travel the roads (porters, carts, carters' firms)
node tools/smoke-events.mjs         # floods, storms, fires, sickness, rumors
node tools/smoke-lineage.mjs        # courtship, marriage, children, retirement, succession
node tools/smoke-explore.mjs        # expeditions, regions, fog of war
node tools/smoke-tech.mjs           # know-how, school, mentors, knowledge across generations
node tools/smoke-player.mjs         # quality, forge & tools, cooking, perks, contracts, ambitions
node tools/smoke-holdings.mjs       # owning and running village businesses, orders, stakes, loans
node tools/smoke-economy.mjs        # wheat → flour → bread, shortages, quality & customers, wages, taxes, loans
node tools/smoke-sites.mjs          # discovery sites, outposts, hunters & miners, hamlets
```

In dev mode (`npm run dev` only) there's a **debug panel on F9**: live stats, simulation
timing, and buttons to trigger events, change the weather, spawn migrants, fail a business,
discover know-how and skip time. The browser console also has `dev.*` helpers (`dev.sim`,
`dev.skip(minutes)`, `dev.teleport(tx, ty)`, `dev.pump(frames)`…). See `src/debug/`.

## Controls

| Key | Action |
| --- | --- |
| W A S D / Arrows | Walk |
| E / Space | Interact with what's in front of you |
| F | Inspect (a villager, a building) |
| 1–9 | Pick an option in menus and conversations |
| I · C · J · M · B | Inventory · Character · Journal · Map · Build |
| Q | Eat the most suitable food |
| Esc | Close a window / game menu (save, load, language) |

## Technology: Phaser 3 + Vite + plain JavaScript

- **Phaser 3** handles the 2D world: WebGL rendering, camera, arcade physics, animations, particles.
- **Vite** gives instant dev reloads and imports locale files as JSON.
- **Plain JavaScript (ES modules)**: no TypeScript build step and no framework.
- **All art is procedural.** Textures are drawn with Canvas2D in `src/render/`, so there are no
  image assets.
- **The HUD and panels are HTML/CSS** over the canvas. The *world* is all Phaser, and it stays
  the main interface: you walk up to things and people, and panels only open when you ask.

## Architecture

The simulation knows nothing about Phaser. It runs on one central, JSON-serializable state
object, and the scene renders it. That separation is what makes save/load simple, lets the
whole world run headless for tests, and lets the village keep living while you're away on an
expedition (the full simulation just runs faster with rendering paused).

Simulation randomness is seeded and its state is saved, so a loaded game carries on the same way.
Systems talk to each other through an event bus (`time:day`, `chronicle`, `npc:added`…).

```
src/
├── config/balance.js        tunable numbers (time scale, prices, needs, XP curve...)
├── data/                    content: items, skills, occupations, business types, buildings,
│                            memories, events, regions, technologies, transport, housing
├── locales/en.json, ru.json every visible string (gendered Russian, plurals)
├── i18n/i18n.js             t(), gendered forms, plurals, live language switching
├── core/                    GameState (state + migrations), Simulation, EventBus, seeded rng
├── world/                   terrain generation, A* pathfinding
├── systems/                 the simulation (no Phaser here):
│   ├── Time, Weather, Events, Disasters      calendar, seasons, floods, storms, fires, sickness
│   ├── Needs, Inventory, Progression         the player's body, pockets and growth
│   ├── NPC, Habits, Memory, Social           villager AI, routines, memories, relationships
│   ├── Dialogue, Rumor                       conversations built from real lives; gossip that bends
│   ├── Family, Lineage                       kinship, love, births, aging, death, inheritance, your heirs
│   ├── Economy, Enterprise, Logistics        shops and producers, villager businesses, goods on the roads
│   ├── Property, Growth                      ownership, rent, decay; villagers build, migrants arrive
│   ├── Nature, Resources, Farming            forests, ore, fish and game; fields and crops
│   ├── Land, Construction, Home, Crafting    your land, buildings, home and workshop
│   ├── Workers, Businesses, Jobs             your employees, your businesses, jobs and favours
│   ├── Exploration                           regions beyond the valley, expeditions, fog of war
│   ├── Tech                                  know-how, school, library, mentors, lost knowledge
│   ├── History                               the village's firsts and milestones, kept for good
│   ├── Contracts, Ambitions                  work by agreement from real needs; goals you choose
│   ├── Holdings                              businesses you own, stakes and loans in others'
│   ├── Finance                               village taxes; borrowing from the village fund
│   └── Save                                  localStorage slots + autosave
├── render/                  procedural textures
├── game/                    Phaser views: terrain, objects, buildings, NPCs, carts, fires, animals…
├── scenes/                  BootScene, GameScene (the world)
├── ui/                      HUD, panels (character, journal, map, dialogue, property, expedition…)
└── debug/                   dev-only helpers and the F9 debug panel
```

## What's in the game

- **Your own path.** Craftsman, farmer, merchant, builder, miner, explorer, entrepreneur, investor —
  or any mix. Skills gate real content, and at skill levels 3 and 7 you choose one of two **perks**
  (the other is gone for good), so builds differ. Crafted **tools, furniture and food have quality**
  (crude → masterwork) that changes how fast tools work and how long they last, how much a meal
  restores, how comfortable furniture is and what everything sells for. Smelt iron and forge tools
  at a forge (the smith's, for a fee, or your own); cook at a stove.
- **Contracts** on the notice board come from real needs: a business short of wheat, a villager
  wanting a fine table, a building site needing hands, goods to haul, orders for your own
  businesses. Deadlines and payment are real; so is the reputation hit if you let people down.
- **Ambitions**: pick long-term goals (a big farm, masterworks, landowner, explorer…) and track them
  in the Journal; achieving one goes into the village's history.
- **Businesses you own** are real village businesses: buy one from its owner (they may stay on as
  your manager) or open one in premises you own or build. Set prices, wages and staff, appoint a
  manager, work shifts, take money out of the till; fill bulk orders from other businesses. Or put
  money into other people's businesses as a stake or a loan.
- **Production chains**: once the village learns milling, a mill buys the farm's wheat and grinds
  flour; bakers make twice the bread from flour as from grinding wheat by hand. When an input runs
  out, production stops, the owner hunts for suppliers, and the shortage becomes news (and contracts).
- **Customers** weigh price, quality, distance, reputation and habit — the hard-up chase the cheapest,
  the well-off pay for better goods. A business's quality follows the skill of the people making them.
- **Jobs and wages**: businesses outbid each other when workers are scarce, share good years and cut
  back in bad ones; farms hire extra hands for summer and harvest and let them go for winter.
- **Village finances**: businesses and bigger property owners (you included) pay weekly taxes into
  the village fund, which pays for the village's services and building projects; you can borrow
  from it, with interest.
- **Home**: read at your bookshelf, warm up by the fire (winter is cold without one), and upgrade
  all the way to an estate.
- **A living village.** Villagers have homes, families, jobs, habits, hobbies and memories. They
  remember what you did and what happened to them, and they talk about it. Relationships run both
  ways (friendship, trust, respect, conflict). Feuds, friendships, courtships and weddings happen
  without you.
- **Generations.** Villagers fall in love, marry, have children, grow old, retire and die, and
  their businesses and houses pass to their heirs. You can court a villager and marry too.
  Your children grow up in your home. When you retire or die you carry on as your eldest,
  who inherits the family's money, land, houses and businesses. The village remembers what your
  parent did. If there's no heir, a newcomer starts a new line.
- **Economy.** Businesses set prices, pay wages, hire, compete, borrow, fail and get founded by
  ambitious villagers. Goods are carried along the roads by porters and carts. Money flows
  between you, villagers, businesses and the outside world.
- **Housing and growth.** Homes have owners, rent, value and condition. Empty houses decay into
  ruins. Villagers build their own houses and shops, migrants arrive when there's work, people
  leave when there isn't, and districts form.
- **Nature.** Forests regrow or get cleared, ore seams run out and new ones are found, and fish
  and game populations rise and fall.
- **Events and disasters.** Droughts, floods, storms, fires that villagers rush to put out, blight,
  sickness and trade fairs. Damage gets repaired with real materials and work.
- **Discoveries in the valley.** Caves, ruins, an abandoned cabin, an old mine shaft, standing stones
  and a derelict waystation lie out in the unknown parts of the map. Walk out and find them
  (they go on your map), go in and see what's there (loot, ore seams, knowledge — and some risk),
  then build an outpost where it makes sense: a mining camp, a hunting cabin or a trading post.
  Outposts are real businesses linked to the roads by a track; their workers settle nearby, and
  a hamlet with its own name can grow around them.
- **Exploration.** At the waymarks where the road leaves the valley, you can mount an expedition
  into the wider world, with food for the road and friends as companions. Days pass while the
  village carries on. You might come back with a new ore seam, ruins and relics, a trading
  partner or settlers, or with injuries. Villagers explore too, and the valley map fills in as
  you walk it.
- **Know-how and civilization.** Technologies such as handcarts, better tools, crop rotation,
  masonry, herbal medicine, draft animals, writing, wagons, milling and printing are worked out
  by the people doing the work. The village builds a school, a library and a mill. Children go
  to school, masters teach apprentices, and a skilled villager who dies with no apprentice takes
  their knowledge to the grave.
- **History.** The Journal keeps the news, the rumors you've heard, and a history book of the
  village's firsts and milestones across generations.
- **Languages.** English and Russian, switchable at any time, with gendered Russian grammar.
- **Saves.** Everything above is saved: an autosave on every sleep, plus 3 manual slots.

## Roadmap

1. ✅ Playable world: movement, camera, terrain, NPCs, interaction, day/night, UI, EN/RU
2. ✅ Life: needs, money, inventory, jobs, XP, skills, food, tools
3. ✅ Property: land, building, construction sites, storage, crafting
4. ✅ Workers and business: hiring, assignments, your own workshop
5. ✅ Living world: NPC memory, habits, families and generations, housing market, villager businesses
6. ✅ Settlement: migration, villager construction, districts, logistics, events and disasters
7. ✅ Generations and legacy: your family line, succession, the village's history
8. ✅ Exploration and civilization: expeditions, regions, know-how, school, library
9. ⏭ Town government, larger infrastructure (bridges, roads between settlements), other settlements

Design rules: never replace the world with menus, keep systems modular and data-driven, no fake
buttons, and let outcomes emerge from the simulation.
