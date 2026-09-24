/**
 * Succession — shown when the torch passes: you died or retired, and play on
 * as your heir (or, with no children, as a newcomer to the village).
 */
import { Panel } from '../Panel.js';
import { t, tn, npcName } from '../../i18n/i18n.js';
import { escapeHtml } from '../format.js';
import { button, portrait } from '../widgets.js';

export class SuccessionPanel extends Panel {
  constructor(ui, info) {
    super(ui);
    this.info = info;
  }
  get id() {
    return 'succession';
  }
  title() {
    return `🕯️ ${escapeHtml(t('lineage.title'))}`;
  }

  render() {
    const sim = this.sim;
    const p = sim.state.player;
    const { old, newcomer } = this.info;
    const how = t(old.how === 'died' ? 'lineage.old_died' : 'lineage.old_retired', { name: npcName(old), n: old.age, gender: old.gender });
    const next = newcomer
      ? t('lineage.newcomer', { name: npcName(p), n: p.age, gender: p.gender })
      : t('lineage.heir', { name: npcName(p), n: p.age, gender: p.gender, g: p.generation });
    const line = sim.state.lineage
      .map((l) => `<div class="kv"><span>${escapeHtml(t('lineage.gen_n', { n: l.generation }))} · ${escapeHtml(npcName(l))}</span><b>${escapeHtml(t(l.how === 'died' ? 'lineage.row_died' : 'lineage.row_retired', { n: l.age, gender: l.gender }))} · ${escapeHtml(tn('lineage.children_n', l.children))}</b></div>`)
      .join('');
    return `
      <div class="succession">
        <p class="desc">${escapeHtml(how)}</p>
        <div class="char-top">
          ${portrait(`player_g${p.generation}`, p.look, 84)}
          <div class="char-id">
            <div class="char-name">${escapeHtml(npcName(p))}</div>
            <div class="muted">${escapeHtml(t('ui.age_n', { age: p.age }))} · ${escapeHtml(t('lineage.gen_n', { n: p.generation }))}</div>
          </div>
        </div>
        <p class="desc">${escapeHtml(next)}</p>
        <p class="muted small">${escapeHtml(t(newcomer ? 'lineage.newcomer_hint' : 'lineage.heir_hint'))}</p>
        <h3>${escapeHtml(t('lineage.family_line'))}</h3>
        ${line}
        <div class="row">${button(t('lineage.continue'), 'close', {}, { cls: 'primary' })}</div>
      </div>`;
  }

  onAction(action) {
    if (action === 'close') this.ui.closePanel();
  }
}
