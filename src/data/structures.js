/**
 * Buildings as structures: what each kind of building can grow into.
 *
 * Every building (except a well) belongs to a family. A family has levels —
 * and a level is not "+10%": it changes what the building can do (how many
 * live or work there, what it makes, how much it holds), what it looks like
 * (walls, roof, a second floor, a wider footprint) and what it can become next.
 * On top of levels, a building can be fitted out with modules (a bedroom, a
 * kitchen, a cellar, a workbench…), some of which need more ground beside it,
 * and from a certain level it can be given a specialization.
 *
 * Level, quality and condition are separate: a Level 3 house can be a fine one
 * (87%) or a shoddy one (40%), freshly kept (100%) or run down (35%).
 *
 * See StructureSystem.
 */

/** Which family each building type belongs to, and the level it starts at. */
export const TYPE_FAMILY = {
  shack: ['house', 1],
  small_house: ['house', 2],
  house: ['house', 3],
  rental_house: ['house', 3],
  player_house: ['house', 3],
  player_large_house: ['house', 4],
  player_estate: ['house', 5],
  apartment_house: ['apartment', 1],
  farmhouse: ['farm', 2],
  smithy: ['workshop', 2],
  workshop: ['workshop', 2],
  forge: ['workshop', 1],
  mill: ['workshop', 3],
  store: ['shop', 2],
  shopfront: ['shop', 1],
  trading_post: ['shop', 1],
  tavern: ['inn', 2],
  warehouse_bld: ['warehouse', 2],
  storage_shed: ['warehouse', 1],
  barn: ['warehouse', 1],
  transport_depot: ['depot', 1],
  dock: ['depot', 1],
  rail_station: ['depot', 2],
  construction_office: ['office', 1],
  lumberyard: ['yard', 2],
  quarry_hut: ['yard', 2],
  mining_camp: ['yard', 1],
  hunting_cabin: ['yard', 1],
  school: ['school', 1],
  grammar_school: ['school', 2],
  trade_school: ['school', 1],
  hall: ['civic', 2],
  library: ['civic', 1],
  institute: ['civic', 2],
  clinic: ['civic', 1],
  watch_house: ['civic', 1],
  market_hall: ['civic', 1],
  guild_hall: ['civic', 2],
  bank: ['civic', 2],
};

const M = (money, materials, labor, extra = {}) => ({ money, materials, labor, ...extra });

/**
 * Levels, family by family. Each level:
 *   cap      — people it houses (homes) · seats (schools) · rooms (inns)
 *   staff    — extra places of work over the business's usual number
 *   output   — production multiplier · stock — how much it holds · appeal — draw for customers / tenants
 *   service  — how well a public building serves its neighbourhood
 *   floors, minW, minH — the building physically grows (wider, deeper, taller)
 *   look     — walls and roof it gets at this level
 *   value    — worth relative to level 1 · slots — modules it has room for
 *   cost     — what it takes to reach this level from the one below (money is paid up front)
 *   minSkill — your construction skill to do it yourself · tech — know-how the village needs first
 *   unlocks  — what becomes possible (shown in the building panel)
 */
