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
      sim.state.player.transport = 'horse_cart';
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
      ['Chronicle / history', `${sim.state.chronicle.length} / ${sim.state.history.entries.length}`],
      ['Objects', Object.keys(sim.state.objects).length],
      ['FPS', perf.fps],
      ['Sim ms / update', perf.last.toFixed(2)],
    ];
    return rows.map(([k, v]) => `<div class="dbg-row"><span>${k}</span><b>${v}</b></div>`).join('');
  }

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
      </div>
      <div class="dbg-sel">
        <select data-sel="event"><option value="">Event…</option>${Object.keys(EVENT_DEFS).map((k) => `<option>${k}</option>`).join('')}</select>
        <select data-sel="weather"><option value="">Weather…</option>${WEATHERS.map((k) => `<option>${k}</option>`).join('')}</select>
        <select data-sel="tech"><option value="">Discover…</option>${Object.keys(TECHS).map((k) => `<option>${k}</option>`).join('')}</select>
      </div>`;
  }

  el.addEventListener('click', (e) => {
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
    .debug-panel .dbg-sel { display: flex; gap: 4px; flex-wrap: wrap; }`;
  document.head.appendChild(css);
}
