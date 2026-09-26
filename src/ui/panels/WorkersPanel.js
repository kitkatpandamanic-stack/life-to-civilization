/**
 * Workers — your employees: what each is doing and what's next, how good they are at
 * what, their needs, pay and mood; their focus and work priorities; what's queued for
 * them; promotion and firing. And the team's rules (may they buy materials, and how much).
 */
import { Panel } from '../Panel.js';
import { t, npcName, fmtMoney, cap } from '../../i18n/i18n.js';
import { tr, escapeHtml, npcRole, buildingLabel, districtLabel } from '../format.js';
import { bar, button, iconButton, portrait, emptyState, status, stat, statGrid, tabs, searchBox, select, progress } from '../widgets.js';
import { JOB_CATS, PRIORITIES, WORKFORCE } from '../../data/workforce.js';
import { ROLES } from '../../data/contracting.js';
import { workerCardHtml, workerCardAction, STATE_LOOK, stateBadge, taskText, jobText } from '../transport.js';
import { taskProgress, placeText, statusGroup, GROUPS, GROUP_ICONS } from '../workerCard.js';
import { EQUIPMENT } from '../../data/transport.js';

/** How the Team tab can be sorted. */
const SORTS = ['status', 'name', 'level', 'task', 'distance'];

/** Roles: what each worker is for (their focus — see data/workforce.js FOCUS). */
const ASSIGNMENTS = ROLES;

export class WorkersPanel extends Panel {
  constructor(ui, { focus = null, priorities = false } = {}) {
    super(ui);
    this.confirmFire = null;
    this.open = priorities ? focus : null; // the worker whose priorities are shown
    this.focus = focus; // scrolled into view when the screen opens
    this.detail = focus; // the worker opened up in full
    this.tab = 'team';
    this.q = '';
    this.sort = 'status';
    this.prof = 'all';
    this.eqf = 'all';
    this.group = 'all';
  }

  onInput(key, value) {
    if (key === 'search') this.q = value;
    else if (key === 'sort') this.sort = value;
    else if (key === 'prof') this.prof = value;
    else if (key === 'eqf') this.eqf = value;
  }

  afterRender(body) {
    if (!this.focus) return;
    body.querySelector(`[data-worker="${this.focus}"]`)?.scrollIntoView({ block: 'start' });
    body.querySelector(`[data-worker="${this.focus}"]`)?.classList.add('flash-focus');
    this.focus = null;
  }
  get id() {
    return 'workers';
  }
  title() {
    return `👷 ${escapeHtml(t('ui.workers'))}`;
  }

  tick(delta) {
    this.timer = (this.timer || 0) - delta;
    // (not while a dropdown is open — a refresh would close it)
    if (this.timer <= 0 && document.activeElement?.tagName !== 'SELECT') {
      this.timer = 1000;
      this.ui.renderPanel();
    }
  }

  /** Send a worker to a business of yours (one button for each that has room). */
  postButtons(c) {
    const sim = this.sim;
    return sim.holdings.mine().filter((id) => sim.economy.def(id).workerOccupation).map((id) => {
      const chk = sim.holdings.canPost(id, c.npcId);
      return button(tr(sim, 'workers.post_to', { building: sim.economy.biz(id).building }), 'post', { npc: c.npcId, biz: id }, { cls: 'sm ghost', disabled: !chk.ok, title: chk.ok ? t('workers.post_tip') : tr(sim, `reason.${chk.reason}`, chk.params || {}) });
    }).join('');
  }

