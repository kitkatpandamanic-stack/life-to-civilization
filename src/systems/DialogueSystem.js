/**
 * DialogueSystem — what a villager wants to talk about, right now.
 *
 * Nothing here is canned small talk: every topic is generated from the
 * simulation — their memories (of you and of their own life), their job and
 * boss, their family, their goals, their habits, prices and shortages, who is
 * hiring, and village news. Each topic gets a score; personal topics only come
 * up once they trust you. The UI turns { key, params } into localized text.
 *
 * Modes: 'chat' (anything), 'news' (what's going on in the village),
 *        'life' (their own life — needs some trust).
 */
import { OCCUPATIONS } from '../data/occupations.js';
import { GOAL_AGAINST } from '../data/goals.js';
import { rand } from '../core/rng.js';

const PLAYER_MEMORY_LINES = new Set([
  'player_gave_job', 'player_hired', 'player_fired', 'player_fired_unfair', 'player_raise', 'player_pay_cut', 'player_unpaid',
  'player_promoted', 'player_loved_gift', 'player_helped', 'player_let_down', 'bought_from_player', 'quit_player',
  'heard_player_good', 'heard_player_bad', 'saw_friend_fired', 'player_failed_job', 'left_player_for_business',
  'player_helped_build', 'player_fought_fire', 'explored_with_player', 'sold_business_to_player',
  'player_backed_dream', 'player_asked_stay', 'player_let_down_backer', 'rented_from_player',
  'sponsored_by_player', 'took_player_apprentice', 'taught_player', 'player_journeyman',
  'given_notice', 'rent_raised', 'rent_lowered', 'manages_player_houses',
]);
const SELF_MEMORY_LINES = new Set([
  'got_job', 'quit_job', 'unpaid_wages', 'promoted_rank', 'grew_up', 'took_up_hobby', 'was_sick', 'went_hungry', 'slept_rough',
  'became_friends', 'fell_out', 'argued_with', 'lived_through',
  'fell_in_love', 'broke_up', 'married', 'child_born', 'sibling_born', 'family_died', 'friend_died', 'inherited',
  'took_over_business', 'retired', 'moved_home', 'moved_out', 'evicted', 'bought_home', 'family_wedding',
  'opened_business', 'family_business', 'business_struggling', 'business_failed', 'became_manager', 'laid_off',
  'changed_jobs', 'employee_left', 'backed_business', 'got_backing',
  'started_building', 'helped_build', 'built_home', 'gave_up_building', 'arrived_village', 'friend_left',
  'home_flood', 'home_storm', 'home_fire', 'home_burnt', 'mine_accident', 'took_in', 'fire_helped', 'went_exploring', 'laid_off_season', 'invented', 'became_teacher', 'mentored_by', 'took_apprentice', 'new_interest', 'finished_school', 'left_school', 'failed_exam', 'finished_course', 'finished_apprenticeship', 'apprenticeship_ended', 'wants_retrain', 'rose_in_trade', 'went_to_university', 'child_to_university', 'graduated', 'failed_degree', 'cant_afford_study', 'took_post', 'made_discovery',
  'goal_achieved', 'goal_given_up', 'moved_near_work', 'decided_to_leave', 'stayed_for_family', 'became_headman', 'bank_loan',
  'bought_rental',
]);

export class DialogueSystem {
  constructor(sim) {
    this.sim = sim;
  }

  /** Is this villager open enough to talk about personal things with the player? */
  isOpen(npc) {
    const tier = this.sim.social.tier(npc);
    if (tier === 'hostile' || tier === 'wary' || tier === 'stranger') return false;
    return npc.rel >= 22 || this.sim.social.playerBond(npc).t >= 12;
  }

