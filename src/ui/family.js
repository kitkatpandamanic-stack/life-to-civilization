/**
 * Your family as a dynasty (Character → Family): the line, generation by generation; each child —
 * what you've taught them, how ready they are, their role, their match; the families you're allied
 * with, the grudges you inherited, and the matches families have proposed.
 * (DynastySystem does the work; time with a child is spent in person — talk to them.)
 */
import { t, npcName, fmtMoney, cap } from '../i18n/i18n.js';
import { escapeHtml, tr, buildingLabel } from './format.js';
import { button, portrait, progress, status, emptyState, notice } from './widgets.js';
import { DYNASTY } from '../systems/DynastySystem.js';

const person = (sim, n, size = 44) => (n?.look ? portrait(`npc_${sim.state.seed}_${n.id}`, n.look, size) : `<span class="fam-ghost">👤</span>`);

/** The line: your ancestors, you, your children, your grandchildren. */
function treeHtml(sim) {
  const D = sim.dynasty;
  const T = D.tree();
  const p = sim.state.player;
  const past = T.past.map((g) => `<div class="fam-node past"><span class="fam-ghost">${g.how === 'died' ? '🕯️' : '🪑'}</span><div><b>${escapeHtml(npcName(g))}</b><div class="tiny muted">${escapeHtml(t('fam.gen_n', { n: g.generation }))} · ${escapeHtml(t(g.how === 'died' ? 'fam.died_at' : 'fam.retired_at', { n: g.age }))}</div></div></div>`).join('<span class="fam-arrow">↓</span>');
  const you = `<div class="fam-node you"><span class="fam-ghost">⭐</span><div><b>${escapeHtml(npcName(p))}</b><div class="tiny muted">${escapeHtml(t('fam.gen_n', { n: p.generation || 1 }))} · ${escapeHtml(t('ui.age_n', { age: p.age }))}</div></div>${T.you.spouse ? `<span class="fam-plus">+</span>${person(sim, T.you.spouse, 32)}<div><b>${escapeHtml(npcName(T.you.spouse))}</b></div>` : ''}</div>`;
  const kids = T.kids.length ? `<div class="fam-row">${T.kids.map((k) => `<div class="fam-node${D.D.heir === k.id ? ' heir' : ''}">${person(sim, k, 32)}<div><b>${escapeHtml(npcName(k))}</b>${D.D.heir === k.id ? ' ⭐' : ''}<div class="tiny muted">${escapeHtml(t('ui.age_n', { age: k.age }))}</div></div></div>`).join('')}</div>` : '';
  const grand = T.grandkids.length ? `<div class="fam-row">${T.grandkids.map((k) => `<div class="fam-node small">${person(sim, k, 24)}<div><b>${escapeHtml(npcName(k))}</b><div class="tiny muted">${escapeHtml(t('ui.age_n', { age: k.age }))}</div></div></div>`).join('')}</div>` : '';
  return `<div class="fam-tree">${past ? `${past}<span class="fam-arrow">↓</span>` : ''}${you}${kids ? `<span class="fam-arrow">↓</span>${kids}` : ''}${grand ? `<span class="fam-arrow">↓</span>${grand}` : ''}</div>`;
}

