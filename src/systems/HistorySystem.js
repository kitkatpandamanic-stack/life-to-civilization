/**
 * HistorySystem — the village's history book.
 *
 * The chronicle is a rolling news feed (the last couple of hundred things
 * that happened). History keeps what matters for good: the firsts (the first
 * baby born here, the first shop a villager opened, the first house someone
 * built with their own hands), the milestones (the village reaching 50 people,
 * a new district), the disasters, and your family's story across generations.
 *
 *   state.history = { entries: [{ day, key, params, first? }], firsts: { kind: day }, samples: [...] }
 *
 * It also keeps a weekly record — the valley in numbers, and your affairs (samples: population, your
 * money and what you're worth, businesses, the treasury, the price of bread, your workers, the status)
 * — for the charts in the journal's history.
 */
const MAX_SAMPLES = 400; // (weekly: some fifty years of the valley)
const STATUS = ['village', 'large_village', 'town', 'city'];
const MAX_ENTRIES = 400;

/** Always part of history. */
const MILESTONES = new Set([
  'chronicle.player_arrived',
  'chronicle.population_milestone',
  'chronicle.deposit_found',
  'chronicle.district_changed',
  'chronicle.hood_formed',
  'chronicle.npc_development_done',
  'chronicle.village_bridge',
  'chronicle.player_bridge',
  'chronicle.district_character',
  'chronicle.fire_destroyed',
  'chronicle.player_married',
  'chronicle.player_child',
  'chronicle.player_died',
  'chronicle.player_retired',
  'chronicle.heir_continues',
  'chronicle.line_ended',
  'chronicle.newcomer_arrives',
  'chronicle.event.flood',
  'chronicle.event.blight',
  'chronicle.event.mine_collapse',
  'chronicle.event.migration_wave',
  'chronicle.event.drought',
  'chronicle.event.sickness',
  'chronicle.region_discovered',
  'chronicle.exp_partner',
  'chronicle.exp_partner_npc',
  'chronicle.exp_settlers',
  'chronicle.exp_companion_died',
  'chronicle.tech_discovered',
  'chronicle.tech_discovered_by',
  'chronicle.village_school',
  'chronicle.village_grammar_school',
  'chronicle.first_pupils',
  'chronicle.first_graduate_primary',
  'chronicle.first_graduate_secondary',
  'chronicle.first_graduate_vocational',
  'chronicle.village_trade_school',
  'chronicle.first_course',
  'chronicle.first_student',
  'chronicle.first_university_graduate',
  'chronicle.first_breakthrough',
  'chronicle.famous_researcher',
  'chronicle.village_institute',
  'chronicle.player_founded_school',
  'chronicle.education_centre',
  'chronicle.literacy_milestone',
  'chronicle.landmark_old_school',
  'chronicle.landmark_famous_institute',
  'chronicle.landmark_historic_workshop',
  'chronicle.valley_known_for',
  'chronicle.player_degree',
  'chronicle.research_success',
  'chronicle.village_library',
  'chronicle.village_mill',
  'chronicle.craft_lost',
  'chronicle.player_ambition',
  'chronicle.outpost_founded',
  'chronicle.hamlet_founded',
  'chronicle.settlement_contact',
  'chronicle.headman_elected',
  'chronicle.player_elected',
  'chronicle.institution_founded',
  'chronicle.institution_founded_player',
  'chronicle.village_status',
  'chronicle.village_status_player',
  'chronicle.legacy_goodwill',
  'chronicle.settlement_grew',
  'chronicle.road_finished',
  'chronicle.player_kept_villager',
  // The last few upgrades: the railway, your rival, the town, the valley's stories.
  'chronicle.railway_opened',
  'chronicle.rival_appears',
  'chronicle.rival_bust',
  'chronicle.rival_bought_out',
  'chronicle.rival_partner',
  'chronicle.hall_grows',
  'chronicle.carting_company',
  'chronicle.my_first_caravan',
  'chronicle.river_up',
]);

