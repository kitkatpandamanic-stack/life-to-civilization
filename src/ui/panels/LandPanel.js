/**
 * Land — information about a plot: size, location features and their effects,
 * price, and what's already built on it. Buy it, or start building on it.
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney } from '../../i18n/i18n.js';
import { tr, escapeHtml } from '../format.js';
import { button } from '../widgets.js';
import { T } from '../../world/WorldGenerator.js';

const MINI = { [T.WATER]: '#4a8fd0', [T.DEEP]: '#3274b5', [T.SAND]: '#e0cc92', [T.ROAD]: '#c8a878', [T.DIRT]: '#b08d5f', [T.CLIFF]: '#5f5a52', [T.MOUNTAIN]: '#9a9486', [T.FOREST]: '#3f7a35', [T.PLAZA]: '#b8b2a6', [T.FARMLAND]: '#8a6040' };

export class LandPanel extends Panel {
  constructor(ui, plotId) {
    super(ui);
    this.plotId = plotId;
  }
  get id() {
    return 'land';
  }
  title() {
    return `🏞️ ${escapeHtml(t(`plot.${this.plotId}`))}`;
  }

  render() {
    const sim = this.sim;
    const land = sim.land;
    const info = land.info(this.plotId);
    const owned = land.isOwned(this.plotId);
    const price = land.price(this.plotId);
    const check = land.check(this.plotId);
    const features = info.features.map((f) => `<div class="feature"><b>${escapeHtml(t(`land_feature.${f}.name`))}</b> — <span class="muted">${escapeHtml(t(`land_feature.${f}.desc`))}</span></div>`).join('') || `<div class="muted">${escapeHtml(t('land_feature.none'))}</div>`;
    const built = sim.construction.list.filter((c) => c.kind === 'building' && info.plot.x1 <= c.tx && c.tx <= info.plot.x2 && info.plot.y1 <= c.ty && c.ty <= info.plot.y2);
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${escapeHtml(String(v))}</b></div>`;
    return `
      <div class="land-layout">
        <canvas class="land-mini" width="${info.w * 12}" height="${info.h * 12}"></canvas>
        <div>
          ${kv(t('ui.land_size'), `${info.w} × ${info.h}`)}
          ${kv(t('ui.land_buildable'), info.buildable)}
          ${kv(t('ui.land_trees'), info.trees)}
          ${kv(t('ui.land_to_centre'), t('ui.tiles_n', { n: Math.round(info.plazaDist) }))}
          ${kv(t('ui.land_price'), fmtMoney(price))}
          ${kv(t('ui.status'), owned ? t('ui.your_land') : t('ui.for_sale'))}
        </div>
      </div>
      <h3>${escapeHtml(t('ui.land_features'))}</h3>
      ${features}
      ${built.length ? `<h3>${escapeHtml(t('ui.on_this_land'))}</h3>${built.map((c) => `<div class="rumor">🏠 ${escapeHtml(t(`buildable.${c.type}.name`))} — ${escapeHtml(c.status === 'done' ? t('ui.finished') : t('ui.under_construction'))}</div>`).join('')}` : ''}
      <div class="btn-row">
        ${owned ? button(t('action.build'), 'build', {}, { cls: 'primary' }) : button(t('ui.buy_land', { money: fmtMoney(price) }), 'buy', {}, { cls: 'primary', disabled: !check.ok })}
      </div>
      ${!owned && !check.ok ? `<div class="warn small">${escapeHtml(tr(sim, `reason.${check.reason}`, check.params || {}))}</div>` : ''}
      <div class="muted small">${escapeHtml(t('ui.land_hint'))}</div>`;
  }

  afterRender(body) {
    // A little map of the plot: terrain, trees and buildings.
    const c = body.querySelector('.land-mini');
    const ctx = c.getContext('2d');
    const sim = this.sim;
    const p = sim.land.plot(this.plotId);
    for (let y = p.y1; y <= p.y2; y++) {
      for (let x = p.x1; x <= p.x2; x++) {
        const tile = sim.world.tileAt(x, y);
        ctx.fillStyle = MINI[tile] || '#79b35a';
        ctx.fillRect((x - p.x1) * 12, (y - p.y1) * 12, 12, 12);
        if (sim.world.isBlocked(x, y) && !sim.world.isWater(x, y)) {
          ctx.fillStyle = 'rgba(40,70,30,0.9)';
          ctx.beginPath();
          ctx.arc((x - p.x1) * 12 + 6, (y - p.y1) * 12 + 6, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    for (const b of sim.construction.list) {
      if (b.kind !== 'building') continue;
      ctx.fillStyle = b.status === 'done' ? '#8a4a3a' : 'rgba(120,170,255,0.8)';
      ctx.fillRect((b.tx - p.x1) * 12, (b.ty - p.y1) * 12, b.w * 12, b.h * 12);
    }
  }

  onAction(action) {
    if (action === 'buy') this.sim.land.buy(this.plotId);
    else if (action === 'build') this.ui.openBuild();
  }
}
