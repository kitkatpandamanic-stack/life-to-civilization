/**
 * The valley's woods (ForestrySystem): how healthy they are, grown and young trees, stumps waiting to be
 * planted, what's been planted (and by you), the foresters, the felling limit and the planting fund, how the
 * woods have gone over the weeks — and the orchards.
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney } from '../../i18n/i18n.js';
import { escapeHtml, buildingLabel } from '../format.js';
import { progress, notice } from '../widgets.js';
import { lineChart } from '../charts.js';

export class ForestPanel extends Panel {
  get id() {
    return 'forest';
  }
  title() {
    return `🌲 ${escapeHtml(t('forest.title'))}`;
  }

  render() {
    const sim = this.sim;
    const F = sim.forestry;
    const s = F.summary();
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;
    const kind = { thick: 'good', healthy: 'good', thinning: 'warn', bare: 'danger' }[s.status];
    const hist = s.history.map((x) => ({ x: x.day, y: Math.round(x.h * 100) }));
    const chart = hist.length >= 2 ? lineChart(hist, { h: 120, fmt: (v) => `${v}%`, label: t('forest.health') }) : '';
    const orchards = sim.economy.ofType('farm').map((id) => ({ id, n: F.orchardOf(id).length })).filter((o) => o.n > 0);
    const mine = Object.values(sim.state.objects).filter((o) => F.isApple(o) && o.owner === 'player').length;
    return `
      ${progress(Math.min(100, s.health * 100), { label: t(`forest.status_${s.status}`), value: `${Math.round(s.health * 100)}%`, kind })}
      ${s.health < s.limit ? notice('warn', escapeHtml(t('forest.limit_on', { n: Math.round(s.limit * 100) }))) : ''}
      ${kv(t('forest.grown'), s.grown)}
      ${kv(t('forest.young'), s.young + s.sapling)}
      ${kv(t('forest.stumps'), s.stump + s.cleared)}
      ${kv(t('forest.planted'), `${s.planted}${s.byPlayer ? ` · ${escapeHtml(t('forest.by_you', { n: s.byPlayer }))}` : ''}`)}
      ${kv(t('forest.foresters'), s.foresters)}
      ${kv(t('forest.nurseries'), sim.economy.ofType('tree_nursery').length)}
      ${s.imported ? kv(t('forest.imported'), s.imported) : ''}
      ${chart ? `<h3>${escapeHtml(t('forest.over_time'))}</h3>${chart}` : ''}
      <h3>${escapeHtml(t('forest.rules'))}</h3>
      ${kv(t('forest.policy'), escapeHtml(t(`hall.level_${s.policy}`)))}
      <div class="muted small">${escapeHtml(t(`pop.policy_forestry_${s.policy}`))}</div>
      ${s.fundPaid ? kv(t('forest.fund_paid'), fmtMoney(s.fundPaid)) : ''}
      <h3>${escapeHtml(t('forest.orchards'))}</h3>
      ${orchards.length || mine ? `${orchards.map((o) => kv(t('forest.orchard_of', { building: buildingLabel(sim, sim.economy.biz(o.id)?.building || '') }), t('forest.apple_trees', { n: o.n }))).join('')}${mine ? kv(t('forest.your_trees'), t('forest.apple_trees', { n: mine })) : ''}` : `<div class="muted small">${escapeHtml(t('forest.no_orchards'))}</div>`}
      <div class="hint">${escapeHtml(t('forest.hint'))}</div>`;
  }
}