  /** Your workers posted to your businesses: where, and a way back. */
  postedHtml() {
    const sim = this.sim;
    const list = sim.holdings.posted();
    if (!list.length) return '';
    return `<h3>${escapeHtml(t('workers.posted_title'))}</h3>` + list.map((n) => {
      const chk = sim.holdings.canRecall(n.id);
      return `<div class="setting-row"><div><b>${escapeHtml(npcName(n))}</b> <span class="muted small">${escapeHtml(tr(sim, 'workers.posted_at', { building: sim.economy.biz(n.employer)?.building, money: sim.npcs.wageFor(n.employer, n) }))}${sim.economy.biz(n.employer)?.manager === n.id ? ` · ${escapeHtml(t('biz.manager'))}` : ''}</span></div>
        ${button(t('biz.call_back'), 'recall', { npc: n.id }, { cls: 'sm ghost', disabled: !chk.ok, title: chk.ok ? '' : tr(sim, `reason.${chk.reason}`, chk.params || {}) })}</div>`;
    }).join('');
  }

  /** Your manager: who, their duties (on/off), their notes — or how to get one. */
  managerHtml() {
    const sim = this.sim;
    const W = sim.workers;
    const M = W.mgr();
    if (!M) {
      if (W.list().length < 2) return '';
      return `<div class="hint">🧑‍💼 ${escapeHtml(t('workers.no_manager'))}</div>`;
    }
    const npc = sim.npcs.byId(M.npc);
    const duty = (d) => button(t(M[d] ? `workers.duty_${d}_on` : `workers.duty_${d}_off`), 'duty', { d }, { cls: `sm ${M[d] ? 'selected' : 'ghost'}` });
    const notes = (W.state.managerLog || []).slice(0, 6).map((x) => `<div class="rumor small">${escapeHtml(String(x.hour ?? '').padStart(2, '0'))}:00 · ${escapeHtml(tr(sim, `manager_note.${x.key}`, x.params || {}))}</div>`).join('');
    return `<div class="card"><div class="card-head"><div><div class="card-title">🧑‍💼 ${escapeHtml(t('workers.manager_title', { name: npcName(npc) }))}</div><div class="card-sub">${escapeHtml(t('workers.manager_sub'))}</div></div></div>
      <div class="btn-row">${duty('assign')}${duty('roles')}${button(t('workers.dismiss_manager'), 'dismiss_manager', {}, { cls: 'sm ghost' })}</div>
      ${notes ? `<div class="stat-label">${escapeHtml(t('workers.manager_notes'))}</div>${notes}` : ''}</div>`;
  }

  /** "Building: Stepan's house", "Buying planks", "Chopping wood"… */
  taskText(c) {
    const sim = this.sim;
    const t0 = c.task;
    if (!t0) return null;
    const siteName = (id) => {
      const s = sim.construction.byId(id);
      if (!s) return '';
      return s.kind === 'works' ? buildingLabel(sim, s.target) : t(`buildable.${s.type}.name`);
    };
    const params = { what: t0.kind === 'build' || t0.kind === 'haul' || t0.kind === 'buy' ? siteName(t0.target) : '', building: ['repair', 'crepair', 'chaul'].includes(t0.kind) ? t0.target : undefined, item: t0.item };
    return tr(sim, `wtask.${t0.kind}`, params);
  }

  /** What they'd do next: the best of what's on offer after this. */
  nextText(npc, c) {
    const list = this.sim.workers.candidates(npc, c).filter((x) => x.key !== c.task?.key).slice(0, 2);
    return [...new Set(list.map((x) => this.taskText({ task: { kind: x.kind, target: x.target, item: x.item } })))].join(' · ');
  }

