/**
 * Neighbourhoods and districts (PlaceSystem).
 *
 * A neighbourhood is a cluster of homes that has grown together along a road — with people
 * living in them — and it gets a name from what's around it (the river, the mill, the woods…).
 * A district is a larger stretch of the village with one main use (homes, trade, work, fields,
 * learning…) — and a character: an old residential district of the first houses, a new
 * development where most of it has only just gone up.
 */

/** When a cluster of homes counts as a neighbourhood, and what it's made of. */
export const HOODS = {
  link: 13, // homes whose doors are this close (tiles, walking) belong to the same cluster …
  maxSpan: 22, // … while the whole cluster stays within this many tiles across (a neighbourhood is a walk, not the valley)
  minHomes: 3, // (the valley is small: three houses on a lane, with people in them, are a neighbourhood)
  minPop: 4,
  roadShare: 0.5, // at least this share of its homes with a road close by …
  roadReach: 6, // … this close (tiles from the door)
  margin: 4, // its ground: the homes and this many tiles around them
  serviceRadius: 12, // a shop, a school, a well this close to its middle serves it
  mixedShare: 0.3, // shops, workshops… this share of its buildings or more: a mixed neighbourhood
  workersIndustry: 2, // this many workshops among the homes: a workers' quarter
  fadeWeeks: 3, // a neighbourhood that no longer holds together fades from memory after this many weeks
  keepEvents: 16,
  milestones: [6, 8, 10, 15, 20, 30], // homes: "it has grown to…" (from 8 it's news)
  // Its standing (−0.3…+0.3): kept houses, services, quiet — what people say about living there.
  repMax: 0.3,
  repQuality: 0.3, // (average quality − 50) / 100 × this
  repCondition: 0.2, // (average condition − 70) / 100 × this
  repPerService: 0.04,
  repPerRuin: 0.08,
  repPerWorkshop: 0.04,
  valueShare: 0.15, // standing → what its houses fetch (± this share of the standing)
  areaShare: 1, // standing → how villagers rate the area when choosing a home (HousingSystem)
};

/** What a neighbourhood's name comes from, in order of what stands out most. */
export const HOOD_FEATURES = ['river', 'mill', 'plaza', 'forge', 'well', 'fields', 'woods', 'hill'];
export const HOOD_NAME_VARIANTS = 4;

/** Services a neighbourhood can have near it: what each one is, by building. */
export const HOOD_SERVICES = {
  well: { types: ['well'] },
  shop: { kinds: ['shop'] },
  tavern: { kinds: ['leisure'] },
  school: { kinds: ['school', 'research'] },
  clinic: { types: ['clinic'] },
  watch: { types: ['watch_house'] },
};

/** Districts: their character (old / new / a university quarter). */
export const DISTRICTS = {
  cell: 10, // tiles per district cell (GrowthSystem's grid)
  every: 14, // days between recounts (day % every === at)
  at: 5,
  foundingAge: 300, // the valley's first buildings count as this many days old
  oldDays: 150, // a residential district this old on average is the old residential district
  newDays: 84, // built within this many days …
  newShare: 0.55, // … for this share of its buildings (or sites going up): a new development
  newSites: 2,
  keepEvents: 16,
};
