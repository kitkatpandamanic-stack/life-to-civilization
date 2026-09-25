/**
 * Land — a piece of land: its shape, size, what kind of land it is, who owns it and
 * since when, its features and price, and what stands on it. Buy it (standing on it),
 * or start building on it.
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel, parcelName } from '../format.js';
import { button, stat, statGrid } from '../widgets.js';
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
      ${on.length ? `<h3>${escapeHtml(t('ui.on_this_land'))}</h3>${on.join('')}` : ''}
      ${hist ? `<h3>${escapeHtml(t('land_ui.history'))}</h3>${hist}` : ''}
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

  onAction(action, data) {
    if (action === 'buy') this.sim.land.buy(this.plotId);
    else if (action === 'build') this.ui.openBuild();
    else if (action === 'building') this.ui.openProperty(data.id);
  }
}