  /** One worker in full: needs, pay, skills, role, priorities, queue, promotion (opened with Manage). */
  detailCard(c, list) {
    const sim = this.sim;
    const W = sim.workers;
    const npc = sim.npcs.byId(c.npcId);
    if (!npc) return '';
    W.settings(c);
    const prof = W.profile(npc);
    const [kind, ico] = STATE_LOOK[c.state] || STATE_LOOK.idle;
    const task = this.taskText(c);
    const next = c.state === 'working' || c.state === 'moving' ? this.nextText(npc, c) : '';
    const where = sim.growth.districtAt(Math.floor(npc.x / 32), Math.floor(npc.y / 32));
    const job = sim.contracts.jobOf(c.npcId);
    const prod = Math.round(W.productivity(c.npcId) * 100);
    const expected = W.expectedSalary(npc, c.rank);
    const promo = W.canPromote(c.npcId);
    const sites = sim.construction.playerSites();
    const assignBtns = ASSIGNMENTS.map((a) => {
      const disabled = a === 'workshop' && !sim.businesses.list().length; // (a builder or farmer with nothing of yours to build or farm still takes contract work)
      return button(t(`assignment.${a}`), 'assign', { npc: c.npcId, a }, { cls: `sm ${c.assignment.type === a ? 'selected' : 'ghost'}`, disabled });
    }).join('');
    const skills = prof.skills.map((s) => `<div class="aff-row"><span>${escapeHtml(cap(t(`knowledge.${s.field}`)))} ${Math.floor(s.v / 10)}</span>${bar(s.v, 'skill')}<b>${s.v}</b></div>`).join('');
    const queue = c.queue.map((id) => (sim.construction.byId(id) ? (sim.construction.byId(id).kind === 'works' ? buildingLabel(sim, sim.construction.byId(id).target) : t(`buildable.${sim.construction.byId(id).type}.name`)) : buildingLabel(sim, id))).join(' → ');
    const prios = this.open === c.npcId
      ? `<div class="card" style="margin-top:8px"><div class="stat-label">${escapeHtml(t('workers.priorities'))}</div>${JOB_CATS.map((cat) => `<div class="setting-row"><span>${escapeHtml(t(`jobcat.${cat}`))}</span><div class="btn-row">${PRIORITIES.map((p) => button(t(`prio.${p}`), 'prio', { npc: c.npcId, cat, p }, { cls: `sm ${c.jobs[cat] === p ? 'selected' : 'ghost'}` })).join('')}</div></div>`).join('')}
         ${sites.length ? `<div class="btn-row"><span class="hint">${escapeHtml(t('workers.queue_add'))}</span>${sites.map((s) => button(s.kind === 'works' ? buildingLabel(sim, s.target) : t(`buildable.${s.type}.name`), 'enqueue', { npc: c.npcId, id: s.id }, { cls: 'sm ghost', disabled: c.queue.includes(s.id) })).join('')}</div>` : ''}</div>`
      : '';
    return `<div class="worker-card" data-worker="${c.npcId}">
      <div class="wf-collapse">${button(t('wf.collapse'), 'detail', { npc: c.npcId }, { cls: 'sm ghost', ico: '▲' })}</div>
      <div class="worker-head">
        ${portrait(`npc_${sim.state.seed}_${npc.id}`, npc.look, 56)}
        <div class="worker-id">
          <b>${escapeHtml(npcName(npc))}</b> <span class="muted small">${escapeHtml(t(`profession.${prof.profession}`))} · ${escapeHtml(t('ui.level_n', { level: npc.level }))}</span>
          <div style="margin:3px 0">${status(t(`wstate.${c.state}`), kind, ico)}${task ? ` <span class="small">${escapeHtml(task)}</span>` : ''}</div>
          ${next ? `<div class="hint">${escapeHtml(t('workers.next', { list: next }))}</div>` : ''}
          ${job ? `<div class="hint">📜 ${escapeHtml(tr(sim, 'workers.on_contract', { kind: t(`contract.kind.${job.kind}`), npc: job.issuer !== 'village' ? job.issuer : undefined, building: job.building }))} ${button(t('workers.off_contract'), 'off_contract', { npc: c.npcId, id: job.id }, { cls: 'sm ghost' })}</div>` : ''}
          ${where ? `<div class="hint">📍 ${escapeHtml(districtLabel(where))}</div>` : ''}
          <div class="worker-stats small muted">${escapeHtml(t('stat.energy'))} ${Math.round(npc.energy)} · ${escapeHtml(t('stat.hunger'))} ${Math.round(npc.hunger)} · ${escapeHtml(t('stat.health'))} ${Math.round(npc.health)} · ${escapeHtml(t('workers.done_n', { n: c.stats.done }))}</div>
        </div>
        <div class="worker-pay">
          <div><b>${fmtMoney(c.salary)}</b> ${escapeHtml(t('ui.per_day'))}</div>
          <div class="muted small">${escapeHtml(t('ui.expects', { money: fmtMoney(expected) }))}</div>
          <div class="btn-row">${button('−', 'salary', { npc: c.npcId, d: -1 }, { cls: 'sm ghost' })}${button('+', 'salary', { npc: c.npcId, d: 1 }, { cls: 'sm ghost' })}</div>
        </div>
      </div>
      ${workerCardHtml(sim, npc)}
      <div class="char-cols" style="margin-top:6px">
        <div class="col">${skills}</div>
        <div class="col">
          <div class="aff-row"><span>${escapeHtml(t('ui.productivity'))}</span>${bar(Math.min(100, prod / 1.5), prod < 70 ? 'warn' : 'good')}<b>${prod}%</b></div>
          <div class="aff-row"><span>${escapeHtml(t('ui.satisfaction'))}</span>${bar(c.satisfaction, c.satisfaction < 35 ? 'warn' : 'good')}<b>${c.satisfaction}</b></div>
          <div class="aff-row"><span>${escapeHtml(t('workers.reliability'))}</span>${bar(prof.reliability, 'xp')}<b>${prof.reliability}</b></div>
        </div>
      </div>
      <div class="assign-row"><span class="muted small">${escapeHtml(t('workers.role'))}:</span> ${assignBtns} ${button(this.open === c.npcId ? t('workers.less') : t('workers.more'), 'toggle', { npc: c.npcId }, { cls: 'sm ghost' })}</div>
      ${queue ? `<div class="hint">📋 ${escapeHtml(t('workers.queue', { list: queue }))}</div>` : ''}
      ${prios}
      <div class="btn-row">
        ${this.postButtons(c)}
        ${W.isManager(c.npcId) ? `<span class="chip">🧑‍💼 ${escapeHtml(t('workers.is_manager'))}</span>` : list.length >= 2 ? button(t('workers.make_manager'), 'appoint', { npc: c.npcId }, { cls: 'sm ghost', disabled: !W.canAppoint(c.npcId).ok, title: W.canAppoint(c.npcId).ok ? t('workers.manager_tip') : tr(sim, `reason.${W.canAppoint(c.npcId).reason}`, W.canAppoint(c.npcId).params || {}) }) : ''}
        ${button(promo.ok ? t('ui.promote_to', { rank: t(`worker_rank.${promo.next}`, { gender: npc.gender }) }) : t('ui.promote'), 'promote', { npc: c.npcId }, { cls: 'sm', disabled: !promo.ok, title: promo.ok ? '' : tr(sim, `reason.${promo.reason || 'max_rank'}`, promo.params || {}) })}
        ${this.confirmFire === c.npcId ? `${escapeHtml(t('ui.fire_confirm'))} ${button(t('ui.yes'), 'fire_yes', { npc: c.npcId }, { cls: 'danger sm' })} ${button(t('ui.no'), 'fire_no', {}, { cls: 'sm ghost' })}` : button(t('ui.fire'), 'fire', { npc: c.npcId }, { cls: 'sm ghost' })}
      </div>
    </div>`;
  }

