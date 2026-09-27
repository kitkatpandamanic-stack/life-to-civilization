/**
 * How newsworthy each kind of chronicle entry is (0: not news): the village news on the notice board and
 * the weekly paper (NewsSystem) rank their headlines by it.
 */
export const HEADLINES = {
  // (the woods, the people, work — ForestrySystem, PopulationSystem, JobSystem, StallSystem)
  forest_regrown: 3, forester_taken_on: 2, forester_planting: 1, orchard_planted: 1, timber_imported: 2, player_planted: 2,
  wedding_feast: 2, funeral: 2, town_order: 2, town_order_done: 3, npc_charity: 1, youth_learnt_trade: 1, player_caught_thief: 2,
  youth_to_town: 2, youth_returned: 2, youth_stayed_away: 1, player_job_master: 2, player_stall: 1,
  // (mines, crime, loans — MineSystem, CrimeSystem, FinanceSystem)
  mine_deeper: 2, mine_cave_in: 3, theft: 2, theft_player: 2, thief_caught: 2, thief_banished: 3, player_constable: 2, player_bankrupt: 3, player_seized: 2,
  npc_died: 3, npc_baby: 3, npc_married: 3, business_opened_npc: 3, business_failed: 3, fire_destroyed: 3, deposit_found: 3,
  population_milestone: 3, migrants_arrived: 2, npc_left_village: 2, fire_started: 2, fire_out: 2, npc_built_home: 2,
  district_changed: 2, shortage: 2, forest_thinning: 2, fish_scarce: 2, deer_scarce: 2, npc_retired: 2, business_inherited: 2,
  business_taken_over: 2, business_handed_over: 2, npc_building: 1, village_building: 2, new_rental: 1, building_repaired: 1,
  building_abandoned: 2, building_ruined: 2, npc_evicted: 1, business_partners: 1, npc_manager: 1, business_expanding: 1,
  village_well: 1, hood_formed: 2, hood_grew: 1, hood_faded: 1, district_character: 2, npc_development: 1, npc_development_done: 2, npc_bought_lot: 1, npc_land_for_sale: 1,
  village_lane: 1, village_paved: 2, village_lamp: 1, village_bridge: 2, npc_converted: 1, building_demolished: 1, village_demolished: 1, replanting: 2, iron_running_out: 2, player_built: 2, player_land: 1, business_opened: 2,
};
export function headlineWeight(key) {
  const k = key.replace('chronicle.', '');
  if (k.startsWith('event.')) return 2;
  return HEADLINES[k] || 0;
}
