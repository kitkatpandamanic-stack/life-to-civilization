/**
 * Stories in the journal (StorySystem): the ones going on — a scene waiting for you, or what you're
 * waiting for — and how the finished ones ended.
 */
import { t } from '../i18n/i18n.js';
import { tr, escapeHtml } from './format.js';
import { button, emptyState } from './widgets.js';
import { STORIES } from '../data/stories.js';

export function storiesHtml(sim) {
  const S = sim.stories;
  if (!S) return '';
  const active = S.S.active;
  const done = S.S.done.filter((d) => d.ending !== 'lost');
  if (!active.length && !done.length) return emptyState('📜', t('story_ui.none'), t('story_ui.none_text'));
  let html = '';
  for (const st of active) {
    const p = S.params(st);
    const ready = S.ready(st);
    const sg = S.stage(st);
    const who = st.cast[sg?.with];
    html += `<div class="card"><div class="card-head"><div class="card-icon">${STORIES[st.story].icon}</div><div><div class="card-title">${escapeHtml(t(`story.${st.story}.title`))}</div>
      <div class="card-sub">${escapeHtml(ready ? tr(sim, 'story_ui.waiting', { npc: who }) : sg?.wait ? tr(sim, `story.${st.story}.${st.stage}.wait`, p) : t('story_ui.later'))}</div></div></div>
      ${ready ? `<div class="btn-row">${button(t('story_ui.open'), 'story_open', { id: st.id }, { cls: 'sm primary' })}</div>` : ''}</div>`;
  }
  if (done.length) {
    html += `<h4>${escapeHtml(t('story_ui.done'))}</h4>`;
    for (const d of done.slice().reverse()) {
      html += `<div class="small">${STORIES[d.story]?.icon || '📜'} <b>${escapeHtml(t(`story.${d.story}.title`))}</b> — ${escapeHtml(t(`story.${d.story}.end_title.${d.ending}`))} <span class="muted">(${escapeHtml(t('ui.day_n', { n: d.day }))})</span></div>`;
    }
  }
  return html;
}
