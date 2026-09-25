/**
 * Land — a piece of land: its shape, size, what kind of land it is, who owns it and
 * since when, its features and price, and what stands on it. Buy it (standing on it),
 * or start building on it.
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel, parcelName, dateString } from '../format.js';
import { button, stat, statGrid, notice } from '../widgets.js';
import { ownerLabel } from '../land.js';
import { T } from '../../world/WorldGenerator.js';

const MINI = { [T.WATER]: '#4a8fd0', [T.DEEP]: '#3274b5', [T.SAND]: '#e0cc92', [T.ROAD]: '#c8a878', [T.DIRT]: '#b08d5f', [T.CLIFF]: '#5f5a52', [T.MOUNTAIN]: '#9a9486', [T.FOREST]: '#3f7a35', [T.PLAZA]: '#b8b2a6', [T.FARMLAND]: '#8a6040' };
const MAX_MINI = 264; // px

export class LandPanel extends Panel {
  constructor(ui, plotId) {
    super(ui);
    this.plotId = plotId;
  }
  get id() {
    return 'land';
  }
  title() {
    return `🏞️ ${escapeHtml(parcelName(this.sim, this.plotId))}`;
  }

  onOpen() {
    this.ui.scene?.constructionViews?.showParcel?.(this.plotId);
  }
  onClose() {
    this.ui.scene?.constructionViews?.showParcel?.(null);
  }

  render() {
    const sim = this.sim;
    const land = sim.land;
    const T2 = sim.territory;
    const id = this.plotId;
    const info = land.info(id);
    if (!info) return `<div class="muted">${escapeHtml(t('land_ui.gone'))}</div>`;
    const rec = T2.rec(id);
    const owner = rec?.owner ?? null;
    const owned = owner === 'player';
    const price = land.price(id);
    const check = owned ? null : land.check(id);
    const features = info.features.map((f) => `<div class="feature"><b>${escapeHtml(t(`land_feature.${f}.name`))}</b> — <span class="muted">${escapeHtml(t(`land_feature.${f}.desc`))}</span></div>`).join('') || `<div class="muted">${escapeHtml(t('land_feature.none'))}</div>`;
    // What stands on it: buildings, and your building sites.
    const on = T2.buildingsOn(id).map((b) => `<div class="rumor" data-action="building" data-id="${b.id}">🏠 ${escapeHtml(buildingLabel(sim, b.id))}</div>`);
    for (const c of sim.construction.sites()) {
      if (c.kind === 'building' && T2.idAt(c.tx + Math.floor(c.w / 2), c.ty + Math.floor(c.h / 2)) === id) on.push(`<div class="rumor">🏗️ ${escapeHtml(t(`buildable.${c.type}.name`, {}) || c.type)} — ${escapeHtml(t('ui.under_construction'))}</div>`);
    }
    // Who had it before.
    const hist = (rec?.hist || [])
      .slice(-4)
      .reverse()
      .map((h) => `<div class="small muted">${escapeHtml(tr(sim, 'land_ui.was', { who: ownerLabel(sim, h.owner), how: t(`land_how.${h.how || 'old'}`) }))}</div>`)
      .join('');
    const since = rec && rec.how !== 'old' ? tr(sim, 'land_ui.since', { how: t(`land_how.${rec.how}`), day: rec.since }) : '';
    const scale = Math.max(4, Math.min(12, Math.floor(MAX_MINI / Math.max(info.w, info.h))));
    this.scale = scale;
    let action = '';
    if (owned) action = sim.progression.hasUnlock('construction') ? button(t('action.build'), 'build', {}, { cls: 'primary' }) : '';
    else if (check.reason !== 'already_owned') action = button(t('ui.buy_land', { money: fmtMoney(check.price ?? price) }), 'buy', {}, { cls: 'primary', disabled: !check.ok });
    return `
      <div class="land-layout">
        <canvas class="land-mini" width="${info.w * scale}" height="${info.h * scale}"></canvas>
        <div>
          <div class="land-owner ${owned ? 'mine' : ''}">${escapeHtml(ownerLabel(sim, owner))}${since ? `<div class="small muted">${escapeHtml(since)}</div>` : ''}</div>
          ${statGrid([
            stat(t('land_ui.kind'), escapeHtml(t(`land_kind.${info.kind}`))),
            stat(t('ui.land_size'), escapeHtml(t('ui.tiles_n', { n: info.area }))),
            stat(t('ui.land_buildable'), info.buildable),
            stat(t('ui.land_trees'), info.trees),
            stat(t('ui.land_to_centre'), escapeHtml(t('ui.tiles_n', { n: Math.round(info.plazaDist) }))),
            stat(t('ui.land_price'), escapeHtml(fmtMoney(owned || !check?.price ? price : check.price))),
          ])}
        </div>
      </div>
      <h3>${escapeHtml(t('ui.land_features'))}</h3>
      ${features}
      ${this.becomeHtml()}
      ${this.worthHtml()}
      ${on.length ? `<h3>${escapeHtml(t('ui.on_this_land'))}</h3>${on.join('')}` : ''}
      ${this.eventsHtml()}
      ${hist ? `<h3>${escapeHtml(t('land_ui.history'))}</h3>${hist}` : ''}
      ${owned ? this.nextDoorHtml() : ''}
      <div class="btn-row">${action}</div>
      ${check && !check.ok && check.reason !== 'already_owned' ? `<div class="warn small">${escapeHtml(tr(sim, `reason.${check.reason}`, check.params || {}))}</div>` : ''}
      <div class="muted small">${escapeHtml(t(owned ? 'ui.land_hint' : 'land_ui.buy_hint'))}</div>`;
  }

  afterRender(body) {
    // A little map of the land: its tiles bright, the neighbours' dimmed; trees, rocks and buildings.
    const c = body.querySelector('.land-mini');
    if (!c) return;
    const ctx = c.getContext('2d');
    const sim = this.sim;
    const T2 = sim.territory;
    const p = T2.parcel(this.plotId);
    const s = this.scale;
    for (let y = p.y1; y <= p.y2; y++) {
      for (let x = p.x1; x <= p.x2; x++) {
        const tile = sim.world.tileAt(x, y);
        ctx.fillStyle = MINI[tile] || '#79b35a';
        ctx.fillRect((x - p.x1) * s, (y - p.y1) * s, s, s);
        if (sim.world.isBlocked(x, y) && !sim.world.isWater(x, y)) {
          ctx.fillStyle = 'rgba(40,70,30,0.9)';
          ctx.beginPath();
          ctx.arc((x - p.x1) * s + s / 2, (y - p.y1) * s + s / 2, s / 3, 0, Math.PI * 2);
          ctx.fill();
        }
        if (!T2.contains(this.plotId, x, y)) {
          ctx.fillStyle = 'rgba(20,20,28,0.55)';
          ctx.fillRect((x - p.x1) * s, (y - p.y1) * s, s, s);
        }
      }
    }
    for (const b of sim.world.buildingList) {
      if (b.tx > p.x2 || b.tx + b.w <= p.x1 || b.ty > p.y2 || b.ty + b.h <= p.y1) continue;
      ctx.fillStyle = '#8a4a3a';
      ctx.fillRect((b.tx - p.x1) * s, (b.ty - p.y1) * s, b.w * s, b.h * s);
    }
    for (const b of sim.construction.sites()) {
      if (b.kind !== 'building') continue;
      ctx.fillStyle = 'rgba(120,170,255,0.8)';
      ctx.fillRect((b.tx - p.x1) * s, (b.ty - p.y1) * s, b.w * s, b.h * s);
    }
    // Where you are, if you're on it or near.
    const me = sim.world.toTile(sim.state.player.x, sim.state.player.y);
    if (me.tx >= p.x1 && me.tx <= p.x2 && me.ty >= p.y1 && me.ty <= p.y2) {
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath();
      ctx.arc((me.tx - p.x1) * s + s / 2, (me.ty - p.y1) * s + s / 2, Math.max(3, s / 2.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** What the land has become: its type (from what's on it), people, work, trade, resources — and what's wanted around it. */
  becomeHtml() {
    const sim = this.sim;
    const T2 = sim.territory;
    const p = T2.profile(this.plotId);
    if (!p) return '';
    const kinds = Object.entries(p.kinds).map(([k, n]) => t(`land_kind_b.${k}`, { n })).join(", ");
    const res = [];
    if (p.resources.trees) res.push(t('land_ui.res_trees', { n: p.resources.trees }));
    if (p.resources.rocks) res.push(t('land_ui.res_rocks', { n: p.resources.rocks }));
    if (p.resources.farmland) res.push(t('land_ui.res_fields', { n: p.resources.farmland }));
    if (p.resources.water) res.push(t('land_ui.res_water'));
    const infra = [p.infra.road ? t('land_ui.infra_road') : t('land_ui.infra_no_road'), p.infra.well ? t('land_ui.infra_well') : null, p.roads ? t('land_ui.road_tiles', { n: p.roads }) : null].filter(Boolean);
    const q = T2.parcel(this.plotId);
    const pr = T2.pressure(Math.round(q.cx), Math.round(q.cy));
    const calls = [];
    if (pr.housing > 0) calls.push(t('land_ui.calls_housing', { n: pr.jobs }));
    if (pr.wantsShop) calls.push(t('land_ui.calls_shop', { n: pr.homes }));
    if (pr.industry && pr.homesClose >= 2) calls.push(t('land_ui.calls_quiet'));
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${escapeHtml(String(v))}</b></div>`;
    return `<h3>${escapeHtml(t('land_ui.become'))}</h3>
      ${kv(t('land_ui.type'), t(`territory_type.${p.type}`))}
      <div class="muted small">${escapeHtml(t(`territory_why.${p.type}`))}${kinds ? ` — ${escapeHtml(kinds)}` : ''}</div>
      ${p.population ? kv(t('land_ui.population'), p.population) : ''}
      ${p.jobs ? kv(t('land_ui.jobs'), p.jobs) : ''}
      ${p.activity ? kv(t('land_ui.activity'), fmtMoney(p.activity)) : ''}
      ${res.length ? kv(t('land_ui.resources'), res.join(', ')) : ''}
      ${kv(t('land_ui.infra'), infra.join(', '))}
      ${calls.length ? notice('info', escapeHtml(t('land_ui.calls', { list: calls.join('; ') })), '📣') : ''}`;
  }

  /** What the land is worth and why, how that's moved, and how built-up it is (Phase 9). */
  worthHtml() {
    const sim = this.sim;
    const T2 = sim.territory;
    const rec = T2.rec(this.plotId);
    const v = T2.valueTarget(this.plotId);
    const dev = T2.development(this.plotId);
    const pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))}%`;
    const why = Object.entries(v.parts)
      .filter(([, x]) => Math.abs(x) >= 0.005)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([k, x]) => `<div class="wb-row"><span>${escapeHtml(t(`land_value.${k}`))}</span><b class="${x < 0 ? 'neg' : ''}">${pct(x)}</b></div>`)
      .join('');
    const hist = rec?.lvh || [];
    const max = Math.max(...hist, 1);
    const spark = hist.length > 1 ? `<div class="spark" title="${escapeHtml(t('land_ui.value_trend'))}">${hist.map((x) => `<i style="height:${Math.max(8, Math.round((x / max) * 100))}%"></i>`).join('')}</div>` : '';
    const change = hist.length > 1 ? (hist.at(-1) - hist[0]) / Math.max(1, hist[0]) : 0;
    const devWhy = Object.entries(dev.parts)
      .filter(([, x]) => x >= 0.05)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => t(`land_dev_part.${k}`))
      .join(', ');
    const kv = (k, val) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${val}</b></div>`;
    return `<h3>${escapeHtml(t('land_ui.worth'))}</h3>
      ${kv(t('land_ui.value_now'), `${escapeHtml(fmtMoney(T2.price(this.plotId)))}${hist.length > 1 ? ` <span class="${change < 0 ? 'neg' : 'muted'} small">${change >= 0 ? '📈' : '📉'} ${pct(change)}</span>` : ''}`)}
      ${spark}
      ${why ? `<div class="wb"><div><div class="wb-head">${escapeHtml(t('land_ui.value_why'))}</div>${why}</div><div><div class="wb-head">${escapeHtml(t('land_ui.development'))}</div><div class="wb-row"><span>${escapeHtml(t(`dev_level.${dev.level}`))}</span></div><div class="muted small">${escapeHtml(devWhy || t('land_ui.dev_nothing'))}</div></div></div>` : ''}`;
  }

  /** What has happened to this land (it became residential, it was built up…). */
  eventsHtml() {
    const sim = this.sim;
    const ev = (sim.territory.rec(this.plotId)?.events || []).slice(-5).reverse();
    if (!ev.length) return '';
    return `<h3>${escapeHtml(t('land_ui.story'))}</h3>${ev.map((e) => `<div class="small"><span class="muted">${escapeHtml(dateString(e.day))}</span> ${escapeHtml(tr(sim, `land_event.${e.k}`, e.k === 'dev' ? { dev: e.to } : { tfrom: e.from, ttype: e.to }))}</div>`).join('')}`;
  }

  /** Land next to yours: grow your holding a plot at a time (walk over to buy). */
  nextDoorHtml() {
    const sim = this.sim;
    const T2 = sim.territory;
    const rows = T2.neighbours(this.plotId)
      .filter((id) => T2.owner(id) !== 'player')
      .map((id) => ({ id, chk: T2.canBuy(id, 'player', { anywhere: true }) }))
      .filter((x) => x.chk.ok || x.chk.reason === 'no_money')
      .slice(0, 6)
      .map((x) => `<div class="rumor clickable" data-action="land" data-id="${x.id}">🏞️ ${escapeHtml(parcelName(sim, x.id))} <span class="muted small">· ${escapeHtml(ownerLabel(sim, T2.owner(x.id)))} · ${escapeHtml(fmtMoney(x.chk.price ?? T2.price(x.id)))}</span></div>`);
    return rows.length ? `<h3>${escapeHtml(t('land_ui.next_door'))}</h3>${rows.join('')}<div class="muted small">${escapeHtml(t('land_ui.next_door_hint'))}</div>` : '';
  }

  onAction(action, data) {
    if (action === 'land') {
      this.ui.openLand(data.id);
      return;
    }
    if (action === 'buy') this.sim.land.buy(this.plotId);
    else if (action === 'build') this.ui.openBuild();
    else if (action === 'building') this.ui.openProperty(data.id);
  }
}
