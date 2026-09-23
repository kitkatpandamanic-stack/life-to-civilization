/**
 * Game menu (Esc) — save, load, language, controls, quit to title.
 */
import { Panel } from '../Panel.js';
import { t, LANGUAGES, getLanguage, setLanguage } from '../../i18n/i18n.js';
import { escapeHtml } from '../format.js';
import { button, tabs } from '../widgets.js';
import { SaveSystem } from '../../systems/SaveSystem.js';
import { Simulation } from '../../core/Simulation.js';

export function slotDescription(meta) {
  if (!meta) return t('ui.empty_slot');
  const when = new Date(meta.savedAt).toLocaleString(getLanguage() === 'ru' ? 'ru-RU' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
  return t('ui.slot_meta', { name: meta.name, level: meta.level, day: meta.day, season: t(`season.${meta.season}`), year: meta.year, when });
}

export class MenuPanel extends Panel {
  constructor(ui) {
    super(ui);
    this.tab = 'game';
  }
  get id() {
    return 'menu';
  }
  title() {
    return `⚙️ ${escapeHtml(t('ui.menu'))}`;
  }

  render() {
    const list = [
      ['game', t('ui.tab_game')],
      ['save', t('ui.save')],
      ['load', t('ui.load')],
      ['settings', t('ui.settings')],
      ['controls', t('ui.controls')],
    ];
    let body = '';
    if (this.tab === 'game') {
      body = `<div class="menu-col">
        ${button(t('ui.resume'), 'close', {}, { cls: 'primary big' })}
        ${button(t('ui.quick_save'), 'save', { slot: '1' }, { cls: 'big' })}
        ${button(t('ui.quit_title'), 'quit', {}, { cls: 'big' })}
        <div class="muted small">${escapeHtml(t('ui.quit_hint'))}</div>
      </div>`;
    } else if (this.tab === 'save' || this.tab === 'load') {
      const saving = this.tab === 'save';
      body = SaveSystem.list()
        .filter((s) => !saving || s.slot !== 'auto')
        .map(
          (s) => `<div class="slot-row">
          <div><b>${escapeHtml(s.slot === 'auto' ? t('ui.autosave') : t('ui.slot_n', { n: s.slot }))}</b><div class="muted small">${escapeHtml(slotDescription(s.meta))}</div></div>
          ${saving ? button(t('ui.save'), 'save', { slot: s.slot }, { cls: 'primary' }) : button(t('ui.load'), 'load', { slot: s.slot }, { disabled: !s.meta, cls: 'primary' })}
        </div>`,
        )
        .join('');
      body += `<div class="muted small">${escapeHtml(t(saving ? 'ui.save_hint' : 'ui.load_hint'))}</div>`;
    } else if (this.tab === 'settings') {
      const cur = getLanguage();
      body = `<h3>${escapeHtml(t('ui.language'))}</h3><div class="btn-row">${LANGUAGES.map((l) => button(`${l.flag} ${l.label}`, 'lang', { code: l.code }, { cls: l.code === cur ? 'primary' : '' })).join('')}</div>
        <div class="muted small">${escapeHtml(t('ui.language_hint'))}</div>`;
    } else if (this.tab === 'controls') {
      const rows = ['move', 'interact', 'menu_keys', 'numbers', 'eat', 'esc'];
      body = `<div class="controls">${rows.map((r) => `<div class="kv"><span>${escapeHtml(t(`controls.${r}.keys`))}</span><b>${escapeHtml(t(`controls.${r}.what`))}</b></div>`).join('')}</div>`;
    }
    return tabs(list, this.tab) + body;
  }

  onAction(action, data) {
    if (action === 'tab') this.tab = data.tab;
    else if (action === 'save') {
      const ok = SaveSystem.save(data.slot, this.sim);
      this.sim.toast(ok ? 'toast.saved' : 'toast.save_failed', { n: data.slot }, ok ? 'good' : 'danger');
    } else if (action === 'load') {
      const state = SaveSystem.load(data.slot);
      if (!state) {
        this.sim.toast('toast.load_failed', {}, 'danger');
        return;
      }
      this.ui.closePanel();
      this.ui.scene.loadSimulation(new Simulation(state));
    } else if (action === 'lang') {
      setLanguage(data.code);
    } else if (action === 'quit') {
      this.ui.closePanel();
      this.ui.scene.quitToTitle();
    }
  }
}
