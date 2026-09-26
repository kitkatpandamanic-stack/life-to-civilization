/**
 * Debug panel (development builds only — loaded by devTools.js, never shipped).
 * F9 toggles it. Live stats, a performance readout, and buttons to poke the
 * world: money and items, weather, events, migrants, a business failing,
 * know-how, expeditions, aging the player, skipping time.
 *
 * Deliberately English-only: it's a developer tool, not part of the game.
 */
import { EVENT_DEFS } from '../data/events.js';
import { TECHS } from '../data/tech.js';

const WEATHERS = ['sunny', 'cloudy', 'rain', 'storm', 'snow', 'fog'];

/** The building whose door is nearest you (not the hall). */
function nearestBuilding(sim) {
  const me = sim.world.toTile(sim.state.player.x, sim.state.player.y);
  let best = null;
  for (const b of sim.world.buildingList) {
    if (b.id === 'hall' || !sim.structures.rec(b.id)) continue;
    const d = Math.abs(b.door.tx - me.tx) + Math.abs(b.door.ty - me.ty);
    if (!best || d < best.d) best = { id: b.id, d };
  }
  return best?.id;
}

export function installDebugPanel(dev) {
  const el = document.createElement('div');
  el.className = 'debug-panel hidden';
  document.body.appendChild(el);
  const perf = { updates: 0, ms: 0, last: 0, fps: 0, frames: 0, t0: performance.now() };
  let wrapped = null;

  /** Measure how long each simulation step takes (wraps sim.update once per Simulation). */
  function instrument(sim) {
    if (!sim || wrapped === sim) return;
    wrapped = sim;
    const orig = sim.update.bind(sim);
    sim.update = (dt) => {
      const a = performance.now();
      orig(dt);
      perf.ms += performance.now() - a;
      perf.updates++;
    };
  }

  const actions = {
    money: (sim) => (sim.state.player.money += 100),
    bread: (sim) => sim.inventory.add('bread', 10, { force: true }),
    relic: (sim) => sim.inventory.add('relic', 1, { force: true }),
    migrant: (sim) => sim.growth.arrive(),
    wave: (sim) => sim.events.start('migration_wave'),
    fail: (sim) => {
      const ids = sim.economy.active().filter((id) => sim.economy.owner(id));
      const id = ids[Math.floor(Math.random() * ids.length)];
      if (id) sim.enterprise.close(id, 'debug');
    },
    explore: (sim) => sim.exploration.npcSetsOut(),
    knowledge: (sim) => sim.tech.addKnowledge(5, 'debug'),
    age: (sim) => (sim.state.player.age += 10),
    child: (sim) => sim.lineage.birth(),
    day: () => dev.skip(1440),
    treasury: (sim) => (sim.state.village.treasury += 500),
    // Goals: everyone reconsiders now; or someone decides to leave (to test talking them round).
    rethink: (sim) => {
      sim.goals.ctx = null;
      for (const n of sim.state.npcs) sim.goals.reconsider(n);
    },
    leaver: (sim) => {
      const n = sim.state.npcs.find((x) => x.age >= 18 && x.age <= 60 && !x.owns && x.goal?.type !== 'leave');
      if (!n) return;
      sim.goals.set(n, 'leave', { why: ['unhappy'] });
      n.goal.packDay = sim.time.day + 4; // packing: gone in 4 days unless talked round
      dev.scene?.ui.openInspect(n.id);
    },
    // Settlements: know and trade with every place; send the caravans now; a horse cart.
    contact: (sim) => {
      for (const id of sim.settlements.ids()) {
        sim.exploration.region(sim.settlements.def(id).region).known = true;
        sim.settlements.makeContact(id, 'debug');
      }
    },
    caravans: (sim) => sim.settlements.dispatchCaravans(),
    week: (sim) => sim.settlements.weekly(),
    horse: (sim) => {
      sim.equipment.create('horse_cart');
      sim.equipment.syncJourney();
    },
    // Civic: hold the election now; make you headman; fill the fund for the next institution; renown.
    election: (sim) => sim.civic.election(),
    headman: (sim) => {
      sim.state.player.reputation = Math.max(sim.state.player.reputation, 30);
      sim.civic.V.headman = 'player';
      sim.civic.V.standing = true;
    },
    fund: (sim) => {
      const C = sim.civic;
      C.V.project ??= C.wanted()[0] || null;
      if (C.V.project) C.V.fund = C.costOf(C.V.project);
    },
    renown: (sim) => (sim.state.legacy.renown += 20),
    // Education (see eduTools.js — also dev.edu.* in the console).
    edu_school: () => dev.edu.school('school'),
    edu_trade: () => dev.edu.school('trade_school'),
    edu_institute: () => (dev.edu.school('library'), dev.edu.school('institute')),
    edu_teacher: (sim) => {
      const n = sim.state.npcs.find((x) => x.age >= 20 && !x.owns && !x.teach);
      if (n) dev.edu.teacher(n.id);
    },
    edu_enrol: (sim) => sim.schools.enrolments(),
    edu_year: () => dev.edu.year(),
    edu_research: () => dev.edu.research(20),
    edu_spread: (sim) => sim.knowhow.weekly(),
    edu_week: (sim) => (sim.education.weekly(), sim.schools.weekly(), sim.careers.weekly(), sim.academia.weekly(), sim.eduworld.weekly()),
    edu_talent: () => dev.edu.event('talent'),
    edu_scholar: () => dev.edu.event('scholar'),
    edu_inspect: (sim) => {
      const n = sim.state.npcs[Math.floor(Math.random() * sim.state.npcs.length)];
      dev.scene.ui.openInspect(n.id, 'learning');
    },
    wspots: () => (showSpots = !showSpots),
    wdog: (sim) => sim.workers.watchdog(),
    // Renting: a house of yours with a household in it, and rent day at once.
    rental: (sim) => {
      const P = sim.property;
      const id = P.homes().find((h) => P.isVacant(h) && P.rec(h).owner !== 'player') || P.homes().find((h) => P.isVacant(h));
      if (!id) return console.log('no vacant house');
      if (P.rec(id).owner !== 'player') P.transfer(id, 'player', 'gift');
      const n = sim.state.npcs.find((x) => x.age >= 18 && x.homeId !== id && P.rec(x.homeId)?.owner !== x.id && !P.lease(x.homeId)) || sim.state.npcs.find((x) => x.age >= 18);
      sim.letting.moveIn(n, id, 'debug');
      console.log('rental', id, 'tenant', n.id, P.lease(id));
    },
    // Housing decisions: every household thinks it over now (moves are logged), and how content each is.
    housing: (sim) => {
      const moves = sim.housing.weekly({ all: true });
      console.table(moves);
      console.table(sim.state.npcs.filter((n) => sim.housing.isHead(n)).map((n) => ({ npc: n.id, home: n.homeId, sat: n.housing?.sat, wants: (n.housing?.wants || []).join(' ') })));
    },
    // Buildings, housing and territory (see buildTools.js — also dev.bt.* in the console).
    bt_hood: () => console.log(dev.bt.neighbourhood()),
    bt_district: () => console.log(dev.bt.district('shop')),
    bt_places: () => dev.bt.places(),
    bt_complete: () => console.log(dev.bt.complete()),
    bt_land: () => dev.bt.land(),
    bt_works: () => console.log(dev.bt.works()),
    bt_developer: () => console.log(dev.bt.developer()),
    bt_flats: () => console.log(dev.bt.flats()),
    // Contracts and crews (see contractTools.js — also dev.ct.* in the console).
    ct_farm: () => console.log(dev.ct.farm()),
    ct_repair: () => console.log(dev.ct.repair()),
    ct_finish: () => console.log(dev.ct.finish()),
    ct_list: () => console.log(dev.ct.list()),
    // Equipment and transport (see transportTools.js — also dev.tr.* in the console).
    tr_give: () => console.log(dev.tr.give('wheelbarrow', 'you')),
    tr_cart: () => console.log(dev.tr.give('handcart', 'yard')),
    tr_lend: () => console.log(dev.tr.lend()),
    tr_retrieve: () => console.log(dev.tr.retrieve()),
    tr_warehouse: () => console.log(dev.tr.warehouse(200)),
    tr_depot: () => console.log(dev.tr.build('transport_depot')),
    tr_scenario: () => console.log(dev.tr.scenario()),
    tr_list: () => console.log(dev.tr.list()),
    tr_crew: () => console.log(dev.tr.crew()),
    tr_points: () => console.log(dev.tr.points()),
    // Guide and standing orders (see guideTools.js — also dev.gd.* in the console).
    gd_advice: () => console.log(dev.gd.advice()),
    gd_steps: () => console.log(dev.gd.steps()),
    gd_done: () => console.log(dev.gd.done()),
    gd_order: () => console.log(dev.gd.order()),
    gd_orders: () => console.log(dev.gd.orders()),
    // Industry, festivals, balance (see reportTools.js — also dev.eco.* in the console).
    eco_report: () => dev.eco.report(),
    eco_industry: () => console.log(dev.eco.industry()),
    eco_festival: () => console.log(dev.eco.festival()),
    eco_bandits: () => console.log(dev.eco.bandits()),
    bt_settype: (sim) => {
      const me = sim.world.toTile(sim.state.player.x, sim.state.player.y);
      const id = sim.territory.idAt(me.tx, me.ty);
      const order = ['residential', 'commercial', 'industrial', 'agricultural', null];
      const cur = sim.territory.rec(id)?.pin || null;
      console.log(id, dev.bt.setType(id, order[(order.indexOf(cur) + 1) % order.length]));
    },
    // The building you're nearest: pull it down / make it a shop (at once).
    bt_demolish: (sim) => console.log(dev.bt.demolish(nearestBuilding(sim))),
    bt_convert: (sim) => console.log(dev.bt.convert(nearestBuilding(sim), 'shopfront')),
    bt_buylot: () => console.log(dev.bt.buyLot()),
    bt_pave: () => console.log(dev.bt.pave(8)),
    bt_infra: () => console.log(dev.bt.infra()),
    rentday: (sim) => {
      sim.property.collectRent();
      sim.property.market();
      console.log('rent day', sim.state.letting.lastRent);
    },
    hire3: (sim) => {
      const look = sim.state.npcs[0].look;
      for (let i = 0; i < 3; i++) {
        const p = sim.state.player;
        const n = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look, money: 20, x: p.x + 20 * i, y: p.y + 30 });
        n.met = true;
        sim.workers.hire(n, 15);
        const site = sim.construction.playerSites()[0];
        sim.workers.assign(n.id, site ? { type: 'build', siteId: site.id } : { type: 'idle' });
      }
    },
    inspect: (sim) => {
      const n = sim.state.npcs[Math.floor(Math.random() * sim.state.npcs.length)];
      dev.scene.ui.openInspect(n.id);
    },
  };

  function stats(sim) {
    const npcs = sim.state.npcs;
    const adults = npcs.filter((n) => n.age >= 16);
    const avg = adults.length ? Math.round(adults.reduce((s, n) => s + n.money, 0) / adults.length) : 0;
    const homeless = adults.filter((n) => !n.homeId || n.homeId === 'hall').length;
    const jobless = adults.filter((n) => n.occupation === 'unemployed').length;
    const rows = [
      ['Day', `${sim.time.day} (${sim.time.clockString()})`],
      ['Villagers', `${npcs.length} · away ${npcs.filter((n) => n.away).length}`],
      ['Homeless / jobless', `${homeless} / ${jobless}`],
      ['Avg adult money', avg],
      ['Treasury', Math.round(sim.state.village.treasury)],
      ['Businesses', sim.economy.active().length],
      ['Knowledge', sim.state.knowledge.points],
      ['Techs', Object.keys(sim.state.tech.known).join(', ') || '—'],
      ['Regions known', sim.exploration.known().length],
      ['Goals', Object.entries(sim.goals.summary()).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')],
      ['Goals done / given up / left / settled', ((g) => `${g.achieved || 0} / ${g.gaveUp || 0} / ${g.left || 0} / ${g.settled || 0}`)(sim.state.settlement.goals || {})],
      ['Settlements', sim.settlements.summary().map((s) => `${s.id} ${s.pop}${s.contact ? '🤝' : ''}${s.road ? '═'.repeat(s.road) : ''} fed ${s.fed}%`).join(' · ')],
      ['Caravans / journey', `${sim.state.region.caravans.length} out · ${sim.state.region.journey ? `${sim.state.region.journey.stage} ${sim.state.region.journey.to}` : '—'}`],
      ['Civic', `${sim.civic.V.status} · headman ${sim.civic.V.headman} · ${sim.civic.V.policies.tax}/${sim.civic.V.policies.relief} · saving ${sim.civic.V.project || '—'} ${sim.civic.V.fund} · ${Object.keys(sim.civic.V.institutions).join(',') || 'no institutions'}`],
      ['Renown', `${sim.legacy.renown()} (${sim.legacy.tier()}) · ${sim.legacy.deeds().length} deeds`],
      ...((e) => (e ? [
        ['Education', `literacy ${Math.round(e.literacy * 100)}% · pupils ${e.pupils} · teachers ${e.teachers} · apprentices ${e.apprentices} · away ${e.students} · grads ${Math.round(e.university * 100)}%`],
        ['Learned', `doctors ${e.doctors} · engineers ${e.engineers} · researchers ${e.researchers} · masters ${e.masters} · innovation ${e.innovation} · known for ${e.specialty || '—'}`],
        ['Skilled by trade', Object.entries(e.skilledIn).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f, n]) => `${f} ${n}`).join(' · ') || '—'],
      ] : []))(sim.eduworld?.stats()),
      ['Chronicle / history', `${sim.state.chronicle.length} / ${sim.state.history.entries.length}`],
      ['Objects', Object.keys(sim.state.objects).length],
      ['FPS', perf.fps],
      ['Sim ms / update', perf.last.toFixed(2)],
    ];
    return rows.map(([k, v]) => `<div class="dbg-row"><span>${k}</span><b>${v}</b></div>`).join('');
  }

  /** Your workers, for the worker debugger: state, task, spot, progress, time in state. */
  function workersHtml(sim) {
    const W = sim.workers;
    const now = sim.time.total;
    const rows = W.list().map((c) => {
      const n = sim.npcs.byId(c.npcId);
      if (!n) return '';
      W.settings(c);
      const t = n.task;
      const prog = t?.stage === 'working' && t.until ? `${Math.max(0, Math.round(100 - ((t.until - now) / 60) * 100))}%` : '';
      const path = sim.npcs.paths.get(n.id);
      const next = W.candidates(n, c).find((x) => x.key !== c.task?.key);
      return `<div class="dbg-w"><b>${n.id}</b> ${c.state} · ${t?.type || '-'}:${t?.stage || '-'} ${prog}<br>${sim.contracts.jobOf(n.id) ? `contract #${sim.contracts.jobOf(n.id).id} · ` : ''}task ${c.task?.key || '—'} (${c.task?.status || '-'}) spot ${c.task?.spot ? `${c.task.spot.tx},${c.task.spot.ty}` : '—'} · path ${path ? path.length : 'none'} · ${Math.round((now - (c.stateSince ?? now)))}m in state · unstuck ${c.unstuck || 0}${c.lastStuck ? ` (${c.lastStuck.why})` : ''}<br>next ${next?.key || '—'} · blocked ${Object.keys(c.blocked).length} · queue ${c.queue.join(',') || '—'}
        <div>${['reset', 'cancel', 'next', 'teleport'].map((a) => `<button data-dbgw="${a}:${n.id}">${a}</button>`).join('')}</div></div>`;
    });
    return rows.length ? `<div class="dbg-head"><b>Workers</b> <button data-dbg="wspots">${showSpots ? 'hide' : 'show'} spots & paths</button> <button data-dbg="wdog">run watchdog</button></div>${rows.join('')}` : '';
  }

  // Worker spots, reservations and paths drawn over the world (debug only).
  let showSpots = false;
  let overlay = null;
  function drawSpots() {
    const sim = dev.sim;
    const scene = dev.scene;
    if (!showSpots || !sim || !scene) {
      overlay?.clear();
      return;
    }
    if (overlay && overlay.scene !== scene) overlay = null; // a loaded game has a new scene
    overlay ??= scene.add.graphics().setDepth(999999);
    overlay.clear();
    const TS = 32;
    const W = sim.workers;
    const colors = [0xff6b5a, 0x6fbf6a, 0x8fc3e8, 0xffcf5a, 0xc3a0ff, 0xffffff];
    for (const site of sim.construction.playerSites()) {
      overlay.lineStyle(1, 0xffffff, 0.6);
      for (const s of W.spots(site)) overlay.strokeRect(s.tx * TS + 4, s.ty * TS + 4, TS - 8, TS - 8);
    }
    W.list().forEach((c, i) => {
      const n = sim.npcs.byId(c.npcId);
      if (!n) return;
      const col = colors[i % colors.length];
      if (c.task?.spot) {
        overlay.fillStyle(col, 0.45).fillRect(c.task.spot.tx * TS + 2, c.task.spot.ty * TS + 2, TS - 4, TS - 4);
        overlay.lineStyle(2, col, 0.9).lineBetween(n.x, n.y, c.task.spot.tx * TS + TS / 2, c.task.spot.ty * TS + TS / 2);
      }
      const path = sim.npcs.paths.get(n.id);
      if (path?.length) {
        overlay.lineStyle(2, col, 0.5).beginPath();
        overlay.moveTo(n.x, n.y);
        for (const p of path) overlay.lineTo(p.tx * TS + TS / 2, p.ty * TS + TS / 2);
        overlay.strokePath();
      }
    });
  }
  setInterval(drawSpots, 300);

  function render() {
    const sim = dev.sim;
    if (!sim) {
      el.innerHTML = '<b>Debug</b><div>No game running.</div>';
      return;
    }
    instrument(sim);
    const btn = (id, label) => `<button data-dbg="${id}">${label}</button>`;
    el.innerHTML = `
      <div class="dbg-head"><b>Debug (F9)</b></div>
      ${stats(sim)}
      <div class="dbg-btns">
        ${btn('money', '+$100')}${btn('bread', '+10 bread')}${btn('relic', '+relic')}${btn('treasury', '+500 treasury')}
        ${btn('migrant', 'Migrant')}${btn('wave', 'Migration wave')}${btn('fail', 'Fail a business')}
        ${btn('explore', 'NPC expedition')}${btn('knowledge', '+5 knowledge')}${btn('child', 'Player child')}
        ${btn('age', 'Player +10y')}${btn('day', 'Skip a day')}${btn('inspect', 'Inspect random NPC')}
        ${btn('rethink', 'Everyone rethinks goals')}${btn('leaver', 'Someone decides to leave')}
        ${btn('contact', 'Contact all settlements')}${btn('week', 'Settlements: a week')}${btn('caravans', 'Send caravans')}${btn('horse', 'Get a horse cart')}
        ${btn('election', 'Election now')}${btn('headman', 'Make me headman')}${btn('fund', 'Fill civic fund')}${btn('renown', '+20 renown')}
        ${btn('edu_school', 'Build school')}${btn('edu_trade', 'Build trade school')}${btn('edu_institute', 'Build institute')}${btn('edu_teacher', 'Make a teacher')}${btn('edu_enrol', 'Enrol now')}
        ${btn('rental', 'A house to let, let')}${btn('rentday', 'Rent day')}${btn('housing', 'Households review homes')}${btn('bt_hood', 'Create neighbourhood')}${btn('bt_district', 'Create district (shops)')}${btn('bt_places', 'Recount places')}${btn('bt_complete', 'Complete construction near')}${btn('bt_land', 'Inspect land here')}${btn('bt_works', 'Public works now')}${btn('bt_pave', 'Pave road here')}${btn('bt_infra', 'Infrastructure numbers')}${btn('bt_developer', 'NPC develops a row')}${btn('bt_buylot', 'NPC buys a lot')}${btn('bt_flats', 'Block of flats here')}${btn('bt_settype', 'Cycle land type here')}${btn('bt_demolish', 'Demolish nearest')}${btn('bt_convert', 'Nearest → shop')}${btn('hire3', 'Hire 3 workers')}${btn('ct_farm', 'Farmer harvest → workers')}${btn('ct_repair', 'Repair job → workers')}${btn('ct_finish', 'Finish contract')}${btn('ct_list', 'List contracts')}${btn('tr_give', 'Wheelbarrow in hand')}${btn('tr_cart', 'Handcart at yard')}${btn('tr_lend', 'Lend equipment')}${btn('tr_retrieve', 'Retrieve equipment')}${btn('tr_warehouse', 'Warehouse + 200 wood')}${btn('tr_depot', 'Transport depot')}${btn('tr_scenario', 'Transport scenario')}${btn('tr_list', 'List equipment')}${btn('tr_crew', 'Crew: phase/cargo')}${btn('tr_points', 'Points of nearest site')}${btn('gd_advice', 'Guide: advice')}${btn('gd_steps', 'Guide: steps')}${btn('gd_done', 'Guide: tick step')}${btn('gd_order', 'Order: keep 40 wood')}${btn('gd_orders', 'List orders')}${btn('eco_report', 'Economy report')}${btn('eco_industry', 'Know industry')}${btn('eco_festival', 'Festival now')}${btn('eco_bandits', 'Bandits')}${btn('edu_week', 'Education: a week')}${btn('edu_year', 'School year ends')}${btn('edu_research', '+20 research')}${btn('edu_spread', 'Know-how spreads')}${btn('edu_talent', 'Talented pupil')}${btn('edu_scholar', 'Scholar arrives')}${btn('edu_inspect', 'Inspect learning')}
      </div>
      ${workersHtml(sim)}
      <div class="dbg-sel">
        <select data-sel="event"><option value="">Event…</option>${Object.keys(EVENT_DEFS).map((k) => `<option>${k}</option>`).join('')}</select>
        <select data-sel="weather"><option value="">Weather…</option>${WEATHERS.map((k) => `<option>${k}</option>`).join('')}</select>
        <select data-sel="tech"><option value="">Discover…</option>${Object.keys(TECHS).map((k) => `<option>${k}</option>`).join('')}</select>
      </div>`;
  }

  el.addEventListener('click', (e) => {
    // The worker debugger's buttons: reset / cancel / next / teleport one worker.
    const w = e.target.closest('[data-dbgw]')?.dataset.dbgw;
    if (w && dev.sim) {
      const [a, id] = w.split(':');
      const sim = dev.sim;
      const W = sim.workers;
      const c = W.contract(id);
      const n = sim.npcs.byId(id);
      if (c && n) {
        if (a === 'reset' || a === 'cancel' || a === 'next') {
          sim.npcs.paths.delete(id);
          W.release(c);
          if (a !== 'cancel' && n.task?.type === 'work') W.next(n);
          else if (n.task) n.task.stage = 'idle_wait';
        }
        if (a === 'teleport' && c.task?.spot) {
          const p = sim.world.tileCenter(c.task.spot.tx, c.task.spot.ty);
          sim.npcs.paths.delete(id);
          n.x = p.x;
          n.y = p.y;
          sim.npcs.arrive(n);
        }
      }
      render();
      return;
    }
    const id = e.target.closest('[data-dbg]')?.dataset.dbg;
    if (id && dev.sim) {
      actions[id](dev.sim);
      render();
    }
  });
  el.addEventListener('change', (e) => {
    const s = e.target.closest('[data-sel]');
    const sim = dev.sim;
    if (!s || !s.value || !sim) return;
    if (s.dataset.sel === 'event') sim.events.start(s.value);
    if (s.dataset.sel === 'weather') sim.weather.change(s.value);
    if (s.dataset.sel === 'tech') sim.tech.discover(s.value);
    render();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F9') return;
    e.preventDefault();
    el.classList.toggle('hidden');
    if (!el.classList.contains('hidden')) render();
  });

  // Frame counter and a slow refresh while open.
  const loop = () => {
    perf.frames++;
    const now = performance.now();
    if (now - perf.t0 >= 1000) {
      perf.fps = perf.frames;
      perf.frames = 0;
      perf.t0 = now;
      perf.last = perf.updates ? perf.ms / perf.updates : 0;
      perf.ms = 0;
      perf.updates = 0;
      if (!el.classList.contains('hidden') && !el.contains(document.activeElement)) render();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const css = document.createElement('style');
  css.textContent = `
    .debug-panel { position: fixed; right: 8px; bottom: 8px; width: 320px; max-height: 80vh; overflow: auto; z-index: 9999;
      background: rgba(10, 12, 18, 0.92); color: #d8e0ea; font: 12px/1.35 monospace; padding: 8px; border: 1px solid #445; border-radius: 6px; }
    .debug-panel.hidden { display: none; }
    .debug-panel .dbg-row { display: flex; justify-content: space-between; gap: 8px; }
    .debug-panel .dbg-row b { color: #ffd27a; text-align: right; word-break: break-word; }
    .debug-panel .dbg-btns { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0; }
    .debug-panel button, .debug-panel select { font: 11px monospace; background: #223; color: #dde; border: 1px solid #556; border-radius: 4px; padding: 3px 6px; cursor: pointer; }
    .debug-panel .dbg-sel { display: flex; gap: 4px; flex-wrap: wrap; }
    .debug-panel .dbg-w { border-top: 1px solid #334; padding: 4px 0; font-size: 11px; color: #bcc; }
    .debug-panel .dbg-w b { color: #ffd27a; }`;
  document.head.appendChild(css);
}
