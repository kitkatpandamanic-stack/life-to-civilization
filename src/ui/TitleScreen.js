/**
 * Title screen — new game, continue, load, language.
 */
import { t, LANGUAGES, getLanguage, setLanguage, onLanguageChange } from '../i18n/i18n.js';
import { escapeHtml } from './format.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { Simulation } from '../core/Simulation.js';
import { slotDescription } from './panels/MenuPanel.js';

export class TitleScreen {
  constructor({ onStart }) {
    this.onStart = onStart;
    this.view = 'main';
    this.root = document.getElementById('ui');
    this.el = document.createElement('div');
    this.el.className = 'title-screen';
    this.root.innerHTML = '';
    this.root.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.onKey = (e) => {
      if (e.key === 'Enter' && this.view === 'new') this.startNew();
      if (e.key === 'Escape' && this.view !== 'main') {
        this.view = 'main';
        this.render();
      }
    };
    window.addEventListener('keydown', this.onKey);
    this.unsubLang = onLanguageChange(() => this.render());
    this.render();
  }

  render() {
    const latest = SaveSystem.latest();
    const lang = getLanguage();
    let content = '';
    if (this.view === 'main') {
      content = `
        ${latest ? `<button class="btn big primary" data-action="continue">${escapeHtml(t('titlescreen.continue'))}<small>${escapeHtml(slotDescription(latest.meta))}</small></button>` : ''}
        <button class="btn big ${latest ? '' : 'primary'}" data-action="new">${escapeHtml(t('titlescreen.new_game'))}</button>
        <button class="btn big" data-action="load" ${latest ? '' : 'disabled'}>${escapeHtml(t('titlescreen.load'))}</button>`;
    } else if (this.view === 'new') {
      content = `
        <label class="field">${escapeHtml(t('titlescreen.your_name'))}<input type="text" maxlength="16" value="${escapeHtml(this.name || t(this.gender === 'f' ? 'titlescreen.default_name_f' : 'titlescreen.default_name'))}" class="name-input"></label>
        <div class="gender-pick">${['m', 'f'].map((g) => `<button class="lang-btn${(this.gender || 'm') === g ? ' active' : ''}" data-action="gender" data-g="${g}">${escapeHtml(t(`titlescreen.gender_${g}`))}</button>`).join('')}</div>
        <p class="intro">${escapeHtml(t('titlescreen.intro'))}</p>
        <button class="btn big primary" data-action="start">${escapeHtml(t('titlescreen.start'))}</button>
        <button class="btn" data-action="back">${escapeHtml(t('titlescreen.back'))}</button>`;
    } else if (this.view === 'load') {
      content =
        SaveSystem.list()
          .map(
            (s) => `<button class="btn slot" data-action="load_slot" data-slot="${s.slot}" ${s.meta ? '' : 'disabled'}>
              <b>${escapeHtml(s.slot === 'auto' ? t('ui.autosave') : t('ui.slot_n', { n: s.slot }))}</b><small>${escapeHtml(slotDescription(s.meta))}</small></button>`,
          )
          .join('') + `<button class="btn" data-action="back">${escapeHtml(t('titlescreen.back'))}</button>`;
    }
    this.el.innerHTML = `
      <div class="title-sky"><div class="sun"></div><div class="hills h1"></div><div class="hills h2"></div><div class="hills h3"></div></div>
      <div class="title-card">
        <div class="title-logo">${escapeHtml(t('titlescreen.game_name'))}</div>
        <div class="title-sub">${escapeHtml(t('titlescreen.subtitle'))}</div>
        <div class="title-path">${escapeHtml(t('titlescreen.path'))}</div>
        <div class="title-menu">${content}</div>
        <div class="title-lang">${LANGUAGES.map((l) => `<button class="lang-btn${l.code === lang ? ' active' : ''}" data-action="lang" data-code="${l.code}">${l.flag} ${l.label}</button>`).join('')}</div>
        <div class="title-foot">${escapeHtml(t('titlescreen.footer'))}</div>
      </div>`;
    const input = this.el.querySelector('.name-input');
    if (input) {
      input.focus();
      input.select();
      input.addEventListener('input', () => (this.name = input.value));
    }
  }

  onClick(e) {
    const b = e.target.closest('[data-action]');
    if (!b || b.disabled) return;
    const a = b.dataset.action;
    if (a === 'new') {
      this.view = 'new';
      this.render();
    } else if (a === 'back') {
      this.view = 'main';
      this.render();
    } else if (a === 'load') {
      this.view = 'load';
      this.render();
    } else if (a === 'start') this.startNew();
    else if (a === 'continue') this.loadSlot(SaveSystem.latest()?.slot);
    else if (a === 'load_slot') this.loadSlot(b.dataset.slot);
    else if (a === 'lang') setLanguage(b.dataset.code);
    else if (a === 'gender') {
      const input = this.el.querySelector('.name-input');
      const wasDefault = !this.name || this.name === t(this.gender === 'f' ? 'titlescreen.default_name_f' : 'titlescreen.default_name');
      this.gender = b.dataset.g;
      if (wasDefault) this.name = t(this.gender === 'f' ? 'titlescreen.default_name_f' : 'titlescreen.default_name');
      else if (input) this.name = input.value;
      this.render();
    }
  }

  startNew() {
    const input = this.el.querySelector('.name-input');
    const gender = this.gender || 'm';
    const name = (input?.value || '').trim() || t(gender === 'f' ? 'titlescreen.default_name_f' : 'titlescreen.default_name');
    this.onStart(Simulation.newGame(name, undefined, { gender }));
  }

  loadSlot(slot) {
    const state = slot && SaveSystem.load(slot);
    if (state) this.onStart(new Simulation(state));
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    this.unsubLang();
    this.el.remove();
  }
}
