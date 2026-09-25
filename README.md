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
node tools/smoke-goals.mjs          # villagers' goals: saving, founding, buying, settling, courting, leaving
node tools/smoke-regions.mjs        # other settlements, prices, trade journeys, transport, roads, caravans
node tools/smoke-civic.mjs          # headman & elections, policies, institutions, village → town, bank, legacy
node tools/smoke-jobs.mjs           # early work: many jobs, letter rounds, hauling to building sites, new employers
node tools/smoke-ledger.mjs         # the money ledger behind "Your affairs": categories, transfers, net worth
node tools/smoke-letting.mjs        # finding tenants: to-let sign, viewings, asking, adverts at home and in other towns
node tools/smoke-education.mjs      # knowledge profiles: knowledge vs experience, aptitudes, motivation, interests, work
node tools/smoke-schools.mjs        # schools: teachers, pupils, lessons, seats, exams, evening classes, pay, policy
node tools/smoke-careers.mjs        # apprenticeships, rank from competence, trade school, business training, skill shortages
node tools/smoke-academia.mjs       # universities in the towns, graduates, doctor/engineer/researcher posts, research
node tools/smoke-knowhow.mjs        # know-how spreading between people and settlements; adoption-scaled effects
node tools/smoke-study.mjs          # your own education: classes, tutors, apprenticeship, university; teaching, sponsoring, founding
node tools/smoke-eduworld.mjs       # education and the valley: figures, specialty, landmarks, events, a 5-year run
```

In dev mode (`npm run dev` only) there's a **debug panel on F9**: live stats, simulation
timing, and buttons to trigger events, change the weather, spawn migrants, fail a business,
discover know-how and skip time. The browser console also has `dev.*` helpers (`dev.sim`,
`dev.skip(minutes)`, `dev.teleport(tx, ty)`, `dev.pump(frames)`…). See `src/debug/`.
Education has its own helpers: `dev.edu.stats()`, `dev.edu.npc(id)`, `dev.edu.setKnow(id, field, v)`,
`dev.edu.enrol(id, stage)`, `dev.edu.graduate(id)`, `dev.edu.teacher(id)`, `dev.edu.school(type)`, `dev.edu.year()`,
`dev.edu.research(pts)`, `dev.edu.unlock(tech)`, `dev.edu.event(kind)`, `dev.edu.skills()`.

## Controls

| Key | Action |
| --- | --- |
| W A S D / Arrows | Walk |
| E / Space | Interact with what's in front of you |
| F | Inspect (a villager, a building) |
| 1–9 | Pick an option in menus and conversations |
| I · C · J · M · B | Inventory · Character · Journal · Map · Build |
| K · L | Your workers · Your affairs (stats, finances, possessions, property, records) |
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
│   ├── Goals                                 what each villager is after, why — and what it makes them do
│   ├── Settlements                           other places beyond the valley, caravans, your trade journeys, roads
│   ├── Civic, Legacy                         headman & council, elections, institutions, the valley's status; your family's renown
│   └── Save                                  localStorage slots + autosave
├── render/                  procedural textures
├── game/                    Phaser views: terrain, objects, buildings, NPCs, carts, fires, animals…
├── scenes/                  BootScene, GameScene (the world)
├── ui/                      HUD, panels (character, journal, map, dialogue, property, expedition…)
└── debug/                   dev-only helpers and the F9 debug panel
```

## What's in the game

- **Education, skills and knowledge.** Every villager has a knowledge profile — knowledge in
  two dozen fields (letters, sums, trades, sciences, people skills) kept apart from practical
  experience, aptitudes (no single "intelligence"), motivation that follows their life, and
  interests that grow in adolescence and sway (never force) what they do. What they know changes
  how well they work, who hires them, what they earn and which businesses they found.
  **Schools** are real buildings: children walk there on weekday mornings, teachers are villagers
  with a post and a wage, seats run out, and lessons are only as good as the teacher, the room and
  the books. There are primary and upper classes, evening classes for grown-ups, a **trade school**
  with courses, **apprenticeships** with masters (a master's child isn't forced into the trade),
  business training, and skill shortages that businesses answer with better pay, apprentices or
  sending for someone trained. The brightest go to **universities** in the towns — and may come
  home as the valley's doctor, engineer or researcher, or stay away. A **research institute** works
  on projects whose outcome depends on the real conditions. **Know-how spreads** from person to
  person and between settlements, and a technique does its good only as far as it has spread.
  **You** can learn too (classes, tutors, a master, the library, a university on your travels),
  teach, take apprentices, pay for someone's studies, give to schools and research, and found
  schools and institutes. The valley keeps its figures (J → Learning in the valley), becomes known
  for its trades, gets landmarks, and needs literate people to become a town.
