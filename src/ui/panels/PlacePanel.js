/**
 * Place — a neighbourhood or a district: its name, what kind of place it is, its people and
 * homes, what houses there are worth and let for, how they're kept, the land, how built-up it
 * is, what's near (road, water, a shop, a school…), its businesses and its story.
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel, districtLabel, districtKindLabel, hoodLabel, dateString } from '../format.js';
import { stat, statGrid, filters } from '../widgets.js';
import { HOOD_SERVICES } from '../../data/places.js';

export class PlacePanel extends Panel {
  /** place = { hood: id } or { district: id } */
  constructor(ui, place) {
    super(ui);
    this.place = place;
  }
  get id() {
    return 'place';
  }
  get hood() {
    return this.place.hood ? this.sim.places.hood(this.place.hood) : null;
  }
  get district() {
    return this.place.district ? this.sim.places.district(this.place.district) : null;
  }
  title() {
    if (this.place.hood) return `🏘️ ${escapeHtml(hoodLabel(this.sim, this.place.hood))}`;
    return `🗺️ ${escapeHtml(districtLabel(this.district) || t('district.unnamed'))}`;
  }

  render() {
    const h = this.hood;
    const d = this.district;
    if (this.place.hood && !h) return `<div class="muted">${escapeHtml(t('place_ui.faded'))}</div>`;
    if (this.place.district && !d) return `<div class="muted">${escapeHtml(t('place_ui.gone'))}</div>`;
    return h ? this.hoodHtml(h) : this.districtHtml(d);
  }

  hoodHtml(h) {
    const sim = this.sim;
    const pl = sim.places;
    const st = pl.stats(h);
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;
    const tick = (on) => (on ? '✓' : '✗');
    const b0 = sim.world.buildings[h.homes[0]];
    const d = b0 ? pl.districtAt(b0.door.tx, b0.door.ty) : null;
    const services = Object.keys(HOOD_SERVICES)
      .map((k) => `<span class="chip ${st.services.includes(k) ? 'ok' : 'muted'}">${tick(st.services.includes(k))} ${escapeHtml(t(`hood_service.${k}`))}</span>`)
      .join(' ');
    const rep = st.rep;
    const repWord = rep >= 0.12 ? 'good' : rep >= 0.03 ? 'decent' : rep > -0.05 ? 'plain' : 'poor';
    const biz = st.businesses.map((id) => `<div class="rumor clickable" data-action="building" data-id="${id}">🏪 ${escapeHtml(buildingLabel(sim, id))}</div>`).join('');
    const homes = h.homes
      .filter((id) => sim.world.buildings[id])
      .map((id) => `<div class="rumor clickable" data-action="building" data-id="${id}">🏠 ${escapeHtml(buildingLabel(sim, id))} <span class="muted small">· ${escapeHtml(t(`place_home.${sim.property.housingState(id)}`))}</span></div>`)
      .join('');
    return `
      <div class="place-head">
        <div class="place-kind">${escapeHtml(t(`hood_kind.${h.kind}`))}</div>
        <div class="muted small">${escapeHtml(t('place_ui.founded', { when: h.founded ? dateString(h.founded) : t('place_ui.long_ago') }))}${d ? ` · ${escapeHtml(t('place_ui.in_district', { name: districtLabel(d) }))}` : ''}</div>
      </div>
      ${statGrid([
        stat(t('place_ui.population'), st.pop),
        stat(t('place_ui.homes'), st.homes),
        stat(t('place_ui.avg_value'), escapeHtml(fmtMoney(st.value))),
        stat(t('place_ui.avg_rent'), escapeHtml(t('place_ui.per_week', { money: fmtMoney(st.rent) }))),
        stat(t('place_ui.quality'), `${st.quality}%`),
        stat(t('place_ui.condition'), `${st.condition}%`),
      ])}
      ${kv(t('place_ui.standing'), `${escapeHtml(t(`place_rep.${repWord}`))} <span class="muted small">(${rep >= 0 ? '+' : '−'}${Math.abs(Math.round(rep * 100))}%)</span>`)}
      <div class="muted small">${escapeHtml(t('place_ui.standing_hint'))}</div>
      ${kv(t('place_ui.land'), escapeHtml(t('place_ui.land_mult', { x: st.land.toFixed(2) })))}
      ${kv(t('place_ui.development'), escapeHtml(t(`dev_level.${st.dev}`)))}
      ${st.let ? kv(t('place_ui.let_out'), st.let) : ''}
      <h3>${escapeHtml(t('place_ui.infra'))}</h3>
      <div class="chips">
        <span class="chip ${st.road >= 0.5 ? 'ok' : 'muted'}">${tick(st.road >= 0.5)} ${escapeHtml(t('place_ui.road'))}</span>
        ${this.infraChips(h.tx, h.ty)}
        ${services}
      </div>
      ${biz ? `<h3>${escapeHtml(t('place_ui.businesses'))}</h3>${biz}` : ''}
      <h3>${escapeHtml(t('place_ui.its_homes'))}</h3>${homes}
      ${this.storyHtml(h.hist, 'hood_event')}`;
  }

  /** Cobbles and lamps where its middle is (InfrastructureSystem). */
  infraChips(tx, ty) {
    const cov = this.sim.infra?.coverage(tx, ty);
    if (!cov) return '';
    const chip = (on, k) => `<span class="chip ${on ? 'ok' : 'muted'}">${on ? '✓' : '✗'} ${escapeHtml(t(`place_ui.${k}`))}</span>`;
    return chip(cov.paved, 'paved') + chip(cov.light, 'lamps');
  }

  districtHtml(d) {
    const sim = this.sim;
    const pl = sim.places;
    const st = pl.districtStats(d);
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;
    const pct = (x) => `${Math.round(x * 100)}%`;
    const hoods = st.hoods.map((id) => `<div class="rumor clickable" data-action="hood" data-id="${id}">🏘️ ${escapeHtml(hoodLabel(sim, id))} <span class="muted small">· ${escapeHtml(t(`hood_kind.${pl.hood(id)?.kind || 'residential'}`))}</span></div>`).join('');
    return `
      <div class="place-head">
        <div class="place-kind">${escapeHtml(districtKindLabel(d))}</div>
        <div class="muted small">${escapeHtml(t(`district.char_hint.${d.char || 'none'}`))}</div>
      </div>
      ${statGrid([
        stat(t('place_ui.population'), st.pop),
        stat(t('place_ui.buildings'), st.buildings),
        stat(t('place_ui.homes'), st.homes),
        stat(t('place_ui.businesses_n'), st.businesses),
        stat(t('place_ui.avg_value'), st.homes ? escapeHtml(fmtMoney(st.value)) : '—'),
        stat(t('place_ui.avg_rent'), st.homes ? escapeHtml(t('place_ui.per_week', { money: fmtMoney(st.rent) })) : '—'),
      ])}
      ${kv(t('place_ui.land'), escapeHtml(t('place_ui.land_mult', { x: st.land.toFixed(2) })))}
      ${kv(t('place_ui.development'), escapeHtml(t(`dev_level.${st.dev}`)))}
      <h3>${escapeHtml(t('place_ui.infra'))}</h3>
      ${kv(t('place_ui.road_share'), pct(st.road))}
      ${kv(t('place_ui.well_share'), pct(st.well))}
      ${hoods ? `<h3>${escapeHtml(t('place_ui.hoods_here'))}</h3>${hoods}` : ''}
      ${this.storyHtml(d.hist, 'district_event')}`;
  }

  /** What has happened to the place, newest first. */
  storyHtml(hist = [], ns) {
    const ev = hist.slice(-8).reverse();
    if (!ev.length) return '';
    const sim = this.sim;
    const line = (e) => {
      const p = { ...e };
      delete p.day;
      delete p.k;
      if (e.k === 'kind') Object.assign(p, { hkfrom: e.from, hkind: e.to });
      if (e.k === 'type') Object.assign(p, { from: e.from, to: e.to });
      if (e.k === 'formed') Object.assign(p, { to: e.type });
      if (e.k === 'service') p.service = e.s;
      if (e.k === 'char') p.dchar = e.ch;
      const key = e.k === 'founded' && e.old ? 'founded_old' : e.k === 'formed' && e.old ? 'formed_old' : e.k;
      return `<div class="small"><span class="muted">${escapeHtml(e.day ? dateString(e.day) : t('place_ui.long_ago'))}</span> ${escapeHtml(tr(sim, `${ns}.${key}`, p))}</div>`;
    };
    return `<h3>${escapeHtml(t('place_ui.story'))}</h3>${ev.map(line).join('')}`;
  }

  onAction(action, data) {
    if (action === 'building') this.ui.openProperty(data.id);
    else if (action === 'hood') this.ui.openPlace({ hood: data.id });
  }
}