  /** Choose one topic. Returns { key, params } (params are ids, resolved by the UI). */
  pick(npc, mode = 'chat') {
    if (mode === 'life' && !this.isOpen(npc)) return { key: 'talk.deflect', params: {} };
    const topics = this.topics(npc, mode);
    npc.recentTopics ??= [];
    const fresh = topics.filter((t) => !npc.recentTopics.includes(t.key + (t.params.npc || '')));
    const pool = fresh.length ? fresh : topics;
    if (!pool.length) return { key: mode === 'news' ? 'talk.news.nothing' : 'talk.nothing', params: {} };
    const chosen = rand.weighted(pool.map((t) => [t, Math.pow(t.score, 1.4)]));
    npc.recentTopics.push(chosen.key + (chosen.params.npc || ''));
    if (npc.recentTopics.length > 4) npc.recentTopics.shift();
    if (chosen.memory) chosen.memory.told = this.sim.time.day;
    if (chosen.params.rumor) this.sim.rumors?.heard(chosen.params.rumor);
    return { key: chosen.key, params: chosen.params };
  }

  topics(npc, mode) {
    const out = [];
    const add = (key, params, score, memory = null) => out.push({ key, params, score, memory });
    const open = this.isOpen(npc);
    if (mode !== 'news') {
      this.memoryTopics(npc, add, open);
      this.workTopics(npc, add, open);
      if (open) this.familyTopics(npc, add);
      this.goalTopics(npc, add, open);
      this.habitTopics(npc, add);
      if (open) this.problemTopics(npc, add);
      this.relationTopics(npc, add, open);
    }
    if (mode !== 'life') {
      this.newsTopics(npc, add, mode === 'news');
      this.economyTopics(npc, add);
      this.natureTopics(npc, add, mode === 'news');
    }
    if (mode === 'chat') this.smallTalk(npc, add);
    if (mode !== 'news') this.lineageTopics(npc, add);
    return out;
  }

  // ------------------------------------------------------------------ memories

  memoryTopics(npc, add, open) {
    const sim = this.sim;
    const day = sim.time.day;
    for (const m of npc.memories || []) {
      if (!sim.memory.alive(m, day)) continue;
      const toldRecently = m.told !== undefined && day - m.told < 4;
      const w = sim.memory.weight(m, day) * (toldRecently ? 0.15 : 1);
      const params = { ...(m.p || {}), ago: day - m.d };
      if (m.w === 'player' && PLAYER_MEMORY_LINES.has(m.k)) {
        add(`talk.mem.${m.k}`, params, 5 + w * 5, m);
      } else if (typeof m.w === 'string' && m.w.startsWith('anc') && PLAYER_MEMORY_LINES.has(m.k)) {
        // They remember what your parent (or grandparent) did.
        const kin = this.legacyKin(m.w);
        if (kin) add(`talk.legacy.${sim.memory.def(m.k).val >= 0 ? 'good' : 'bad'}`, { ...params, npc: m.w, kin_your: kin }, 6 + w * 4, m);
      } else if (m.w !== 'player' && SELF_MEMORY_LINES.has(m.k)) {
        // Private matters (hunger, sleeping rough) only with people they trust.
        if (!open && ['went_hungry', 'slept_rough', 'was_sick', 'fell_out'].includes(m.k)) continue;
        if (m.w && !params.npc && sim.npcs.byId(m.w)) params.npc = m.w;
        add(`talk.mem.${m.k}`, params, 3 + w * 3.5 * (day - m.d <= 7 ? 1.5 : 0.7), m);
      }
    }
  }

  /** 'parent:f' if this former player was your mother — null if they weren't family (a new line). */
  legacyKin(ancId) {
    const p = this.sim.state.player;
    const gen = Number(ancId.slice(3));
    if (!gen || gen < (p.lineFrom || 1)) return null;
    const who = this.sim.family.person(ancId);
    return `${p.generation - gen === 1 ? 'parent' : 'grandparent'}:${who?.gender || 'm'}`;
  }

  // ------------------------------------------------------------------ work