/** One child: their upbringing, the heir star, their role, their match. */
function childCard(sim, c, view) {
  const D = sim.dynasty;
  const u = D.up(c.id);
  const bonus = D.bonusLevels(c.id);
  const heir = D.D.heir === c.id;
  const role = D.D.roles[c.id];
  const young = c.age < DYNASTY.childMin;
  const growing = c.age >= DYNASTY.childMin && c.age <= DYNASTY.childMax;
  const taught = Object.entries(u.pts)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `<span class="chip">${escapeHtml(t(`skill.${s}.name`))} ${n}${bonus[s] ? ` → +${bonus[s]} ${escapeHtml(t('fam.levels'))}` : ''}</span>`)
    .join('');
  let html = `<div class="card fam-child${heir ? ' selected' : ''}">
    <div class="card-head">${person(sim, c)}<div><div class="card-title">${escapeHtml(npcName(c))} ${heir ? `<span class="badge">⭐ ${escapeHtml(t('fam.heir'))}</span>` : ''}</div>
      <div class="card-sub">${escapeHtml(t('ui.age_n', { age: c.age }))} · ${escapeHtml(t('ui.level_n', { level: c.level || 1 }))}${c.traits?.length ? ` · ${c.traits.map((x) => t(`trait.${x}.name`)).join(', ')}` : ''}</div></div>
      <div class="card-end">${c.age >= 14 ? progress(D.readiness(c.id), { label: t('fam.ready'), kind: 'gold' }) : ''}</div></div>`;
  // What they've learned at home.
  if (growing || taught) html += `<div class="small muted" style="margin-top:4px">${escapeHtml(t('fam.upbringing', { l: u.lessons, w: u.work, p: u.play }))}${growing ? ` · ${escapeHtml(t(u.lastDay === sim.time.day ? 'fam.done_today' : 'fam.talk_to_spend'))}` : ''}</div>${taught ? `<div class="chips">${taught}</div>` : ''}`;
  else if (young) html += `<div class="small muted">${escapeHtml(t('fam.too_young', { n: DYNASTY.childMin }))}</div>`;
  const btns = [];
  if (c.age >= 14) btns.push(heir ? button(t('fam.unname_heir'), 'fam_heir', { id: '' }, { cls: 'sm ghost' }) : button(t('fam.name_heir'), 'fam_heir', { id: c.id }, { cls: 'sm', ico: '⭐' }));
  // A role, for the grown.
  if (c.age >= DYNASTY.roleMin) {
    btns.push(button(t('fam.role_shadow'), 'fam_role', { id: c.id, role: role?.role === 'shadow' ? '' : 'shadow' }, { cls: `sm ${role?.role === 'shadow' ? 'selected' : 'ghost'}` }));
    for (const b of sim.holdings.mine().slice(0, 3)) {
      const on = role?.role === 'manage' && role.biz === b;
      const chk = D.canSetRole(c.id, 'manage', b);
      btns.push(button(t('fam.role_manage', { building: buildingLabel(sim, sim.economy.biz(b)?.building) }), 'fam_role', { id: c.id, role: on ? '' : 'manage', biz: b }, { cls: `sm ${on ? 'selected' : 'ghost'}`, disabled: !on && !chk.ok, ico: sim.economy.def(b)?.icon || '🏪' }));
    }
  }
  if (btns.length) html += `<div class="btn-row">${btns.join('')}</div>`;
  if (role) html += `<div class="hint">${escapeHtml(t(`fam.role_${role.role}_on`, { n: role.days || 0 }))}</div>`;
  // Their match.
  const sp = c.kin?.spouse && sim.npcs.byId(c.kin.spouse);
  if (sp) html += `<div class="small">💍 ${escapeHtml(t('fam.married_to', { name: npcName(sp) }))}${D.allied(sp) ? ` · ${status(t('fam.allied'), 'good', '🤝')}` : ''}</div>`;
  else if (c.age >= DYNASTY.matchMin) {
    if (view.matchFor === c.id) {
      const list = D.matchesFor(c.id).slice(0, 6);
      html += `<div class="fam-matches">${list
        .map(({ npc, head }) => {
          const chk = D.canArrange(c.id, npc.id);
          return `<div class="setting-row"><div>${person(sim, npc, 28)} <b>${escapeHtml(npcName(npc))}</b> <span class="muted small">${escapeHtml(t('ui.age_n', { age: npc.age }))} · ${escapeHtml(t('fam.family_of', { name: npcName(head) }))}${D.powerful(head) ? ' · 👑' : ''} · ❤ ${Math.round(head.rel || 0)}</span>${chk.ok ? '' : `<div class="warn small">${escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</div>`}</div>
            ${button(t('fam.propose', { money: fmtMoney(D.gift(head)) }), 'fam_arrange', { id: c.id, their: npc.id }, { cls: 'sm primary', disabled: !chk.ok })}</div>`;
        })
        .join('') || `<div class="muted small">${escapeHtml(t('fam.no_matches'))}</div>`}</div>`;
    } else html += `<div class="btn-row">${button(t('fam.find_match'), 'fam_match', { id: c.id }, { cls: 'sm', ico: '💍' })}</div>`;
  }
  return html + '</div>';
}

