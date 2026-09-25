/**
 * A school, seen from inside (SchoolSystem): who teaches, who learns, how full
 * the room is, and why lessons here are as good (or as poor) as they are.
 *
 *   Overview — the school, its classes, seats and teachers, and what makes the lessons what they are
 *   Classes  — each class: when, what it teaches, and every pupil with how close they are to passing
 *   Teachers — each teacher: rank, how well they teach, how long they've taught, their pay
 */
import { Panel } from '../Panel.js';
import { t, tn, npcName, fmtMoney, cap } from '../../i18n/i18n.js';
import { escapeHtml, buildingLabel, agoText } from '../format.js';
import { bar, tabs, button } from '../widgets.js';
import { STAGES, SCHOOL_TYPES } from '../../data/education.js';
import { VOCATIONAL } from '../../data/careers.js';
import { STUDY_PLAYER } from '../../data/study.js';
import { fieldName, motivationWord } from '../education.js';

const pct = (v) => `${Math.round(v * 100)}%`;

export class SchoolPanel extends Panel {
  constructor(ui, buildingId, tab = 'overview') {
    super(ui);
    this.buildingId = buildingId;
    this.tab = tab;
  }
  get id() {
    return 'school';
  }
  get school() {
    return this.sim.schools.rec(this.buildingId);
  }
  title() {
    return `${SCHOOL_TYPES[this.school?.kind]?.icon || '📚'} ${escapeHtml(buildingLabel(this.sim, this.buildingId))}`;
  }

  render() {
    const s = this.school;
    if (!s) return `<div class="muted">${escapeHtml(t('school.not_open'))}</div>`;
    const pages = [
      ['overview', t('school.tab_overview')],
      ['classes', t('school.tab_classes')],
      ['teachers', t('school.tab_teachers')],
    ];
    const body = { overview: () => this.overview(s), classes: () => this.classes(s), teachers: () => this.teachers(s) }[this.tab]();
    return tabs(pages, this.tab) + body;
  }