  workTopics(npc, add, open) {
    const sim = this.sim;
    const econ = sim.economy;
    const occ = OCCUPATIONS[npc.occupation] || {};
    if (npc.owns) {
      const b = econ.biz(npc.owns);
      const building = b.building;
      if (b.money < 120) add('talk.work.owner_struggling', { building }, open ? 14 : 6);
      else if (b.money > 600) add('talk.work.owner_thriving', { building }, 8);
      const vacancy = sim.npcs.vacancies().some(([id]) => id === npc.owns);
      if (vacancy) add('talk.work.owner_hiring', { building, occ: econ.def(npc.owns).workerOccupation }, 12);
      if (econ.def(npc.owns).type === 'smithy' && econ.stock(npc.owns, 'iron_ore') < 2) add('talk.work.owner_no_input', { item: 'iron_ore' }, 10);
      // Competition.
      const rival = econ.ofSector(econ.sector(npc.owns)).find((x) => x !== npc.owns);
      if (rival) {
        const cheaper = (econ.biz(rival).markup ?? 1) < (b.markup ?? 1);
        add(cheaper ? 'talk.work.rival_cheaper' : 'talk.work.rival_exists', { building: econ.biz(rival).building, npc: econ.ownerId(rival) }, 11);
      }
      if (econ.def(npc.owns).type === 'carpentry' && sim.businesses.list().length) add('talk.work.competing_with_you', {}, 10);
      if (b.opened > 0 && sim.time.day - b.opened < 28) add('talk.work.new_business', { building: b.building }, 14);
      const def = econ.def(npc.owns);
      for (const [item, target] of Object.entries(def.targets || {})) {
        if (def.kind === 'producer' && econ.stock(npc.owns, item) > target * 2) {
          add('talk.work.owner_overstock', { item }, 8);
          break;
        }
      }
      return;
    }
    if (npc.employer === 'player') {
      const c = sim.workers.contract(npc.id);
      if (c) add(c.satisfaction >= 65 ? 'talk.work.player_happy' : c.satisfaction >= 40 ? 'talk.work.player_ok' : 'talk.work.player_unhappy', { money: sim.workers.expectedSalary(npc, c.rank) }, 9);
      return;
    }
    if (npc.employer) {
      const bossId = econ.ownerId(npc.employer);
      const building = econ.biz(npc.employer)?.building;
      if (npc.unpaidDays > 0) add('talk.work.unpaid', { npc: bossId, n: npc.unpaidDays }, 20);
      if (econ.biz(npc.employer).money < 80) add('talk.work.boss_struggling', { npc: bossId, building }, open ? 12 : 5);
      if ((occ.end || 0) - (occ.start || 0) >= 10) add('talk.work.long_hours', { npc: bossId }, 6);
      const boss = sim.npcs.byId(bossId);
      const view = boss && sim.social.bond(npc, boss);
      if (view && (view.c >= 30 || view.f <= -20)) add('talk.work.bad_boss', { npc: bossId }, open ? 14 : 4);
      else if (view && view.f >= 45) add('talk.work.good_boss', { npc: bossId }, 6);
      const mate = sim.npcs.list.find((o) => o !== npc && o.employer === npc.employer && sim.social.npcRel(npc, o) >= 40);
      if (mate) add('talk.work.coworker_friend', { npc: mate.id, building }, 5);
      if (sim.npcs.rank(npc) === 'master') add('talk.work.proud_master', { occ: npc.occupation, gender: npc.gender }, 5);
      if (sim.habits.isRestDay(npc, occ)) add('talk.work.day_off', {}, 8);
      else if (occ.seasons && !occ.seasons.includes(sim.time.season)) add('talk.work.off_season', {}, 10);
      return;
    }
    if (npc.occupation === 'unemployed' && npc.age >= 16) {
      add('talk.work.searching', {}, 10);
      const v = sim.npcs.vacancies();
      if (v.length) add('talk.work.heard_hiring', { building: v[0][1].building }, 8);
    }
  }

  // ------------------------------------------------------------------ family

