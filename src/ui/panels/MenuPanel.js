/**
 * Game menu (Esc) — save, load, language, controls, quit to title.
 */
import { Panel } from '../Panel.js';
import { t, LANGUAGES, getLanguage, setLanguage, npcName } from '../../i18n/i18n.js';
import { escapeHtml } from '../format.js';
import { button, tabs } from '../widgets.js';
import { UI_SCALES, getSetting, setSetting } from '../settings.js';

/** The screens of the game, for the menu's quick links. */
const SCREENS = [
  ['character', '👤', 'C'],
  ['inventory', '🎒', 'I'],
  ['journal', '📖', 'J'],
  ['map', '🗺️', 'M'],
  ['affairs', '💼', 'L'],
  ['workers', '👷', 'K'],
  ['build', '🔨', 'B'],
];
const SCREEN_LABEL = { character: 'ui.character', inventory: 'ui.inventory', journal: 'ui.journal', map: 'ui.map', affairs: 'affairs.title', workers: 'ui.workers', build: 'ui.key_build' };
import { SaveSystem } from '../../systems/SaveSystem.js';
import { Simulation } from '../../core/Simulation.js';

export function slotDescription(meta) {
  if (!meta) return t('ui.empty_slot');
  const when = new Date(meta.savedAt).toLocaleString(getLanguage() === 'ru' ? 'ru-RU' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
  return t('ui.slot_meta', { name: npcName(meta), level: meta.level, day: meta.day, season: t(`season.${meta.season}`), year: meta.year, when });
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
        ${button(`💾 ${t('ui.quick_save')}`, 'save', { slot: '1' }, { cls: 'big' })}
      </div>
      <div class="menu-grid">${SCREENS.map(([id, ico, key]) => `<button class="menu-tile" data-action="open" data-screen="${id}"><span class="mt-ico">${ico}</span>${escapeHtml(t(SCREEN_LABEL[id]))}<kbd>${key}</kbd></button>`).join('')}</div>
      <div class="btn-row" style="margin-top:16px">${this.confirmQuit ? `<span class="warn small">${escapeHtml(t('ui.quit_confirm'))}</span> ${button(t('ui.yes'), 'quit', {}, { cls: 'danger' })} ${button(t('ui.no'), 'quit_no', {}, { cls: 'ghost' })}` : button(t('ui.quit_title'), 'quit_ask', {}, { cls: 'ghost' })}</div>
      <div class="hint">${escapeHtml(t('ui.quit_hint'))}</div>`;
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
      const scale = getSetting('uiScale') || 1;
      const fs = !!document.fullscreenElement;
      body = `<div class="setting-row"><div><b>${escapeHtml(t('ui.language'))}</b><div class="hint">${escapeHtml(t('ui.language_hint'))}</div></div><div class="btn-row">${LANGUAGES.map((l) => button(`${l.flag} ${l.label}`, 'lang', { code: l.code }, { cls: l.code === cur ? 'selected' : 'ghost' })).join('')}</div></div>
        <div class="setting-row"><div><b>${escapeHtml(t('ui.ui_scale'))}</b><div class="hint">${escapeHtml(t('ui.ui_scale_hint'))}</div></div><div class="btn-row">${UI_SCALES.map((s) => button(`${Math.round(s * 100)}%`, 'scale', { s }, { cls: `sm ${Math.abs(s - scale) < 0.01 ? 'selected' : 'ghost'}` })).join('')}</div></div>
        <div class="setting-row"><div><b>${escapeHtml(t('ui.fullscreen'))}</b><div class="hint">${escapeHtml(t('ui.fullscreen_hint'))}</div></div>${button(t(fs ? 'ui.fullscreen_off' : 'ui.fullscreen_on'), 'fullscreen', {}, { cls: fs ? 'selected' : '' })}</div>`;
    } else if (this.tab === 'controls') {
      const rows = ['move', 'interact', 'inspect_key', 'menu_keys', 'more_keys', 'numbers', 'eat', 'esc'];
      // Keys as key caps: "W A S D / Arrows" → [W][A][S][D] / [Arrows]
      const caps = (s) => s.split(/\s*[/·]\s*/).map((grp) => grp.split(/\s+/).map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('')).join(' <span class="muted">/</span> ');
      body = `<div class="controls">${rows.map((r) => `<div class="kv"><span>${caps(t(`controls.${r}.keys`))}</span><b>${escapeHtml(t(`controls.${r}.what`))}</b></div>`).join('')}</div>`;
    }
    return tabs(list, this.tab) + body;
  }

  onAction(action, data) {
    if (action === 'open') return this.ui.togglePanel(data.screen);
    if (action === 'scale') setSetting('uiScale', Number(data.s));
    if (action === 'fullscreen') {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => {});
      setTimeout(() => this.ui.renderPanel(), 300);
    }
    if (action === 'quit_ask') this.confirmQuit = true;
    if (action === 'quit_no') this.confirmQuit = false;
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
