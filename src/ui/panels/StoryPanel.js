/**
 * A story scene (StorySystem): what's happening — told with the real names — and your choices, each
 * with what it takes (money, your good name…). Choosing moves the story on.
 */
import { Panel } from '../Panel.js';
import { t } from '../../i18n/i18n.js';
import { tr, escapeHtml } from '../format.js';
import { portrait } from '../widgets.js';
import { STORIES } from '../../data/stories.js';

export class StoryPanel extends Panel {
  constructor(ui, id) {
    super(ui);
    this.storyId = Number(id);
  }
  get id() {
    return 'story';
  }
  st() {
    return this.sim.stories.get(this.storyId);
  }
  title() {
    const st = this.st();
    return `${st ? STORIES[st.story].icon : '📜'} ${escapeHtml(st ? t(`story.${st.story}.title`) : t('story_ui.tab'))}`;
  }

  render() {
    const sim = this.sim;
    const S = sim.stories;
    const st = this.st();
    if (!st) return `<p class="muted">${escapeHtml(t('story_ui.over'))}</p>`;
    const p = S.params(st);
    if (!S.ready(st)) return `<p class="muted">${escapeHtml(t('story_ui.later'))}</p>`;
    S.meet(st); // (a scene is a conversation with them)
    const who = sim.npcs.byId(st.cast[S.stage(st).with]);
    const face = who ? portrait(`story_${who.id}`, who.look, 72) : '';
    let html = `<div class="story-scene">${face}<p class="story-text">${escapeHtml(tr(sim, `story.${st.story}.${st.stage}.text`, p))}</p></div><div class="dlg-opts">`;
    let n = 1;
    for (const c of S.choices(st)) {
      const why = c.ok ? '' : tr(sim, `reason.${c.reason}`, c.params || {});
      html += `<div class="dlg-opt${c.ok ? '' : ' disabled'}" data-action="choose" data-choice="${c.id}" data-hotkey="${n}"><kbd>${n++}</kbd>${escapeHtml(tr(sim, `story.${st.story}.${st.stage}.${c.id}`, p))}${why ? `<span class="note">${escapeHtml(why)}</span>` : ''}</div>`;
    }
    return `${html}</div>`;
  }

  onAction(action, data) {
    if (action !== 'choose') return;
    const r = this.sim.stories.choose(this.storyId, data.choice);
    if (!r.ok) return this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    this.ui.closePanel();
  }
}