  familyTopics(npc, add) {
    const sim = this.sim;
    for (const r of sim.family.relatives(npc)) {
      const kin = sim.family.kinship(npc, r);
      const kinParam = `${kin}:${r.gender}`;
      if (r.health < 40) add('talk.family.sick', { kin: kinParam, npc: r.id }, 22);
      else if (r.age >= 18 && r.occupation === 'unemployed') add('talk.family.jobless', { kin: kinParam, npc: r.id }, 10);
      else if (kin === 'child' && r.age < 16) add('talk.family.child', { kin: kinParam, npc: r.id, n: r.age }, 7);
      else if (kin === 'spouse') add('talk.family.spouse', { kin: kinParam, npc: r.id }, 5);
      else if (kin === 'sibling') add('talk.family.sibling', { kin: kinParam, npc: r.id }, 4);
      else if (kin === 'parent') add('talk.family.parent', { kin: kinParam, npc: r.id }, 4);
    }
    if (npc.homeId && npc.age >= 16 && sim.npcs.householdPantry(npc) <= 0) add('talk.family.no_food', {}, 14);
    if (npc.partner && sim.npcs.byId(npc.partner)) add('talk.family.courting', { npc: npc.partner }, 12);
    if (npc.widowOf && !npc.kin.spouse) add('talk.family.widowed', { npc: npc.widowOf }, 9);
    const P = sim.property;
    if (npc.homeId && P.capacity(npc.homeId) && P.occupants(npc.homeId) > P.capacity(npc.homeId)) add('talk.family.crowded', {}, 12);
    const landlord = P.landlord(npc);
    if (landlord && P.rec(npc.homeId)?.arrears > 0) add('talk.family.rent_behind', {}, 16);
    else if (landlord === 'player') add('talk.family.your_tenant', { money: P.weeklyRent(npc.homeId) }, 7);
    else if (!landlord && npc.homeId && P.rec(npc.homeId)?.owner === npc.id) add('talk.family.own_home', { building: npc.homeId }, 3);
  }

  /** Talk about your family: your spouse, your children, the parent who came before you. */
  lineageTopics(npc, add) {
    const sim = this.sim;
    const p = sim.state.player;
    const kin = sim.family.kinship(npc, sim.lineage.person());
    if (kin === 'spouse') {
      const kids = sim.lineage.children();
      if (kids.some((c) => c.age < 16)) add('talk.home.kids', { npc: kids[0].id }, 12);
      if (sim.lineage.homeFull()) add('talk.home.crowded', {}, 10);
      add('talk.home.love', {}, 6);
    } else if (kin === 'parent') {
      add(npc.age < 16 ? 'talk.home.child_young' : 'talk.home.child_grown', {}, 10);
    } else if (kin === 'child' && npc.retiredPlayer) {
      add('talk.home.elder', {}, 12);
    }
    // What your family did for the valley (LegacySystem) — people bring it up.
    const deed = npc.age >= 14 && sim.legacy?.deedToTalkAbout();
    if (deed) add(deed.generation < (p.generation || 1) ? 'talk.legacy.deed_family' : 'talk.legacy.deed', { deed }, 4);
    // The village's affairs: the headman, the next election, what the council is saving for.
    const C = sim.civic;
    if (C && npc.age >= 18) {
      const h = C.V.headman;
      if (h === 'player') add('talk.civic.you_headman', {}, 5);
      else if (h && h !== npc.id) add('talk.civic.headman', { npc: h }, 3);
      else if (h === npc.id) add('talk.civic.i_am_headman', {}, 8);
      if (C.V.nextElection - sim.time.day <= 7) add('talk.civic.election_soon', { n: Math.max(0, C.V.nextElection - sim.time.day) }, 7);
      if (C.V.project) add('talk.civic.saving_for', { institution: C.V.project }, 3);
    }
    // Old friends of the family remember whoever came before you.
    if (p.generation > 1 && (p.lineFrom || 1) < p.generation && sim.time.day - (p.succeededDay || 0) < 120 && npc.age >= 30 && npc.met) {
      const prev = `anc${p.generation - 1}`;
      if (sim.family.person(prev)) add(sim.npcs.byId(prev) ? 'talk.legacy.retired' : 'talk.legacy.condolence', { npc: prev, kin_your: `parent:${sim.family.person(prev).gender}` }, 9);
    }
  }

  // ------------------------------------------------------------------ goals

  /** The villager's current goal, as the GoalSystem worked it out (with its reasons). */
  goal(npc) {
    return this.sim.goals.view(npc);
  }