  /** The team at a glance: one line each — who, what, where, with what, how far — and Follow / Show / Manage. */
  row(c) {
    const sim = this.sim;
    const npc = sim.npcs.byId(c.npcId);
    const prof = sim.workers.profile(npc);
    const tp = taskProgress(sim, npc);
    const eq = sim.equipment?.assignedTo(npc.id);
    const eqText = eq ? `${EQUIPMENT[eq.type].icon} ${t(`equip.${eq.type}`)} · ${Math.round(eq.condition)}%` : `✋ ${t('wcard.by_hand')}`;
    return `<div class="wf-card${statusGroup(sim, c) === 'stuck' ? ' is-stuck' : ''}" data-worker="${c.npcId}">
      ${portrait(`npc_${sim.state.seed}_${npc.id}`, npc.look, 40)}
      <div class="wf-main">
        <div class="wf-top"><b class="wf-name">${escapeHtml(npcName(npc))}</b><span class="muted small">${escapeHtml(t(`profession.${prof.profession}`))} · ${escapeHtml(t('ui.level_n', { level: npc.level }))}</span>${stateBadge(c.state || 'idle')}</div>
        <div class="wf-task">${escapeHtml(taskText(sim, npc))}</div>
        ${tp ? progress(tp.pct, { label: tp.label, value: tp.value, kind: c.state === 'waiting' || c.state === 'need_materials' ? 'warn' : '' }) : ''}
        <div class="wf-meta"><span>📍 ${escapeHtml(placeText(sim, npc))}</span><span>${escapeHtml(eqText)}</span></div>
      </div>
      <div class="wf-btns">
        ${iconButton('👁', t('wcard2.follow'), 'follow', { npc: npc.id })}
        ${iconButton('🎯', t('bcard.locate'), 'show', { npc: npc.id })}
        ${button(t('wcard2.manage'), 'detail', { npc: npc.id }, { cls: 'sm', ico: '👷' })}
      </div>
    </div>`;
  }