  kv(k, v) {
    return `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;
  }

  personLink(n, extra = '') {
    return `<span class="clickable" data-action="inspect" data-id="${n.id}">${escapeHtml(npcName(n))}</span>${extra}`;
  }

  overview(s) {
    const sim = this.sim;
    const Sc = sim.schools;
    const kv = (k, v) => this.kv(k, v);
    const c = Sc.crowding(s);
    const running = Sc.stagesRunning(s);
    const head = Sc.head(s);
    const lines = [];
    lines.push(`<div class="muted small">${escapeHtml(t(`school.kind_desc.${s.kind}`))}</div>`);
    lines.push(kv(t('school.founded'), escapeHtml(agoText(sim.time.day - s.founded))));
    lines.push(kv(t('school.run_by'), escapeHtml(s.funder === 'player' ? t('school.run_by_you') : s.funder === 'village' ? t('school.run_by_village') : buildingLabel(sim, sim.economy.biz(s.funder)?.building))));
    lines.push(kv(t('school.head'), head ? this.personLink(head) : escapeHtml(t('school.no_teacher'))));
    // Seats and teachers.
    const crowd = c.perSeat > 1.1 ? 'overcrowded' : c.perSeat > 0.85 ? 'full' : 'room';
    lines.push(`<div class="need-row"><span>${escapeHtml(t('school.pupils'))}</span>${bar(Math.min(100, c.perSeat * 100), crowd === 'overcrowded' ? 'warn' : 'xp', t('school.pupils_of_seats', { n: c.pupils, seats: c.seats }))}</div>`);
    lines.push(kv(t('school.room'), escapeHtml(t(`school.crowd.${crowd}`))));
    lines.push(kv(t('school.teachers'), escapeHtml(tn('school.n_teachers', c.teachers)) + (c.teachers ? ` · ${escapeHtml(t('school.per_teacher', { n: (c.pupils / c.teachers).toFixed(1) }))}` : '')));
    const eve = Sc.pupils(s, 'evening').length;
    if (eve) lines.push(kv(t('school.evening'), escapeHtml(tn('school.n_grownups', eve))));
    // Classes it runs, and the ones it can't.
    lines.push(`<h3>${escapeHtml(t('school.classes'))}</h3>`);
    for (const st of [...SCHOOL_TYPES[s.kind].stages, ...(SCHOOL_TYPES[s.kind].evening ? ['evening'] : [])]) {
      const on = running.includes(st);
      const course = STAGES[st].course;
      const need = course ? t('school.need_instructor', { n: VOCATIONAL.instructorMin }) : Object.entries(STAGES[st].teacher || {}).map(([f, v]) => `${t(`knowledge.${f}`)} ${v}`).join(', ');
      const runs = course ? t('school.courses_list', { list: Sc.courses(s).map((f) => t(`knowledge.${f}`)).join(', ') }) : t('school.class_runs');
      lines.push(kv(t(`stage.${st}`), on ? escapeHtml(runs) : `<span class="warn">${escapeHtml(t('school.class_no_teacher', { need }))}</span>`));
    }
    // Why lessons here are as good as they are.
    for (const st of running) {
      const q = Sc.quality(s, st, STAGES[st].course ? Sc.courses(s)[0] : null);
      lines.push(`<h3>${escapeHtml(t('school.quality_of', { stage: t(`stage.${st}`) }))} — ${pct(q.total)}</h3>`);
      const f = (key, v, tip) => `<div class="need-row" title="${escapeHtml(tip || '')}"><span>${escapeHtml(t(`school.q.${key}`))}</span>${bar(Math.min(100, v * 70), v < 0.9 ? 'warn' : 'good', pct(v))}</div>`;
      lines.push(f('teacher', q.teacher, t('school.q_tip.teacher')));
      lines.push(f('building', q.building, t('school.q_tip.building', { n: Math.round(sim.property.rec(s.id)?.condition ?? 0) })));
      if (st !== 'evening') {
        lines.push(f('crowd', q.crowd, t('school.q_tip.crowd')));
        lines.push(f('ratio', q.ratio, t('school.q_tip.ratio')));
      }
      lines.push(f('books', q.books, t('school.q_tip.books', { n: Math.floor(s.books || 0) })));
      if (q.mentor > 1) lines.push(`<div class="muted small">${escapeHtml(t('school.q_mentor'))}</div>`);
      if (q.library > 1) lines.push(`<div class="muted small">${escapeHtml(t('school.q_library'))}</div>`);
    }
    // Its story so far.
    lines.push(`<h3>${escapeHtml(t('school.record'))}</h3>`);
    lines.push(kv(t('school.pupils_ever'), s.pupilsEver || 0));
    lines.push(kv(t('school.graduates'), s.graduates || 0));
    if (s.turnedAway) lines.push(kv(t('school.turned_away'), s.turnedAway));
    const fee = Sc.fee(s);
    lines.push(kv(t('school.fees'), fee ? escapeHtml(t('school.fee_week', { money: fmtMoney(fee) })) : escapeHtml(t('school.free'))));
    lines.push(this.youHtml(s));
    lines.push(`<div class="muted small">${escapeHtml(t('school.hint'))}</div>`);
    return lines.join('');
  }

  /** What you can do here: sign up for a course, give books, pay the teachers for a month. */
  youHtml(s) {
    const sim = this.sim;
    const St = sim.study;
    const p = sim.state.player;
    const out = [`<h3>${escapeHtml(t('school.you'))}</h3>`];
    if (s.founder === 'player') out.push(`<div class="muted small">${escapeHtml(t('school.founded_by_you'))}</div>`);
    const c = St.e.course;
    if (c) out.push(this.kv(t('school.your_course'), escapeHtml(t('school.course_progress', { field: t(`knowledge.${c.field}`), n: c.lessons, n2: STUDY_PLAYER.courseLessons }))));
    else if (s.kind === 'trade') {
      const btns = sim.schools.courses(s).map((f) => button(t('school.sign_up', { field: t(`knowledge.${f}`), money: fmtMoney(STUDY_PLAYER.courseFee) }), 'sign_up', { field: f }, { disabled: p.money < STUDY_PLAYER.courseFee || St.e.quals.some((q) => q.field === f) }));
      if (btns.length) out.push(`<div class="btn-row">${btns.join('')}</div><div class="muted small">${escapeHtml(t('school.course_hint'))}</div>`);
    }
    const endow = St.endowCost(s.id);
    out.push(`<div class="btn-row">${button(t('school.give_books', { money: fmtMoney(STUDY_PLAYER.booksGift), n: STUDY_PLAYER.booksPerGift }), 'give_books', {}, { disabled: p.money < STUDY_PLAYER.booksGift })}${button(t('school.endow', { money: fmtMoney(endow) }), 'endow', {}, { disabled: p.money < endow })}</div>`);
    if (s.endowment > 0) out.push(`<div class="muted small">${escapeHtml(t('school.endowment_left', { money: fmtMoney(Math.floor(s.endowment)) }))}</div>`);
    return out.join('');
  }

  classes(s) {
    const sim = this.sim;
    const Sc = sim.schools;
    const out = [];
    const stages = [...SCHOOL_TYPES[s.kind].stages, ...(SCHOOL_TYPES[s.kind].evening ? ['evening'] : [])];
    for (const st of stages) {
      const def = STAGES[st];
      const pupils = Sc.pupils(s, st).sort((a, b) => b.age - a.age);
      const running = Sc.stagesRunning(s).includes(st);
      const hours = `${String(Math.floor(def.hours[0])).padStart(2, '0')}:${def.hours[0] % 1 ? '30' : '00'}–${String(Math.floor(def.hours[1])).padStart(2, '0')}:00`;
      const days = def.days ? def.days.map((d) => t(`weekday.${d}`)).join(', ') : '';
      out.push(`<h3>${escapeHtml(t(`stage.${st}`))} <span class="muted small">${escapeHtml(def.days ? t('school.evenings', { hours, days }) : t('school.mornings', { hours }))}</span></h3>`);
      if (!running) out.push(`<div class="muted small warn">${escapeHtml(t('school.class_closed'))}</div>`);
      if (def.course) out.push(`<div class="muted small">${escapeHtml(t('school.course_subjects', { list: Sc.courses(s).map((f) => t(`knowledge.${f}`)).join(', ') || '—' }))}</div><div class="muted small">${escapeHtml(t('school.course_pass', { n: VOCATIONAL.passCompetence }))}</div>`);
      else out.push(`<div class="muted small">${escapeHtml(t('school.subjects'))}: ${escapeHtml(Object.keys(def.subjects).map((f) => fieldName(f).trim()).join(' · '))}</div>`);
      if (def.pass) out.push(`<div class="muted small">${escapeHtml(t('school.to_pass'))}: ${escapeHtml(Object.entries(def.pass).map(([f, v]) => `${t(`knowledge.${f}`)} ${v}`).join(', '))}</div>`);
      if (!pupils.length) {
        out.push(`<div class="muted small">${escapeHtml(t('school.no_pupils'))}</div>`);
        continue;
      }
      for (const n of pupils) {
        const en = n.edu.enrol;
        const prog = def.pass ? Sc.progress(n, st) : Math.min(1, sim.education.know(n, 'reading') / 25);
        const present = Sc.present(n, s) ? ' 🪑' : '';
        const talent = n.edu.talented ? ' ⭐' : '';
        out.push(`<div class="pupil-row">
          <span>${this.personLink(n, `${present}${talent}`)} <span class="muted small">${escapeHtml(t('ui.age_n', { age: n.age }))}${en.field ? ` · ${escapeHtml(t(`knowledge.${en.field}`))}` : ''} · ${escapeHtml(t('school.year_n', { n: en.years + 1 }))}${en.fails ? ` · ${escapeHtml(t('school.repeating'))}` : ''}</span></span>
          ${bar(prog * 100, prog >= 1 ? 'good' : 'xp', t('school.ready_pct', { n: Math.round(prog * 100) }))}
          <span class="muted small">${escapeHtml(t(`learn.mot.${motivationWord(n.edu.mot)}`))}</span>
        </div>`);
      }
    }
    return out.join('');
  }

  teachers(s) {
    const sim = this.sim;
    const Sc = sim.schools;
    const teachers = Sc.teachersOf(s);
    const out = [];
    if (!teachers.length) out.push(`<div class="muted">${escapeHtml(t('school.no_teacher_long'))}</div>`);
    const head = Sc.head(s);
    for (const n of teachers) {
      const rank = Sc.rankOf(n);
      const ab = Sc.ability(n);
      const subjects = ['reading', 'writing', 'maths', 'science', 'lore']
        .map((f) => [f, sim.education.know(n, f)])
        .filter(([, v]) => v >= 10)
        .map(([f, v]) => `${t(`knowledge.${f}`)} ${Math.round(v)}`)
        .join(' · ');
      out.push(`<div class="teacher-card">
        <div><b>${this.personLink(n)}</b> — ${escapeHtml(t(`teacher_rank.${rank}`, { gender: n.gender }))}${n === head ? ` <span class="muted small">(${escapeHtml(t('school.head_short'))})</span>` : ''}</div>
        <div class="need-row"><span>${escapeHtml(t('school.teaching'))}</span>${bar(Math.min(100, (ab - 0.6) * 100), 'xp', t(`school.ability.${ab >= 1.3 ? 'gifted' : ab >= 1.05 ? 'good' : ab >= 0.85 ? 'fair' : 'poor'}`))}</div>
        <div class="muted small">${escapeHtml(t('school.taught_days', { n: Math.floor(n.teach.days || 0) }))} · ${escapeHtml(t('school.salary', { money: fmtMoney(Sc.salary(n)) }))}${n.teach.unpaid ? ` · <span class="warn">${escapeHtml(t('school.unpaid', { n: n.teach.unpaid }))}</span>` : ''}</div>
        ${subjects ? `<div class="muted small">${escapeHtml(cap(subjects))}</div>` : ''}
        <div class="btn-row">${button(t('dialog.opt.talk_instead'), 'talk', { id: n.id })}</div>
      </div>`);
    }
    out.push(`<div class="muted small">${escapeHtml(t('school.teachers_hint'))}</div>`);
    return out.join('');
  }

  onAction(action, data) {
    if (action === 'tab') this.tab = data.tab;
    if (action === 'sign_up') this.sim.study.signUp(this.buildingId, data.field);
    if (action === 'give_books') this.sim.study.giveBooks(this.buildingId);
    if (action === 'endow') this.sim.study.endowTeachers(this.buildingId);
    if (action === 'inspect' && data.id) this.ui.openInspect(data.id, 'learning');
    if (action === 'talk' && data.id) this.ui.openDialogue(data.id);
  }
}