- **Letting your houses.** Put a "to let" sign on a house you own and villagers who could use a
  better home — the homeless, lodgers, crowded families, grown children still at home, tenants
  paying too much, people with a long walk to work — ask to see it, walk over in the evening and
  decide; if they say no, they tell you why (too dear, too small, happy where they are…). Advertise
  in the village to reach people who aren't looking, or post a notice in a town you trade with and
  a family may come from there to rent it. Or just ask someone, in conversation.
- **Your affairs (L).** Everything about you on five pages: a summary with your net worth; your
  finances (income and spending by category for this week, last week, four weeks or all time, the
  last 14 days as a chart, money moved in and out of the bank and your businesses, and what's coming
  due); your possessions (every material, food, tool and good in your pockets and your chest, with
  its value and your tools' wear); your property and businesses (buildings, land, outposts,
  businesses, stakes and loans, workers); and your lifetime records, skills and achievements.
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
- **Villagers with goals.** Every villager is after something: a job, savings, a home of their own,
  a business, mastery of their trade, a better job, love and children, a home near far-off work, or
  a new life elsewhere. They choose by weighing their personality, money, needs, family and friends,
  the opportunities around them, what they remember, and how the village is doing. The goal sticks,
  and it changes what they do: savers stop eating out, would-be owners buy the first house they can,
  founders open businesses, workers far out at a camp build homes next to it (that's how hamlets fill
  up), the badly paid leave you for better wages, and the unhappy pack up and go. Inspect a villager
  to see their goal and why. Ask them about it ("What are you hoping for?"): you can put money behind
  a founder's plans for a share of the business, offer work, or talk someone out of leaving.
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
- **Other settlements and trade.** Beyond the valley lie other places — a woodcutters' hamlet,
  herders under the pass, a fishing village, a mining town, a market town, a port — each with its
  own people, what it makes and what it needs, and prices that follow what's in its stores. They
  grow when they're fed and trading, shrink when they're not, and have booms and shortages you'll
  hear about. Load a cargo at the waymark and go on a trade journey: days on the road, then their
  market (every sale lowers their price, every purchase raises it), and home again. Transport
  matters: on foot you carry 20, a handcart 45, a pack horse is fast, a horse and cart or a wagon
  carry far more — but animals need feeding. The valley's warehouses and trading posts send
  caravans (set a trade route for your own), known settlements pay more for the valley's exports,
  and better roads — paid for by you, or by the village where trade is busy — make every journey
  shorter and safer. People who leave the valley go to these places; newcomers come from them.
  Districts now include learning, entertainment and trade & transport quarters.
- **Governing the village.** Once a year the grown-ups elect a headman — the most respected
  villagers stand, and so can you once your reputation is good enough. People vote for who they
  think best of and for what they'd do (the hard-up for generous poor relief, owners for low taxes).
  The headman sets taxes and poor relief (with real effects on the fund, on moods and on the next
  election) and chooses what the village saves for. In the village hall ("Village affairs") you
  see it all — and run it, if you're headman.
- **Institutions and civilization.** A share of every week's taxes goes into a civic fund; when
  it's enough, the villagers build the next institution: a market (price news from every town you
  trade with, better export prices), a night watch (fewer fires, safer roads), a healer's house
  (less sickness), a craft guild (everyone learns faster), a savings bank (loans for founders,
  interest on your savings). With people and institutions the valley grows from a village into a
  large village, a town and a city. New know-how: boats (much faster journeys to places on the
  water), irrigation, stone bridges, bookkeeping.
- **Legacy.** What you do — buildings, outposts, roads, businesses founded or backed, years as
  headman, institutions founded on your watch — is remembered as your family's deeds. Renown
  outlives you: your heir starts out trusted, and villagers bring up what the family did.
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
9. ✅ Other settlements, regional trade, transport, roads between settlements
10. ✅ Village government and elections, institutions, village → town → city, family legacy

Design rules: never replace the world with menus, keep systems modular and data-driven, no fake
buttons, and let outcomes emerge from the simulation.