  /** The Team tab: search, sort, filter, then the list (the one you're managing opened up in full). */
  teamHtml(list) {
    const sim = this.sim;
    if (!list.length) return emptyState('👷', t('ui.no_workers_title'), t(sim.progression.hasUnlock('hire_worker') ? 'ui.no_workers' : 'ui.workers_locked', { level: sim.progression.unlockLevel('hire_worker') }));
    const counts = Object.fromEntries(GROUPS.map((g) => [g, 0]));
    for (const c of list) counts[statusGroup(sim, c)]++;
    counts.all = list.length;
    const profs = [...new Set(list.map((c) => sim.workers.profile(sim.npcs.byId(c.npcId)).profession))];
    let html = `<div class="toolbar-row">
        ${searchBox(this.q, t('wf.search'))}
        ${select(SORTS.map((k) => [k, t(`wf.sort_${k}`)]), this.sort, 'sort')}
        ${select([['all', t('wf.any_profession')], ...profs.map((p) => [p, t(`profession.${p}`)])], this.prof, 'prof')}
        ${select([['all', t('wf.any_equipment')], ['with', t('wf.with_equipment')], ['none', t('wf.by_hand')]], this.eqf, 'eqf')}
      </div>
      <div class="filters">${['all', ...GROUPS]
        .filter((g) => g === 'all' || counts[g] || g === this.group)
        .map((g) => `<button class="filter${g === this.group ? ' active' : ''}" data-action="group" data-f="${g}">${GROUP_ICONS[g]} ${escapeHtml(t(`wf.group_${g}`))} <b>${counts[g]}</b></button>`)
        .join('')}</div>`;
    const P = sim.state.player;
    const q = this.q.trim().toLowerCase();
    const shown = list
      .filter((c) => {
        const npc = sim.npcs.byId(c.npcId);
        if (!npc) return false;
        if (this.group !== 'all' && statusGroup(sim, c) !== this.group) return false;
        if (this.prof !== 'all' && sim.workers.profile(npc).profession !== this.prof) return false;
        const eq = sim.equipment?.assignedTo(npc.id);
        if (this.eqf === 'with' && !eq) return false;
        if (this.eqf === 'none' && eq) return false;
        // Search: name, what they're doing, where, the job they're on.
        if (q && ![npcName(npc), taskText(sim, npc), placeText(sim, npc), jobText(sim, npc.id)].some((x) => String(x).toLowerCase().includes(q))) return false;
        return true;
      })
      .map((c) => ({ c, npc: sim.npcs.byId(c.npcId) }));
    const by = {
      name: (a, b) => npcName(a.npc).localeCompare(npcName(b.npc)),
      level: (a, b) => b.npc.level - a.npc.level,
      task: (a, b) => taskText(sim, a.npc).localeCompare(taskText(sim, b.npc)),
      distance: (a, b) => Math.hypot(a.npc.x - P.x, a.npc.y - P.y) - Math.hypot(b.npc.x - P.x, b.npc.y - P.y),
      status: (a, b) => GROUPS.indexOf(statusGroup(sim, b.c)) - GROUPS.indexOf(statusGroup(sim, a.c)),
    }[this.sort];
    shown.sort(by);
    if (!shown.length) return html + emptyState('🔍', t('wf.none_match'), t('wf.none_match_hint'));
    html += `<div class="wf-list">${shown.map(({ c }) => (this.detail === c.npcId ? this.detailCard(c, list) : this.row(c))).join('')}</div>`;
    return html;
  }