  goalTopics(npc, add, open) {
    const g = this.goal(npc);
    const score = { business_ready: 16, leave: 18, business: 9, settle: 9, buy_house: 8, family: 7, better_job: 8 }[g.type] || 5;
    if (!open && ['home', 'job', 'leave', 'family', 'better_job', 'save'].includes(g.type)) return;
    const key = g.type === 'leave' && g.packing ? 'leave_packing' : g.type;
    add(`talk.goal.${key}`, { money: g.saved, money2: g.target, occ: npc.occupation, gender: npc.gender, biz_type: g.biz || undefined }, score);
    // …and, with people they trust, why.
    const why = open && g.why.find((w) => !w.startsWith('trait:') && !GOAL_AGAINST.includes(w));
    if (why) add(`talk.goal_why.${why.split(':')[0]}`, { gender: npc.gender, biz_type: why.split(':')[1] }, score * 0.6);
  }

  // ------------------------------------------------------------------ habits

  habitTopics(npc, add) {
    const sim = this.sim;
    const h = npc.habits;
    if (!h) return;
    const wd = sim.time.weekday;
    const hour = sim.time.hour;
    if (h.tavernNight === wd && hour < 20) add('talk.habit.tavern_night', {}, 8);
    if (h.marketDay === wd && hour < 18) add('talk.habit.market_today', {}, 6);
    else if (h.marketDay === (wd + 1) % 7) add('talk.habit.market_tomorrow', {}, 4);
    if (h.familyDay === wd || h.familyDay === (wd + 1) % 7) {
      const rel = sim.family.relatives(npc).find((o) => o.homeId && o.homeId !== npc.homeId);
      if (rel) add('talk.habit.family_day', { npc: rel.id, kin: `${sim.family.kinship(npc, rel)}:${rel.gender}` }, 6);
    }
    if (h.hobby) add(`talk.habit.hobby.${h.hobby}`, { n: npc.caughtFish || 0 }, 5);
    const fav = sim.habits.favouritePlace(npc);
    if (fav && fav !== 'store') add('talk.habit.fav_place', { building: fav }, 3);
  }

  // ------------------------------------------------------------------ problems & relationships

  problemTopics(npc, add) {
    if (!npc.homeId) add('talk.problem.homeless', {}, 18);
    if (npc.money < 10 && npc.age >= 16) add('talk.problem.poor', {}, 10);
    if (npc.social < 25) add('talk.problem.lonely', {}, 12);
    if (npc.energy < 25) add('talk.problem.tired', {}, 8);
    if (npc.health < 45) add('talk.problem.sick', {}, 12);
  }

  relationTopics(npc, add, open) {
    const sim = this.sim;
    const enemy = sim.social.worstEnemy(npc);
    if (enemy) add('talk.rel.rival', { npc: enemy.id }, open ? 10 : 4);
    const friend = sim.social.bestFriend(npc);
    if (friend && !npc.family.includes(friend.id)) add('talk.rel.friend', { npc: friend.id }, 4);
  }

  // ------------------------------------------------------------------ village news & economy

  newsTopics(npc, add, asked) {
    const sim = this.sim;
    const day = sim.time.day;
    const knows = (id) => id === npc.id || npc.family.includes(id) || sim.social.npcRel(npc, sim.npcs.byId(id)) >= 25;
    for (const e of sim.state.chronicle) {
      if (day - e.day > 7 || e.key === 'chronicle.player_arrived') continue;
      const ids = Object.entries(e.params).filter(([k]) => k.startsWith('npc')).map(([, v]) => v);
      if (ids.includes(npc.id)) continue;
      const personal = ids.some(knows);
      add('talk.news.chronicle', { chronicle: e }, (asked ? 8 : 4) * (personal ? 1.8 : 1) * (day - e.day <= 2 ? 1.5 : 1));
    }
    for (const r of sim.rumors?.known(npc) || []) add('talk.news.rumor', { rumor: r }, asked ? 12 : 6);
    for (const [bizId, def] of sim.npcs.vacancies()) add('talk.news.hiring', { building: def.building, occ: def.workerOccupation }, asked ? 7 : 3);
    // The places the valley is proud of, and what it's known for (EducationWorldSystem).
    for (const [id, l] of Object.entries(sim.state.education?.landmarks || {})) if (sim.world.buildings[id]) add(`talk.landmark.${l.kind}`, { building: id }, 1.2);
    const sp = sim.state.education?.specialty;
    if (sp) add('talk.specialty', { field: sp.field }, 1);
    for (const n of sim.academia?.students() || []) if (n.family.includes(npc.id) || sim.social.npcRel(npc, n) >= 30) add('talk.news.student_away', { npc: n.id, settlement: n.away.study }, 3);
    for (const plot of sim.land.forSale?.() || []) {
      add('talk.news.land', { plot: plot.id }, asked ? 3 : 1);
      break;
    }
    const pbiz = sim.businesses.list()[0];
    if (pbiz) {
      if (pbiz.reputation >= 60) add('talk.news.player_biz_good', { building: pbiz.buildingId }, asked ? 6 : 3);
      else if (pbiz.reputation < 30) add('talk.news.player_biz_bad', { building: pbiz.buildingId }, asked ? 6 : 3);
    } else if (!sim.economy.ofSector('carpentry').length && sim.economy.stock('store', 'chair') + sim.economy.stock('store', 'table') + sim.economy.stock('store', 'stool') <= 1) {
      add('talk.news.need_carpenter', {}, asked ? 6 : 2);
    }
    for (const ev of sim.state.events.active) add(`talk.news.event.${ev.id}`, { ...(ev.data?.params || {}) }, asked ? 7 : 4);
  }