/** Only the first time is history (after that it's just news). */
const FIRSTS = {
  'chronicle.npc_baby': 'birth',
  'chronicle.npc_died': 'death',
  'chronicle.npc_married': 'wedding',
  'chronicle.business_opened_npc': 'business',
  'chronicle.business_failed': 'bankruptcy',
  'chronicle.npc_built_home': 'self_built_home',
  'chronicle.village_building': 'village_building',
  'chronicle.village_well': 'well',
  'chronicle.migrants_arrived': 'migrants',
  'chronicle.npc_left_village': 'emigrant',
  'chronicle.fire_started': 'fire',
  'chronicle.caravan': 'caravan',
  'chronicle.player_built': 'player_built',
  'chronicle.player_bought_property': 'player_property',
  'chronicle.player_hired': 'player_employer',
  'chronicle.npc_evicted': 'eviction',
  'chronicle.expedition_back': 'player_expedition',
  'chronicle.npc_expedition_back': 'npc_expedition',
  'chronicle.exp_ruins': 'ruins',
  'chronicle.exp_relic': 'relic',
  'chronicle.new_teacher': 'teacher',
  'chronicle.talented_pupil': 'talent',
  'chronicle.journeyman': 'journeyman',
  'chronicle.business_academy': 'academy',
  'chronicle.npc_became_master': 'master',
  'chronicle.post_doctor': 'doctor',
  'chronicle.post_engineer': 'engineer',
  'chronicle.graduate_returned': 'graduate_home',
  'chronicle.graduate_stayed': 'brain_drain',
  'chronicle.player_sponsored': 'player_sponsor',
  'chronicle.school_closed': 'school_closed',
  'chronicle.scholar_arrives': 'scholar',
  'chronicle.new_university': 'new_university',
  'chronicle.player_taught': 'player_teacher',
  'chronicle.journeyman_player': 'player_master',
  'chronicle.site_explored': 'site_explored',
  'chronicle.npc_apprentice': 'apprentice',
  'chronicle.craft_passed_on': 'craft_passed_on',
  'chronicle.exp_ruins_npc': 'ruins',
  'chronicle.exp_relic_npc': 'relic',
  'chronicle.caravan_back': 'caravan_trade',
  'chronicle.journey_back': 'player_journey',
  'chronicle.migrants_from': 'migrants',
  'chronicle.npc_left_to': 'emigrant',
};

export class HistorySystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.history ??= { entries: [], firsts: {} };
    sim.state.history.samples ??= [];
    sim.bus.on('chronicle', (e) => this.onChronicle(e));
    sim.bus.on('time:day', () => this.sample());
  }

  // ------------------------------------------------------------------ the valley in numbers

  /** Once a week (and the first day we can): a line in the record. */
  sample(force = false) {
    const sim = this.sim;
    const S = this.H.samples;
    const day = sim.time.day;
    if (S.length && S[S.length - 1].d === day) return null;
    if (!force && S.length && day % 7 !== 0) return null;
    const store = sim.economy?.ofType('general_store')[0];
    const row = {
      d: day,
      pop: sim.state.npcs.length,
      money: Math.round(sim.state.player.money),
      worth: Math.round(sim.ledger?.netWorth().total ?? sim.state.player.money),
      biz: sim.economy?.active().length || 0,
      mine: (sim.holdings?.mine().length || 0) + (sim.businesses?.list().length || 0),
      treasury: Math.round(sim.state.village?.treasury || 0),
      bread: store ? Math.round(sim.economy.unitPrice(store, 'bread') * 10) / 10 : 0,
      workers: sim.workers?.list().length || 0,
      status: STATUS.indexOf(sim.civic?.V.status || 'village'),
    };
    S.push(row);
    if (S.length > MAX_SAMPLES) S.shift();
    return row;
  }

  samples() {
    if (!this.H.samples.length) this.sample(true);
    return this.H.samples;
  }

  get H() {
    return this.sim.state.history;
  }

  onChronicle(e) {
    // How a story ended is part of the valley's history (StorySystem).
    if (e.key.startsWith('story.')) return this.add(e);
    const kind = FIRSTS[e.key];
    if (kind) {
      if (this.H.firsts[kind] !== undefined) return;
      this.H.firsts[kind] = e.day;
      this.add({ ...e, first: true });
    } else if (MILESTONES.has(e.key)) this.add(e);
  }

  add(e) {
    this.H.entries.push({ day: e.day, key: e.key, params: e.params, ...(e.first ? { first: true } : {}) });
    if (this.H.entries.length > MAX_ENTRIES) this.H.entries.splice(1, 1); // keep the founding
  }

  /** Entries grouped by year, newest year first. */
  byYear(yearOf) {
    const out = new Map();
    for (const e of this.H.entries) {
      const y = yearOf(e.day);
      if (!out.has(y)) out.set(y, []);
      out.get(y).push(e);
    }
    return [...out.entries()].sort((a, b) => b[0] - a[0]);
  }

  /** Things the player's family did, for legacy talk: "your mother built…" */
  lineage() {
    return this.sim.state.lineage || [];
  }
}