export const FAMILIES = {
  house: {
    levels: [
      null,
      { cap: 2, floors: 1, minW: 3, minH: 3, value: 1, slots: 1, look: { wall: 'wood', roof: 'plank' } },
      { cap: 3, floors: 1, minW: 4, minH: 3, value: 1.35, slots: 2, look: { wall: 'wood', roof: 'thatch' }, cost: M(50, { wood: 20, planks: 10, stone: 8 }, 8), unlocks: ['kitchen', 'cellar'] },
      { cap: 4, floors: 1, minW: 4, minH: 3, value: 1.9, slots: 3, look: { wall: 'plaster', roof: 'tile' }, cost: M(120, { wood: 36, stone: 24, planks: 18, bricks: 6 }, 16, { minSkill: 2 }), unlocks: ['upper_floor', 'parlour', 'washroom', 'spec'] },
      { cap: 6, floors: 2, minW: 5, minH: 3, value: 2.9, slots: 4, look: { wall: 'plaster', roof: 'tile' }, cost: M(280, { wood: 50, stone: 40, planks: 30, bricks: 16, glass: 4 }, 26, { minSkill: 4 }), unlocks: ['cart_shed'] },
      { cap: 8, floors: 2, minW: 5, minH: 4, value: 4.4, slots: 5, look: { wall: 'stone', roof: 'slate' }, cost: M(650, { wood: 70, stone: 70, planks: 50, bricks: 30, glass: 10, iron_ingot: 6 }, 38, { minSkill: 6, tech: ['masonry'] }) },
      { cap: 8, floors: 2, minW: 6, minH: 4, value: 6.2, slots: 6, minQuality: 70, look: { wall: 'stone', roof: 'slate', flag: true, balcony: true }, cost: M(1100, { wood: 40, stone: 80, planks: 60, bricks: 50, glass: 20, iron_ingot: 10 }, 44, { minSkill: 7, tech: ['masonry'], anyTech: ['lime_mortar', 'stone_bridges', 'surveying'] }) },
    ],
    modules: ['bedroom', 'kitchen', 'cellar', 'pantry', 'parlour', 'washroom', 'upper_floor', 'cart_shed', 'garden'],
    specs: ['family', 'boarding', 'luxury'],
    specFrom: 3,
  },
  // Multi-family: many households under one roof, each in its own flat (Phase 14 — see data/apartments in StructureSystem).
  apartment: {
    levels: [
      null,
      { cap: 8, units: 3, floors: 2, minW: 5, minH: 4, value: 1, slots: 2, look: { wall: 'plaster', roof: 'tile' } },
      { cap: 12, units: 4, floors: 3, minW: 6, minH: 4, value: 1.5, slots: 3, look: { wall: 'plaster', roof: 'tile' }, cost: M(500, { wood: 50, stone: 60, planks: 50, bricks: 40, glass: 10 }, 40, { minSkill: 6, tech: ['masonry'] }) },
      { cap: 16, units: 6, floors: 3, minW: 7, minH: 4, value: 2.2, slots: 4, look: { wall: 'stone', roof: 'slate' }, cost: M(900, { stone: 90, planks: 60, bricks: 70, glass: 18, iron_ingot: 8 }, 52, { minSkill: 7, tech: ['masonry'] }) },
      { cap: 24, units: 8, floors: 4, minW: 8, minH: 5, value: 3.2, slots: 5, look: { wall: 'stone', roof: 'slate', flag: true }, cost: M(1600, { stone: 120, planks: 80, bricks: 110, glass: 30, iron_ingot: 16 }, 70, { minSkill: 8, tech: ['masonry'], anyTech: ['lime_mortar', 'surveying'] }) },
    ],
    modules: ['shop_floor', 'courtyard', 'washroom', 'cellar', 'lift', 'cart_shed'],
    specs: ['workers', 'family', 'fine'],
    specFrom: 1,
  },
  workshop: {
    levels: [
      null,
      { staff: 0, output: 1, stock: 1, floors: 1, value: 1, slots: 1, look: { wall: 'wood', roof: 'plank' } },
      { staff: 1, output: 1, stock: 1, floors: 1, value: 1.4, slots: 2, look: { wall: 'wood', roof: 'tile' }, cost: M(80, { wood: 20, planks: 14, stone: 8 }, 10), unlocks: ['extra_bench'] },
      { staff: 1, output: 1.15, stock: 1.1, floors: 1, value: 1.9, slots: 2, look: { wall: 'plaster', roof: 'tile' }, cost: M(160, { wood: 24, planks: 20, stone: 20, bricks: 8, iron_ingot: 2 }, 16, { minSkill: 2 }), unlocks: ['spec'] },
      { staff: 2, output: 1.2, stock: 1.35, floors: 2, value: 2.6, slots: 3, grow: 1, look: { wall: 'plaster', roof: 'slate' }, cost: M(260, { wood: 30, planks: 26, stone: 30, bricks: 20, glass: 4 }, 24, { minSkill: 4 }) },
      { staff: 2, output: 1.35, stock: 1.5, floors: 2, value: 3.6, slots: 4, grow: 1, apprentices: 1, look: { wall: 'stone', roof: 'slate', flag: true }, cost: M(420, { planks: 30, stone: 40, bricks: 34, glass: 8, iron_ingot: 8 }, 32, { minSkill: 5, tech: ['masonry'] }) },
    ],
    modules: ['extra_bench', 'tool_racks', 'storeroom', 'yard_shed'],
    specs: ['fine', 'volume'],
    specFrom: 3,
  },
  farm: {
    levels: [
      null,
      { staff: 0, output: 1, stock: 1, floors: 1, value: 1, slots: 1, cap: 4, look: { wall: 'wood', roof: 'thatch' } },
      { staff: 0, output: 1, stock: 1.2, floors: 1, value: 1.3, slots: 2, cap: 6, look: { wall: 'wood', roof: 'thatch' }, cost: M(70, { wood: 24, planks: 12 }, 10) },
      { staff: 1, output: 1.1, stock: 1.4, floors: 1, value: 1.8, slots: 2, cap: 6, look: { wall: 'wood', roof: 'tile' }, cost: M(150, { wood: 30, planks: 22, stone: 16 }, 16, { minSkill: 2 }), unlocks: ['spec'] },
      { staff: 1, output: 1.2, stock: 1.6, floors: 2, value: 2.4, slots: 3, cap: 8, grow: 1, look: { wall: 'plaster', roof: 'tile' }, cost: M(240, { wood: 36, planks: 30, stone: 24, bricks: 12 }, 22, { minSkill: 3 }) },
      { staff: 2, output: 1.3, stock: 1.9, floors: 2, value: 3.2, slots: 4, cap: 8, grow: 1, look: { wall: 'stone', roof: 'slate' }, cost: M(380, { wood: 30, planks: 30, stone: 40, bricks: 24, iron_ingot: 4 }, 30, { minSkill: 5 }) },
    ],
    modules: ['barn', 'storeroom', 'garden', 'bedroom'],
    specs: ['grain', 'market_garden'],
    specFrom: 3,
  },
  shop: {
    levels: [
      null,
      { staff: 0, appeal: 0, stock: 1, floors: 1, value: 1, slots: 1, look: { wall: 'wood', roof: 'plank' } },
      { staff: 0, appeal: 1, stock: 1.1, floors: 1, value: 1.35, slots: 2, look: { wall: 'plaster', roof: 'tile' }, cost: M(90, { wood: 16, planks: 16, stone: 10, glass: 2 }, 10), unlocks: ['display'] },
      { staff: 1, appeal: 1.5, stock: 1.25, floors: 1, value: 1.9, slots: 2, look: { wall: 'plaster', roof: 'slate' }, cost: M(180, { wood: 20, planks: 22, stone: 20, bricks: 10, glass: 4 }, 16, { minSkill: 2 }), unlocks: ['spec'] },
      { staff: 1, appeal: 2.2, stock: 1.5, floors: 2, value: 2.6, slots: 3, grow: 1, look: { wall: 'plaster', roof: 'slate' }, cost: M(300, { wood: 24, planks: 30, stone: 26, bricks: 22, glass: 8 }, 24, { minSkill: 4 }) },
      { staff: 2, appeal: 3.2, stock: 1.8, floors: 2, value: 3.6, slots: 4, grow: 1, look: { wall: 'stone', roof: 'slate', flag: true }, cost: M(480, { planks: 34, stone: 40, bricks: 36, glass: 14, iron_ingot: 4 }, 32, { minSkill: 5, tech: ['masonry'] }) },
    ],
    modules: ['display', 'stockroom', 'storeroom'],
    specs: ['bargain', 'fine'],
    specFrom: 3,
  },
  inn: {
    levels: [
      null,
      { staff: 0, appeal: 0, cap: 2, floors: 1, value: 1, slots: 1, look: { wall: 'wood', roof: 'thatch' } },
      { staff: 0, appeal: 0.5, cap: 3, floors: 1, value: 1.3, slots: 2, look: { wall: 'wood', roof: 'tile' } },
      { staff: 1, appeal: 1.2, cap: 5, floors: 2, value: 1.8, slots: 3, look: { wall: 'plaster', roof: 'tile' }, cost: M(220, { wood: 30, planks: 30, stone: 20, bricks: 10, glass: 2 }, 20, { minSkill: 3 }), unlocks: ['guest_rooms', 'spec'] },
      { staff: 1, appeal: 2, cap: 7, floors: 2, value: 2.5, slots: 3, grow: 1, look: { wall: 'plaster', roof: 'slate' }, cost: M(340, { wood: 30, planks: 34, stone: 30, bricks: 24, glass: 6 }, 26, { minSkill: 4 }) },
      { staff: 2, appeal: 3, cap: 9, floors: 2, value: 3.4, slots: 4, grow: 1, travellers: true, look: { wall: 'stone', roof: 'slate', flag: true }, cost: M(520, { planks: 36, stone: 44, bricks: 36, glass: 10, iron_ingot: 4 }, 34, { minSkill: 5, tech: ['masonry'] }) },
    ],
    modules: ['guest_rooms', 'stockroom', 'garden'],
    specs: ['alehouse', 'coaching'],
    specFrom: 3,
  },
  warehouse: {
    levels: [
      null,
      { staff: 0, stock: 1, floors: 1, value: 1, slots: 1, look: { wall: 'wood', roof: 'plank' } },
      { staff: 0, stock: 1.5, floors: 1, value: 1.4, slots: 1, look: { wall: 'wood', roof: 'plank' }, cost: M(70, { wood: 26, planks: 16 }, 10) },
      { staff: 1, stock: 2, floors: 1, value: 1.9, slots: 2, look: { wall: 'wood', roof: 'tile' }, cost: M(160, { wood: 30, planks: 24, stone: 20, bricks: 6 }, 16, { minSkill: 2 }) },
      { staff: 1, stock: 2.6, floors: 2, value: 2.6, slots: 2, grow: 1, look: { wall: 'stone', roof: 'tile' }, cost: M(260, { planks: 30, stone: 40, bricks: 16, iron_ingot: 2 }, 22, { minSkill: 3 }) },
      { staff: 2, stock: 3.4, floors: 2, value: 3.4, slots: 3, grow: 1, look: { wall: 'stone', roof: 'slate' }, cost: M(400, { planks: 34, stone: 50, bricks: 28, iron_ingot: 6 }, 30, { minSkill: 5 }) },
    ],
    modules: ['loading_bay', 'storeroom'],
    specs: [],
  },
  yard: {
    levels: [
      null,
      { staff: 0, output: 1, stock: 1, floors: 1, value: 1, slots: 1, look: { wall: 'wood', roof: 'plank' } },
      { staff: 1, output: 1, stock: 1.2, floors: 1, value: 1.4, slots: 1, look: { wall: 'wood', roof: 'plank' }, cost: M(70, { wood: 22, planks: 12 }, 10) },
      { staff: 1, output: 1.15, stock: 1.4, floors: 1, value: 1.9, slots: 2, look: { wall: 'wood', roof: 'tile' }, cost: M(150, { wood: 26, planks: 20, stone: 16, iron_ingot: 2 }, 16, { minSkill: 2 }) },
      { staff: 2, output: 1.2, stock: 1.6, floors: 1, value: 2.5, slots: 2, look: { wall: 'stone', roof: 'tile' }, cost: M(240, { planks: 24, stone: 30, bricks: 10, iron_ingot: 4 }, 22, { minSkill: 3 }) },
      { staff: 2, output: 1.35, stock: 1.9, floors: 1, value: 3.2, slots: 3, look: { wall: 'stone', roof: 'slate' }, cost: M(380, { planks: 30, stone: 40, bricks: 20, iron_ingot: 8 }, 30, { minSkill: 5 }) },
    ],
    modules: ['extra_bench', 'storeroom', 'yard_shed'],
    specs: [],
  },
  // Where barrows, carts and wagons are kept: each level has room for more, and a repair bay from level 2.
  depot: {
    levels: [
      null,
      { staff: 0, stock: 1, parking: 6, floors: 1, value: 1, slots: 1, look: { wall: 'wood', roof: 'plank' } },
      { staff: 0, stock: 1.3, parking: 10, repairBay: true, floors: 1, value: 1.4, slots: 1, look: { wall: 'wood', roof: 'tile' }, cost: M(90, { wood: 24, planks: 18, stone: 10 }, 12), unlocks: ['repair_bay'] },
      { staff: 1, stock: 1.6, parking: 14, repairBay: true, floors: 1, value: 1.9, slots: 2, grow: 1, look: { wall: 'stone', roof: 'tile' }, cost: M(200, { planks: 26, stone: 30, bricks: 10, iron_ingot: 3 }, 20, { minSkill: 3 }) },
    ],
    modules: ['storeroom'],
    specs: [],
  },
  // Your contracting business's office: more work at a time, the higher it goes.
  office: {
    levels: [
      null,
      { staff: 0, contracts: 1, floors: 1, value: 1, slots: 1, look: { wall: 'plaster', roof: 'tile' } },
      { staff: 0, contracts: 2, floors: 1, value: 1.4, slots: 1, look: { wall: 'plaster', roof: 'tile' }, cost: M(150, { planks: 20, stone: 20, glass: 2 }, 14, { minSkill: 3 }) },
      { staff: 1, contracts: 3, floors: 2, value: 2, slots: 2, look: { wall: 'stone', roof: 'slate', flag: true }, cost: M(320, { planks: 30, stone: 36, bricks: 16, glass: 6 }, 24, { minSkill: 4 }) },
    ],
    modules: ['storeroom'],
    specs: [],
  },
  school: {
    levels: [
      null,
      { seats: 0, service: 1, floors: 1, value: 1, slots: 1, look: { wall: 'wood', roof: 'tile' } },
      { seats: 6, service: 1.1, floors: 1, value: 1.4, slots: 2, look: { wall: 'plaster', roof: 'tile' }, cost: M(0, { wood: 26, planks: 22, stone: 16 }, 16) },
      { seats: 12, service: 1.2, floors: 2, value: 2, slots: 2, look: { wall: 'plaster', roof: 'slate' }, cost: M(0, { wood: 30, planks: 30, stone: 30, bricks: 14, glass: 6 }, 24) },
      { seats: 18, service: 1.3, floors: 2, value: 2.7, slots: 3, grow: 1, look: { wall: 'stone', roof: 'slate' }, cost: M(0, { planks: 36, stone: 44, bricks: 30, glass: 10 }, 32, { tech: ['masonry'] }) },
      { seats: 26, service: 1.45, floors: 2, value: 3.6, slots: 3, grow: 1, look: { wall: 'stone', roof: 'slate', flag: true }, cost: M(0, { planks: 40, stone: 60, bricks: 44, glass: 16, iron_ingot: 4 }, 40, { tech: ['masonry'] }) },
    ],
    modules: ['classroom', 'library_room', 'garden'],
    specs: [],
  },
  civic: {
    levels: [
      null,
      { service: 1, floors: 1, value: 1, slots: 1, look: {} },
      { service: 1.15, floors: 1, value: 1.4, slots: 1, look: {}, cost: M(0, { wood: 20, planks: 20, stone: 20, bricks: 6 }, 16) },
      { service: 1.3, floors: 2, value: 2, slots: 2, look: { roof: 'slate', clock: true }, cost: M(0, { planks: 30, stone: 36, bricks: 20, glass: 6 }, 24) },
      { service: 1.45, floors: 2, value: 2.7, slots: 2, grow: 1, look: { wall: 'stone', roof: 'slate', clock: true }, cost: M(0, { planks: 36, stone: 50, bricks: 34, glass: 10 }, 32, { tech: ['masonry'] }) },
      { service: 1.6, floors: 3, value: 3.6, slots: 3, grow: 1, look: { wall: 'stone', roof: 'slate', flag: true, clock: true }, cost: M(0, { planks: 40, stone: 64, bricks: 48, glass: 16, iron_ingot: 6 }, 40, { tech: ['masonry'] }) },
    ],
    modules: ['garden', 'storeroom'],
    specs: [],
  },
};