export function familyPage(sim, view = {}) {
  const D = sim.dynasty;
  const kids = sim.lineage.children();
  let html = `<h3>🌳 ${escapeHtml(t('fam.line'))}</h3>${treeHtml(sim)}`;
  // Matches families have proposed.
  for (const o of D.D.offers) {
    const c = sim.npcs.byId(o.child);
    const n = sim.npcs.byId(o.their);
    const head = sim.npcs.byId(o.head);
    if (!c || !n || !head) continue;
    html += notice('info', `${escapeHtml(t(head === n ? 'fam.offer_self' : 'fam.offer', { head: npcName(head), their: npcName(n), child: npcName(c) }))} <div class="btn-row">${button(t('fam.accept'), 'fam_answer', { id: o.id, yes: 1 }, { cls: 'sm primary' })}${button(t('fam.decline'), 'fam_answer', { id: o.id, yes: 0 }, { cls: 'sm ghost' })}</div>`, '💌');
  }
  html += `<h3>👪 ${escapeHtml(t('fam.children'))}</h3>`;
  html += kids.map((c) => childCard(sim, c, view)).join('') || emptyState('👶', t('fam.no_children'), t('fam.no_children_hint'));
  // Alliances and grudges.
  const allies = D.D.alliances.map((a) => ({ a, head: sim.npcs.byId(a.head) })).filter((x) => x.head);
  const feuds = D.D.feuds.map((id) => sim.npcs.byId(id)).filter(Boolean);
  if (allies.length || feuds.length) {
    html += `<h3>🤝 ${escapeHtml(t('fam.ties'))}</h3>`;
    html += allies.map(({ a, head }) => `<div class="kv"><span>🤝 ${escapeHtml(t('fam.family_of', { name: npcName(head) }))}</span><b>${escapeHtml(t('fam.allied_since', { day: a.day }))}</b></div>`).join('');
    html += feuds.map((n) => `<div class="kv"><span>⚔️ ${escapeHtml(npcName(n))}</span><b class="neg">${escapeHtml(t('fam.old_grudge'))}</b></div>`).join('');
    html += `<div class="hint">${escapeHtml(t('fam.ties_hint', { d: Math.round(DYNASTY.allyDiscount * 100) }))}</div>`;
  }
  return html;
}

/** The Family page's buttons. Returns true if handled. */
export function familyAction(ui, action, data, view) {
  const sim = ui.sim;
  const D = sim.dynasty;
  const say = (r, okKey, params = {}) => sim.toast(r.ok ? okKey : `reason.${r.reason}`, r.ok ? params : r.params || {}, r.ok ? 'good' : 'warn');
  if (action === 'fam_heir') {
    const r = D.setHeir(data.id || null);
    if (data.id) say(r, 'toast.heir_named', { npc: data.id });
    return true;
  }
  if (action === 'fam_role') {
    const r = D.setRole(data.id, data.role || null, data.biz || null);
    if (!r.ok) say(r);
    return true;
  }
  if (action === 'fam_match') {
    view.matchFor = view.matchFor === data.id ? null : data.id;
    return true;
  }
  if (action === 'fam_arrange') {
    const r = D.arrange(data.id, data.their);
    if (!r.ok) say(r);
    else sim.toast(r.accepted ? 'toast.match_yes' : 'toast.match_no', { npc: data.their, npc2: r.head }, r.accepted ? 'good' : 'warn');
    view.matchFor = null;
    return true;
  }
  if (action === 'fam_answer') {
    const r = D.answer(data.id, data.yes === '1');
    if (!r.ok) say(r);
    return true;
  }
  return false;
}