  render() {
    const sim = this.sim;
    const W = sim.workers;
    const list = W.list();
    const payroll = list.reduce((s, c) => s + c.salary, 0);
    const S = W.state;
    const working = list.filter((c) => c.state === 'working' || c.state === 'moving').length;
    let html = statGrid([
      stat(t('ui.team'), `${W.headcount()} / ${W.maxWorkers()}`),
      stat(t('workers.at_work'), String(working)),
      stat(t('ui.payroll'), `${fmtMoney(payroll)}<span class="muted small"> ${escapeHtml(t('ui.per_day'))}</span>`),
      stat(t('ui.team_bonus'), `+${Math.round((W.teamBonus() - 1) * 100)}%`),
    ]);
    html += tabs([['team', `${t('wf.tab_team')} (${list.length})`], ['rules', t('wf.tab_rules')]], this.tab);
    if (this.tab === 'rules') {
      // The team's rules: may they buy missing materials with your money, and up to how much a day.
      html += `<div class="setting-row"><div><b>${escapeHtml(t('workers.buy_title'))}</b><div class="hint">${escapeHtml(t('workers.buy_hint', { money: fmtMoney(W.buyBudgetLeft()) }))}</div></div>
        <div class="btn-row">${button(t(S.buy !== false ? 'workers.buy_on' : 'workers.buy_off'), 'buy_toggle', {}, { cls: S.buy !== false ? 'selected sm' : 'ghost sm' })}
        ${button('−', 'budget', { d: -50 }, { cls: 'sm ghost' })}<b class="num">${fmtMoney(S.budget ?? WORKFORCE.buyBudgetPerDay)}</b>${button('+', 'budget', { d: 50 }, { cls: 'sm ghost' })}</div></div>`;
      // How contract work weighs against their usual work (high: contracts first, always).
      const cp = S.contractPrio || 'high';
      html += `<div class="setting-row"><div><b>${escapeHtml(t('workers.contract_prio'))}</b><div class="hint">${escapeHtml(t(`workers.contract_prio_${cp}`))}</div></div>
        <div class="btn-row">${['high', 'medium', 'low'].map((p) => button(t(`prio.${p}`), 'contract_prio', { p }, { cls: `sm ${cp === p ? 'selected' : 'ghost'}` })).join('')}</div></div>`;
      html += this.managerHtml();
      // Your equipment: barrows and carts to lend (what each worker has is on their card).
      const eqN = sim.equipment?.mine().length || 0;
      html += `<div class="setting-row"><div><b>🛒 ${escapeHtml(t('workers.equipment_title'))}</b><div class="hint">${escapeHtml(t(eqN ? 'workers.equipment_hint' : 'workers.equipment_none', { n: eqN }))}</div></div>${button(t('workers.equipment_open'), 'equipment', {}, { cls: 'sm' })}</div>`;
      // Standing orders: carrying done day after day ("60 wood a day to the warehouse").
      const ordN = W.orderList().length;
      html += `<div class="setting-row"><div><b>🔁 ${escapeHtml(t('orders.title'))}</b><div class="hint">${escapeHtml(t(ordN ? 'workers.orders_hint' : 'workers.orders_none', { n: ordN }))}</div></div>${button(t('workers.orders_open'), 'orders', {}, { cls: 'sm' })}</div>`;
      // Your carting business: deliveries for the shops, caravans to other places (FreightSystem).
      const fr = sim.freight;
      html += `<div class="setting-row"><div><b>🛞 ${escapeHtml(t('freight.title'))}</b><div class="hint">${escapeHtml(fr.company?.kind === 'firm' ? t('freight.workers_hint', { n: fr.S.jobs.length, c: fr.S.caravans.length }) : t('freight.workers_none'))}</div></div>${button(t('freight.open'), 'freight', {}, { cls: 'sm' })}</div>`;
      html += this.postedHtml();
      html += `<div class="hint">${escapeHtml(t('ui.workers_hint'))}</div>`;
      return html;
    }
    html += this.teamHtml(list);
    return html;
  }