/**
 * Modules — what a building can be fitted out with.
 *   fams    — families it fits · from — lowest level · once — only one of it (default) · max — or up to this many
 *   space   — extra columns of ground it takes beside the building (it physically grows)
 *   cap / staff / stock / output / appeal / comfort / storage / service / seats — what it adds
 *   quality — adds to the building's quality · value — worth multiplier
 *   needs   — { tech, water (a well or the river near), road }
 */
export const MODULES = {
  bedroom: { fams: ['house', 'farm'], from: 1, max: 3, cap: 2, value: 1.08, cost: M(40, { wood: 14, planks: 12, stone: 4 }, 8) },
  kitchen: { fams: ['house'], from: 2, comfort: 6, quality: 4, appeal: 0.6, value: 1.06, cost: M(60, { stone: 10, bricks: 8, iron_ingot: 2, planks: 6 }, 8) },
  cellar: { fams: ['house', 'apartment'], from: 2, storage: 120, warm: true, value: 1.04, cost: M(50, { stone: 30 }, 12) },
  pantry: { fams: ['house'], from: 1, storage: 80, value: 1.02, cost: M(20, { wood: 8, planks: 10 }, 4) },
  parlour: { fams: ['house'], from: 3, comfort: 8, appeal: 0.8, quality: 3, value: 1.06, cost: M(60, { planks: 16, wood: 8, glass: 2 }, 8) },
  washroom: { fams: ['house', 'apartment'], from: 3, comfort: 5, quality: 5, appeal: 0.8, health: true, value: 1.06, needs: { water: true }, cost: M(70, { stone: 12, bricks: 6, planks: 6, iron_ingot: 1 }, 8) },
  upper_floor: { fams: ['house'], from: 3, floors: 1, cap: 3, value: 1.2, cost: M(140, { wood: 30, planks: 28, stone: 10, bricks: 10, glass: 2 }, 20) },
  cart_shed: { fams: ['house', 'apartment'], from: 3, space: 1, appeal: 0.4, value: 1.05, needs: { tech: 'handcart', road: true }, cost: M(30, { wood: 20, planks: 8 }, 6) },
  garden: { fams: ['house', 'farm', 'inn', 'school', 'civic'], from: 1, space: 2, comfort: 5, appeal: 0.6, food: 1, value: 1.05, cost: M(15, { wood: 10 }, 5) },
  // Work premises
  extra_bench: { fams: ['workshop', 'yard'], from: 2, staff: 1, value: 1.05, cost: M(40, { planks: 16, iron_ingot: 1 }, 6) },
  tool_racks: { fams: ['workshop'], from: 1, output: 0.06, value: 1.03, cost: M(30, { planks: 10, iron_ingot: 2 }, 4) },
  storeroom: { fams: ['workshop', 'farm', 'shop', 'warehouse', 'yard', 'inn', 'civic', 'depot', 'office'], from: 1, stock: 0.25, value: 1.04, cost: M(40, { wood: 12, planks: 14 }, 6) },
  yard_shed: { fams: ['workshop', 'yard'], from: 2, space: 1, stock: 0.2, output: 0.04, value: 1.05, cost: M(30, { wood: 18, planks: 8 }, 6) },
  barn: { fams: ['farm'], from: 1, space: 2, stock: 0.5, output: 0.05, value: 1.1, cost: M(60, { wood: 30, planks: 16 }, 10) },
  display: { fams: ['shop'], from: 2, appeal: 1, value: 1.05, cost: M(50, { planks: 10, glass: 4 }, 6) },
  stockroom: { fams: ['shop', 'inn'], from: 2, stock: 0.35, value: 1.05, cost: M(40, { wood: 12, planks: 16 }, 6) },
  guest_rooms: { fams: ['inn'], from: 3, cap: 2, appeal: 0.5, value: 1.08, cost: M(90, { wood: 16, planks: 20, stone: 8 }, 10) },
  loading_bay: { fams: ['warehouse'], from: 2, space: 1, stock: 0.4, staff: 1, value: 1.06, cost: M(50, { wood: 20, planks: 12, stone: 10 }, 8) },
  classroom: { fams: ['school'], from: 2, seats: 8, value: 1.08, cost: M(0, { wood: 16, planks: 20, stone: 8 }, 10) },
  library_room: { fams: ['school'], from: 2, service: 0.1, value: 1.04, cost: M(0, { planks: 16, glass: 2 }, 6) },
  // Apartment buildings (Phase 14)
  shop_floor: { fams: ['apartment'], from: 1, shop: true, value: 1.12, cost: M(120, { planks: 20, stone: 16, glass: 4 }, 12) },
  courtyard: { fams: ['apartment'], from: 1, space: 1, comfort: 4, appeal: 0.6, value: 1.05, cost: M(40, { stone: 16 }, 6) },
  lift: { fams: ['apartment'], from: 3, appeal: 1.2, value: 1.1, needs: { tech: 'wagons' }, cost: M(200, { iron_ingot: 12, planks: 20 }, 16) },
};