  economyTopics(npc, add) {
    const sim = this.sim;
    const econ = sim.economy;
    for (const item of ['bread', 'potato', 'carrot', 'cabbage', 'apple']) {
      const sellers = econ.sellersOf(item);
      if (sellers.length && sellers.every((id) => econ.stock(id, item) === 0)) {
        add('talk.econ.shortage', { item }, npc.age >= 16 ? 10 : 3);
        break;
      }
    }
    const prices = econ.priceNews();
    if (prices.expensive.length) add('dialog.price_high', { item: prices.expensive[0] }, 5);
    if (prices.cheap.length) add('dialog.price_low', { item: prices.cheap[0] }, 3);
    if (sim.time.season === 'winter') add('talk.econ.winter_wood', {}, 3);
  }

  /** The land itself: thinning forests, empty rivers, worked-out seams, scarce game. */
  natureTopics(npc, add, asked) {
    const sim = this.sim;
    const N = sim.nature;
    if (!N) return;
    const occ = npc.occupation;
    const job = (list) => list.includes(occ);
    const yard = sim.economy.buildingOf('lumberyard');
    if (yard) {
      const forest = N.forestState(yard.door.tx, yard.door.ty);
      if (forest !== 'thick') add(`talk.nature.forest_${forest}`, {}, job(['woodcutter', 'lumber_foreman', 'carpenter']) ? 14 : asked ? 6 : 2);
    }
    const f = sim.state.nature.fish;
    const share = (f.river.pop + f.lake.pop) / (f.river.cap + f.lake.cap);
    const fisher = job(['fisher', 'fisherman']) || npc.habits?.hobby === 'fishing';
    if (share < 0.4) add('talk.nature.fish_scarce', {}, fisher ? 14 : asked ? 5 : 1);
    else if (fisher) add('talk.nature.fish_good', {}, 5);
    const ore = N.reserveLeft();
    if (job(['miner', 'quarry_foreman', 'blacksmith', 'smith_hand']) && (ore.iron < 40 || ore.coal < 40)) add('talk.nature.ore_low', { item: ore.iron < ore.coal ? 'iron_ore' : 'coal' }, 12);
    const W = sim.state.nature.wildlife;
    if ((npc.habits?.hobby === 'hunting' || asked) && W.deer.pop < W.deer.cap * 0.4) add('talk.nature.game_scarce', {}, npc.habits?.hobby === 'hunting' ? 12 : 4);
    const planted = Object.values(sim.state.objects).some((o) => o.planted && o.state !== 'grown');
    if (planted && asked) add('talk.nature.replanting', {}, 4);
  }

  smallTalk(npc, add) {
    const sim = this.sim;
    add(`dialog.occ.${npc.occupation}`, {}, 3);
    add(`dialog.weather.${sim.weather.type}`, {}, 2);
    add(`dialog.season.${sim.time.season}`, {}, 1.5);
    for (const tr of npc.traits) add(`dialog.trait.${tr}`, {}, 1.5);
  }
}