  onAction(action, data) {
    const W = this.sim.workers;
    if (workerCardAction(this.ui, action, data)) return;
    if (action === 'tab') return (this.tab = data.tab);
    if (action === 'group') return (this.group = data.f);
    if (action === 'detail') return (this.detail = this.detail === data.npc ? null : data.npc);
    // Follow them, or just look where they are: the screen closes and the camera goes there.
    if (action === 'follow' || action === 'show') {
      const npc = this.sim.npcs.byId(data.npc);
      const scene = this.ui.scene;
      this.ui.closePanel();
      if (!npc) return;
      if (action === 'follow') scene.camDir.follow(npc.id);
      else scene.camDir.lookAt(npc.x, npc.y - 20);
      return;
    }
    if (action === 'equipment') return this.ui.openEquipment();
    if (action === 'orders') return this.ui.openOrders();
    if (action === 'freight') return this.ui.openFreight();
    if (action === 'assign') {
      const a = { type: data.a };
      if (data.a === 'build') a.siteId = this.sim.construction.playerSites()[0]?.id;
      if (data.a === 'workshop') a.bizId = this.sim.businesses.list()[0]?.id;
      W.assign(data.npc, a);
    } else if (action === 'salary') {
      const c = W.contract(data.npc);
      if (c) W.setSalary(data.npc, c.salary + Number(data.d));
    } else if (action === 'prio') W.setPriority(data.npc, data.cat, data.p);
    else if (action === 'enqueue') W.enqueue(data.npc, data.id);
    else if (action === 'off_contract') {
      const job = this.sim.contracts.jobOf(data.npc);
      if (job) this.sim.contracts.assign(job.id, job.workers.filter((x) => x !== data.npc));
    }
    else if (action === 'toggle') this.open = this.open === data.npc ? null : data.npc;
    else if (action === 'buy_toggle') W.state.buy = W.state.buy === false;
    else if (action === 'contract_prio') W.state.contractPrio = data.p;
    else if (action === 'appoint') {
      const r = W.appoint(data.npc);
      if (!r.ok) this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    } else if (action === 'dismiss_manager') W.dismissManager();
    else if (action === 'post' || action === 'recall') {
      const r = action === 'post' ? this.sim.holdings.post(data.biz, data.npc) : this.sim.holdings.recall(data.npc);
      if (!r.ok) this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    }
    else if (action === 'duty') W.setDuty(data.d, !W.mgr()?.[data.d]);
    else if (action === 'budget') W.state.budget = Math.max(0, (W.state.budget ?? WORKFORCE.buyBudgetPerDay) + Number(data.d));
    else if (action === 'promote') W.promote(data.npc);
    else if (action === 'fire') this.confirmFire = data.npc;
    else if (action === 'fire_no') this.confirmFire = null;
    else if (action === 'fire_yes') {
      this.confirmFire = null;
      W.fire(data.npc);
    }
  }
}