/** Specializations, chosen once the building is big enough (StructureSystem.effects). */
export const SPECS = {
  family: { comfort: 3 },
  boarding: { cap: 2, quality: -8, rentMult: 0.85 },
  luxury: { minQuality: 70, rentMult: 1.3, appeal: 1, comfort: 6 },
  workers: { cap: 4, quality: -6, rentMult: 0.8 },
  fine: { quality: 6, output: -0.05, appeal: 0.8, rentMult: 1.2 },
  volume: { output: 0.12, quality: -4 },
  grain: { output: 0.1 },
  market_garden: { output: 0.05, food: 2 },
  bargain: { appeal: 0.8, poorAppeal: 1.5 },
  alehouse: { appeal: 1 },
  coaching: { cap: 2, travellers: true },
};

/** Rendering: what walls and roofs look like as a building improves. */
export const LOOK_COLORS = {
  wood: ['#b58a5a', '#a57a4c', '#9c7a52', '#b88b58'],
  plaster: ['#e8dcc0', '#dfe6d2', '#efd9c4', '#d9cfc0', '#f0e4c8'],
  stone: ['#c9bfa8', '#b8b0a0', '#d2c9b3', '#b3a68f'],
  roof: { plank: '#6d4c33', thatch: '#c9a45a', tile: ['#b0503a', '#a0453e', '#8f3b2e', '#9c6b2e'], slate: ['#4f6a8f', '#56657a', '#3f5a7a', '#4a4f5a'] },
};

