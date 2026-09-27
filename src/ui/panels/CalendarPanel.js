/**
 * The calendar: the next two weeks, day by day — festivals, market days, meetings and the election, weddings
 * and funerals, your friends' name days, orders due, the traders' goods, the rent (ui/calendar.js).
 */
import { Panel } from '../Panel.js';
import { t } from '../../i18n/i18n.js';
import { tr, escapeHtml, dateString } from '../format.js';
import { upcoming } from '../calendar.js';

export class CalendarPanel extends Panel {
  get id() {
    return 'calendar';
  }
  title() {
    return `📅 ${escapeHtml(t('cal.title'))}`;
  }

  render() {
    const sim = this.sim;
    const today = sim.time.day;
    const list = upcoming(sim, 14);
    const days = [];
    for (let d = today; d < today + 14; d++) {
      const items = list.filter((e) => e.day === d);
      const wd = t(`weekday.${d % 7}`);
      const head = d === today ? t('cal.today') : d === today + 1 ? t('cal.tomorrow') : wd;
      days.push(`<div class="cal-day${d === today ? ' today' : ''}${items.length ? '' : ' empty'}">
        <div class="cal-date"><b>${escapeHtml(head)}</b><span class="muted small">${escapeHtml(dateString(d))}</span></div>
        <div class="cal-items">${items.map((e) => `<div class="cal-item cal-${e.kind}">${e.icon} ${e.hour !== null && e.hour !== undefined ? `<span class="muted small">${String(e.hour).padStart(2, '0')}:00</span> ` : ''}${escapeHtml(tr(sim, e.key, e.params))}</div>`).join('') || `<span class="muted small">—</span>`}</div>
      </div>`);
    }
    return `<div class="calendar">${days.join('')}</div><div class="hint">${escapeHtml(t('cal.hint'))}</div>`;
  }
}