/** Which of your home tiers (interior, comfort, storage — data/homes.js) a house of each level gives you. */
export const HOME_TIER_OF_LEVEL = [null, 'shack', 'small_house', 'house', 'large_house', 'estate', 'estate'];

/** Quality: how well a building was made and has been kept (0–100). */
export const QUALITY = {
  seedBase: 50, // the valley's first buildings, give or take
  seedSpread: 18,
  byType: { shack: 28, hall: 68, tavern: 60, store: 58, smithy: 56, farmhouse: 52, lumberyard: 44, quarry_hut: 46 },
  builtBase: 42, // a new building: this, plus the builder's skill and the materials…
  perBuilderSkill: 3.5,
  stoneBonus: 4, // stone, bricks, glass and iron in the work
  brickBonus: 6,
  glassBonus: 3,
  ironBonus: 2,
  renovateGain: 14, // a renovation brings it up by this much (towards the level's ceiling)
  capBase: 62, // the best a building of level 1 can be; each level raises the ceiling
  capPerLevel: 6,
  capPerModule: 1.5,
  neglectBelow: 40, // a building this run down loses quality week by week
  neglectPerWeek: 0.8,
  maxHistory: 24,
};

/** Upgrading work: renovation, conversion, demolition (Phases 13, 15 build on these). */
export const WORKS = {
  renovate: { perQualityPoint: { planks: 0.25, stone: 0.12, bricks: 0.1 }, moneyPerPoint: 3, laborPerPoint: 0.5, minLabor: 4 },
  laborPerLevelHour: 60, // minutes per hour of 'labor' in the tables
  npcUpgradeMaxPerWeek: 2, // new works villagers start in a week (the valley isn't rebuilt overnight)
  npcMoneyCushion: 1.25, // a villager wants this × the cost in savings before starting
  crowdedUpgrade: true,
};

/** How big a building is, by family and level, if nothing else says so (for new buildings and old saves). */
export function levelDef(fam, lvl) {
  return FAMILIES[fam]?.levels[lvl] || null;
}
export function maxLevel(fam) {
  return (FAMILIES[fam]?.levels.length || 1) - 1;
}

/**
 * Changing what a building is (Phase 13): conversions — building by building, not everything into
 * everything. A house can become a shop or a workshop; a shop a small house or a workshop; a workshop
 * a warehouse or a shop; a warehouse a workshop; a shed a workshop. (A large house can become a block
 * of flats — Phase 14.) It stays the same size; its quality comes with it.
 */
export const CONVERSIONS = {
  shack: ['storage_shed'],
  small_house: ['shopfront', 'workshop'],
  house: ['shopfront', 'workshop'],
  rental_house: ['shopfront', 'workshop'],
  player_house: ['shopfront', 'workshop'],
  player_large_house: ['shopfront', 'workshop'],
  shopfront: ['small_house', 'workshop'],
  trading_post: ['shopfront'],
  workshop: ['warehouse_bld', 'shopfront'],
  warehouse_bld: ['workshop'],
  storage_shed: ['workshop'],
};

/** What it takes: converting, pulling down (and what's salvaged), joining two buildings into one. */
export const REBUILD = {
  convert: { money: 30, moneyPerTile: 6, perTile: { planks: 1, wood: 0.5, stone: 0.4 }, labor: 4, laborPerTile: 0.5, minSkill: 1 },
  demolish: { money: 5, moneyPerTile: 4, labor: 2, laborPerTile: 0.4, salvage: 0.35, perTile: { planks: 1.2, wood: 1, stone: 1 } },
  merge: { money: 60, moneyPerTile: 8, perTile: { planks: 1, stone: 0.8 }, extra: { bricks: 4 }, labor: 10, laborPerTile: 0.6, minSkill: 2, maxGap: 3, maxW: 12, maxH: 5 },
};
