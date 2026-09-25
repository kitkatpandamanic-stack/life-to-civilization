/**
 * GameScene — the playable world.
 *
 * Builds the views (terrain, objects, buildings, characters, atmosphere),
 * runs the simulation every frame and handles the few flows that need the
 * camera: sleeping, working a shift, passing out and collapsing.
 */
import { DiscoveryPanel as SitePanelDiscovery } from '../ui/panels/DiscoveryPanel.js';
import { SITE_KINDS } from '../data/sites.js';
import { SiteViews } from '../game/SiteViews.js';
import { HOLDINGS } from '../systems/HoldingsSystem.js';
import { EXPEDITION } from '../data/regions.js';
import { ExpeditionPanel } from '../ui/panels/ExpeditionPanel.js';
import { JourneyPanel } from '../ui/panels/JourneyPanel.js';
import { SuccessionPanel } from '../ui/panels/SuccessionPanel.js';
import Phaser from 'phaser';
import { BALANCE } from '../config/balance.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { TerrainView } from '../game/TerrainView.js';
import { WorldObjectViews } from '../game/WorldObjectViews.js';
import { BuildingViews } from '../game/BuildingViews.js';
import { PlayerController } from '../game/PlayerController.js';
import { NPCViews } from '../game/NPCViews.js';
import { Atmosphere } from '../game/Atmosphere.js';
import { ObjectiveIndicator } from '../game/ObjectiveIndicator.js';
import { InteractionSystem } from '../game/InteractionSystem.js';
import { DEPTH } from '../game/depth.js';
import { InteriorView } from '../game/InteriorView.js';
import { ConstructionViews } from '../game/ConstructionViews.js';
import { BuildMode } from '../game/BuildMode.js';
import { FieldViews } from '../game/FieldViews.js';
import { AnimalViews } from '../game/AnimalViews.js';
import { CartViews } from '../game/CartViews.js';
import { FireViews } from '../game/FireViews.js';
import { UIManager } from '../ui/UIManager.js';
import { icon } from '../ui/widgets.js';
import { escapeHtml } from '../ui/format.js';
import { itemName } from '../i18n/i18n.js';
import { STUDY_PLAYER } from '../data/study.js';

const TS = BALANCE.tileSize;

export class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  init(data) {
    this.sim = data.sim;
    this.busy = false;
  }

  create() {
    const sim = this.sim;
    const W = sim.world.W * TS;
    const H = sim.world.H * TS;
    this.worldSize = { W, H };
    // Physics bounds include the interior area east of the map (see InteriorView).
    this.physics.world.setBounds(0, 0, W + 4000, H);
    const cam = this.cameras.main;
    cam.setBounds(0, 0, W, H).setRoundPixels(true).setBackgroundColor('#20301f');

    this.solids = this.physics.add.staticGroup();
    // Invisible wall along the east edge so you can't walk off the map into the interior area.
    const edge = this.add.zone(W + 8, H / 2, 16, H);
    this.physics.add.existing(edge, true);
    this.solids.add(edge);
    this.terrain = new TerrainView(this, sim);
    this.objects = new WorldObjectViews(this, sim);
    this.buildings = new BuildingViews(this, sim);
    this.player = new PlayerController(this, sim);
    this.physics.add.collider(this.player.sprite, this.solids);
    this.physics.add.collider(this.player.sprite, this.terrain.layer);
    this.npcViews = new NPCViews(this, sim);
    this.animals = new AnimalViews(this, sim);
    this.sites = new SiteViews(this, sim);
    this.carts = new CartViews(this, sim);
    this.fireViews = new FireViews(this, sim);
    this.atmosphere = new Atmosphere(this, sim, this.player);
    this.objective = new ObjectiveIndicator(this, sim);
    this.ui = new UIManager(this, sim);
    this.interaction = new InteractionSystem(this);
    this.interior = new InteriorView(this, sim);
    this.inside = false;
    sim.state.player.indoors = false;
    this.constructionViews = new ConstructionViews(this, sim);
    this.fieldViews = new FieldViews(this, sim);
    this.buildMode = new BuildMode(this);

    cam.startFollow(this.player.sprite, true, 0.15, 0.15);
    cam.fadeIn(700);
    this.lightTimer = 0;
    this.floatY = 0;

    this.unsubs = [
      sim.bus.on('time:season', (s) => this.terrain.applySeason(s)),
      sim.bus.on('player:passout', () => this.passOut()),
      sim.bus.on('player:collapse', () => this.collapse()),
      sim.bus.on('player:xp', (amount) => this.floatText(`+${amount} XP`, 'xp')),
      // Things coming into (or going out of) your pockets float up beside you: +3 Wood, −10 Stone.
      sim.bus.on('inventory:delta', ({ id, qty }) => this.itemDelta(id, qty)),
      sim.bus.on('player:levelup', () => this.levelUpBurst()),
      sim.bus.on('player:succeeded', (info) => this.succession(info)),
      sim.bus.on('expedition:departed', (trip) => this.travel(trip)),
      sim.bus.on('expedition:returned', (report) => this.travelled(report)),
      sim.bus.on('journey:departed', (j) => this.journey(j)),
      sim.bus.on('journey:homeward', (j) => this.journeyHome(j)),
      sim.bus.on('journey:returned', (report) => this.travelled(report)),
    ];
    this.events.once('shutdown', () => this.cleanup());
    // A game saved on the road carries on from there.
    const j = sim.state.region?.journey;
    const onRoad = () => {
      this.busy = true;
      this.player.setHidden(true);
    };
    if (j?.stage === 'there') this.time.delayedCall(300, () => (onRoad(), this.ui.openPanel(new JourneyPanel(this.ui, { mode: 'market' }))));
    else if (j?.stage === 'back') this.time.delayedCall(300, () => (onRoad(), this.journeyHome(j)));
    else if (j) this.time.delayedCall(300, () => this.journey(j));
    else if (sim.state.exploration?.trip) this.time.delayedCall(300, () => this.travel(sim.state.exploration.trip));
  }

  update(time, rawDelta) {
    const delta = Math.min(rawDelta, 100);
    const blocked = this.ui.isBlocking() || this.busy;
    if (!this.ui.isPaused()) this.sim.update(delta);
    this.player.update(delta, blocked);
    this.npcViews.update(delta);
    this.animals.update(delta);
    this.carts.update(delta);
    this.fireViews.update();
    this.interaction.update(blocked);
    const darkness = this.atmosphere.update();
    this.lightTimer -= delta;
    if (this.lightTimer <= 0) {
      this.lightTimer = 200;
      this.buildings.update(darkness);
      // Fog of war: the map fills in as you walk the valley.
      if (!this.sim.state.player.away) {
        const TS = BALANCE.tileSize;
        if (this.sim.exploration.revealAround(Math.floor(this.player.x / TS), Math.floor(this.player.y / TS))) this.sim.progression.addSkillXp('exploration', 3);
      }
    }
    this.objective.update();
    this.constructionViews.update();
    this.buildMode.update();
    this.ui.update(delta);
  }

  /** Work an hour at your own workshop (the clock fast-forwards while you craft). */
  workAtBusiness(biz) {
    if (this.busy) return;
    const sim = this.sim;
    this.busy = true;
    this.player.cancelAction();
    this.player.facing = 'up';
    this.player.working = true;
    sim.time.fastForward(60, 2000, () => {
      sim.businesses.playerWork(biz);
      this.player.working = false;
      this.busy = false;
    });
  }

  /** Throw water on a burning building (a few seconds of hard work). */
  fightFire(buildingId) {
    const sim = this.sim;
    if (sim.state.player.energy < 4) {
      sim.toast('reason.too_tired', {}, 'warn');
      return;
    }
    const b = sim.world.buildings[buildingId];
    this.player.startAction({
      duration: 1600,
      target: { x: (b.tx + b.w / 2) * 32, y: (b.ty + b.h) * 32 },
      particles: 'snow',
      onComplete: () => {
        if (sim.disasters.playerFight(buildingId)) sim.toast('toast.fought_fire', { building: buildingId }, 'info');
      },
    });
  }

  /** Cast a line into the water in front of you. */
  performFishing(tx, ty) {
    const sim = this.sim;
    const check = sim.actions.checkFish();
    if (!check.ok) {
      sim.toast(`reason.${check.reason}`, check.params || {}, 'warn');
      return;
    }
    const c = sim.world.tileCenter(tx, ty);
    this.player.startAction({ duration: sim.actions.fishDuration(), target: { x: c.x, y: c.y }, onComplete: () => sim.actions.fish(tx, ty) });
  }

  /** Draw the bow on an animal. It may bolt before you loose the arrow. */
  performHunt(animal) {
    const sim = this.sim;
    const check = sim.actions.checkHunt();
    if (!check.ok) {
      sim.toast(`reason.${check.reason}`, check.params || {}, 'warn');
      return;
    }
    this.player.startAction({
      duration: BALANCE.actions.hunt.ms,
      target: { x: animal.x, y: animal.y },
      onComplete: () => {
        if (animal.state === 'dead') return;
        if (sim.actions.hunt(animal.kind)) this.animals.kill(animal);
        else this.animals.flee(animal, this.player.x, this.player.y);
      },
    });
  }

  /** Farming action on a tile (till / plant / water / harvest / clear) with a short animation. */
  performFarm(action, tx, ty, seed = null) {
    const sim = this.sim;
    const check = sim.farming.check(action, tx, ty, seed);
    if (!check.ok) {
      sim.toast(`reason.${check.reason}`, check.params || {}, 'warn');
      return;
    }
    const c = sim.world.tileCenter(tx, ty);
    this.player.startAction({
      duration: sim.farming.duration(action),
      target: { x: c.x, y: c.y + 10 },
      particles: action === 'till' ? 'chip' : action === 'water' ? 'snow' : null,
      onComplete: () => sim.farming.perform(action, tx, ty, seed),
    });
  }

  /** Work one hour on a construction site: the clock fast-forwards while you hammer away. */
  workOnSite(c) {
    const sim = this.sim;
    const check = sim.construction.canWork(c);
    if (!check.ok) {
      sim.toast(`reason.${check.reason}`, check.params || {}, 'warn');
      return;
    }
    this.busy = true;
    this.player.cancelAction();
    const cx = c.tx * TS + (c.w * TS) / 2;
    this.player.faceTowards(cx, (c.ty + c.h / 2) * TS);
    this.player.working = true;
    const fx = this.time.addEvent({ delay: 250, loop: true, callback: () => this.constructionViews.dust.explode(3, cx + (Math.random() - 0.5) * c.w * 20, (c.ty + c.h) * TS - 10) });
    sim.time.fastForward(60, 2200, () => {
      fx.remove();
      const added = sim.construction.playerWorked(c);
      this.player.working = false;
      this.busy = false;
      sim.toast('toast.worked_on_site', { hours: (added / 60).toFixed(1) }, 'info');
    });
  }

  // ---------------------------------------------------------------- actions

  performObjectAction(obj) {
    const check = this.sim.actions.check(obj);
    if (!check.ok) {
      this.sim.toast(`reason.${check.reason}`, check.params || {}, 'warn');
      return;
    }
    const kind = this.sim.actions.actionFor(obj);
    const c = this.sim.world.tileCenter(obj.tx, obj.ty);
    this.player.startAction({
      duration: this.sim.actions.duration(obj),
      target: { x: c.x, y: c.y },
      particles: kind === 'chop' ? 'chip' : kind === 'mine' ? 'dot' : null,
      onComplete: () => this.sim.actions.complete(obj),
    });
  }

  /** Sleep or nap. Time fast-forwards behind a fade. */
  sleep({ comfort, untilMorning }) {
    if (this.busy) return;
    const sim = this.sim;
    const p = sim.state.player;
    this.busy = true;
    this.player.cancelAction();
    const minutes = untilMorning ? sim.time.minutesUntilHour(BALANCE.needs.wakeHour) : BALANCE.needs.napHours * 60;
    p.comfort = comfort;
    this.cameras.main.fadeOut(500, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      p.sleeping = true;
      this.player.setHidden(true);
      this.ui.showStatus('sleep');
      sim.time.fastForward(minutes, Math.min(4500, 900 + minutes * 4), () => {
        p.sleeping = false;
        this.player.setHidden(false);
        this.busy = false;
        this.ui.hideStatus();
        this.cameras.main.fadeIn(800);
        if (untilMorning) {
          const ok = SaveSystem.save('auto', sim);
          sim.toast('toast.good_morning', {}, 'good');
          if (ok) sim.toast('toast.autosaved', {}, 'info');
        } else {
          sim.toast('toast.nap_done', {}, 'info');
        }
      });
    });
  }

  /** Work a shift job: the player goes inside and the clock fast-forwards. */
  workShift() {
    if (this.busy) return;
    const sim = this.sim;
    const job = sim.jobs.active;
    const check = sim.jobs.canStartShift(sim.jobs.jobBuilding(job)?.id);
    if (!check.ok) return;
    this.busy = true;
    this.player.cancelAction();
    const minutes = sim.jobs.startShift();
    this.player.setHidden(true);
    this.ui.showStatus('work', { job: job.jobId, minutes });
    sim.time.fastForward(minutes, BALANCE.jobs.shiftRealMs, () => {
      sim.jobs.finishShift();
      this.player.setHidden(false);
      this.busy = false;
      this.ui.hideStatus();
    });
  }

  /** Exploring a discovery site: some time passes, then you find out what's there. */
  exploreSite(id) {
    if (this.busy) return;
    const sim = this.sim;
    const s = sim.exploration.site(id);
    const chk = sim.exploration.canExploreSite(s);
    if (!chk.ok) return sim.toast(`reason.${chk.reason}`, chk.params || {}, 'warn');
    this.busy = true;
    this.player.cancelAction();
    this.player.setHidden(true);
    this.ui.showStatus('exploring', { site: s.kind });
    sim.time.fastForward(SITE_KINDS[s.kind].minutes, 1800, () => {
      const r = sim.exploration.exploreSite(id);
      this.player.setHidden(false);
      this.busy = false;
      this.ui.hideStatus();
      if (r.ok) this.ui.openPanel(new SitePanelDiscovery(this.ui, id, r));
    });
  }

  /** A shift at your own business: it runs at full strength today, and you learn the trade. */
  workOwnShift(bizId) {
    if (this.busy) return;
    const sim = this.sim;
    this.busy = true;
    this.player.cancelAction();
    this.player.setHidden(true);
    const building = sim.economy.biz(bizId).building;
    this.ui.showStatus('own_shift', { building });
    sim.time.fastForward(HOLDINGS.shiftHours * 60, BALANCE.jobs.shiftRealMs, () => {
      sim.holdings.workShift(bizId);
      this.player.setHidden(false);
      this.busy = false;
      this.ui.hideStatus();
    });
  }

  /**
   * Learning (or teaching) takes time: a class, a private lesson, a shift beside your master,
   * a lesson you give, an hour at the library, a week at a university (StudySystem).
   */
  study(kind, arg = null, extra = null) {
    if (this.busy) return;
    const sim = this.sim;
    const S = sim.study;
    const SP = STUDY_PLAYER;
    const plan = {
      class: [SP.classMinutes, () => S.finishClass(arg), 'study_class'],
      tutor: [SP.tutorMinutes, () => S.finishTutoring(arg), 'study_tutor'],
      beside: [SP.apprenticeMinutes, () => S.finishWorkBeside(), 'study_beside'],
      teach: [SP.teachMinutes, () => S.finishLesson(arg), 'study_teach'],
      read: [SP.readMinutes, () => S.finishReading(), 'study_read'],
      university: [7 * 1440, () => S.finishStudyWeek(arg, extra), 'study_university'],
    }[kind];
    if (!plan) return;
    const [minutes, finish, status] = plan;
    this.busy = true;
    this.player.cancelAction();
    this.player.setHidden(true);
    const params = kind === 'tutor' ? { npc: arg } : kind === 'university' ? { settlement: arg, field: extra } : kind === 'beside' ? { npc: sim.state.player.edu?.apprentice?.master } : arg ? { building: arg } : {};
    this.ui.showStatus(status, params);
    sim.time.fastForward(minutes, kind === 'university' ? 4000 : BALANCE.jobs.shiftRealMs, () => {
      const out = finish();
      this.player.setHidden(false);
      this.busy = false;
      this.ui.hideStatus();
      if (out) sim.toast(out.finished ? `toast.study_finished_${kind}` : `toast.study_done_${kind}`, { field: out.field || undefined, n: out.pupils ?? out.weeks ?? undefined }, out.finished ? 'good' : 'info');
      // Back to the town's market after a week at the university.
      if (kind === 'university' && sim.state.region.journey?.stage === 'there') this.ui.openPanel(new JourneyPanel(this.ui, { mode: 'market' }));
    });
  }

  /** You set out beyond the valley: the days pass (the village carries on without you). */
  travel(trip) {
    const sim = this.sim;
    this.busy = true;
    this.player.cancelAction();
    this.leaveInteriorNow();
    this.cameras.main.fadeOut(500, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.player.setHidden(true);
      this.ui.showStatus('travel', { region: trip.region });
      const minutes = trip.until - sim.time.total + 1;
      const days = minutes / 1440;
      sim.time.fastForward(minutes, Math.max(1500, days * EXPEDITION.travelRealMsPerDay), () => {});
    });
  }

  /** A trade journey: days on the road, then the market at the other end (time stands still while you trade). */
  journey(j) {
    const sim = this.sim;
    this.busy = true;
    this.player.cancelAction();
    this.leaveInteriorNow();
    this.cameras.main.fadeOut(500, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.player.setHidden(true);
      this.ui.showStatus('journey', { settlement: j.to });
      const minutes = j.arrive - sim.time.total + 1;
      sim.time.fastForward(minutes, Math.max(1500, (minutes / 1440) * EXPEDITION.travelRealMsPerDay), () => {
        this.ui.hideStatus();
        if (sim.state.region.journey?.stage === 'there') this.ui.openPanel(new JourneyPanel(this.ui, { mode: 'market' }));
      });
    });
  }

  journeyHome(j) {
    const sim = this.sim;
    this.ui.showStatus('journey', { settlement: j.to });
    const minutes = j.until - sim.time.total + 1;
    sim.time.fastForward(minutes, Math.max(1500, (minutes / 1440) * EXPEDITION.travelRealMsPerDay), () => {});
  }

  /** Home again: back at the waymark, and a report of what you found (and what you missed). */
  travelled(report) {
    const p = this.sim.state.player;
    this.player.sprite.setPosition(p.x, p.y);
    this.player.sprite.body.reset(p.x, p.y);
    this.player.setHidden(false);
    this.busy = false;
    this.ui.hideStatus();
    this.cameras.main.fadeIn(900);
    this.ui.openPanel(report.journey ? new JourneyPanel(this.ui, { mode: 'report', report }) : new ExpeditionPanel(this.ui, report));
  }

  /** You died or retired: the camera fades, and you wake as your heir. */
  succession(info) {
    this.leaveInteriorNow();
    this.player.refreshLook();
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.cameras.main.fadeIn(1200));
    this.ui.openPanel(new SuccessionPanel(this.ui, info));
  }

  passOut() {
    if (this.busy) return;
    const sim = this.sim;
    const p = sim.state.player;
    this.busy = true;
    this.player.cancelAction();
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      p.sleeping = true;
      p.comfort = BALANCE.player.outdoorComfort;
      this.ui.showStatus('passout');
      sim.time.fastForward(BALANCE.needs.passOutHours * 60, 2500, () => {
        p.sleeping = false;
        p.health = Math.max(1, p.health - 8);
        p.energy = Math.max(p.energy, 25);
        sim.needs.resolveEmergency();
        this.busy = false;
        this.ui.hideStatus();
        this.cameras.main.fadeIn(700);
        sim.toast('toast.passed_out', {}, 'danger');
      });
    });
  }

  /** Health hit zero: the healer takes the player home and patches them up — for a fee. */
  collapse() {
    if (this.busy) return;
    const sim = this.sim;
    const p = sim.state.player;
    this.busy = true;
    this.player.cancelAction();
    this.cameras.main.fadeOut(600, 60, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.leaveInteriorNow();
      const home = sim.world.buildings[p.homeId];
      const pos = sim.world.tileCenter(home.door.tx, home.door.ty + 1);
      this.player.teleport(pos.x, pos.y);
      this.player.setHidden(true);
      p.sleeping = true;
      p.comfort = BALANCE.player.shackComfort;
      this.ui.showStatus('collapse');
      sim.time.fastForward(BALANCE.needs.collapseHours * 60, 3000, () => {
        p.sleeping = false;
        p.health = 45;
        p.energy = Math.max(p.energy, 40);
        p.hunger = Math.max(p.hunger, 35);
        const fee = Math.min(Math.max(0, Math.floor(p.money)), BALANCE.needs.collapseFee);
        sim.ledger ? sim.ledger.as('health', () => (p.money -= fee)) : (p.money -= fee);
        sim.needs.resolveEmergency();
        this.player.setHidden(false);
        this.busy = false;
        this.ui.hideStatus();
        this.cameras.main.fadeIn(900);
        sim.toast('toast.collapsed', { money: fee }, 'danger');
      });
    });
  }

  // ---------------------------------------------------------------- home interior

  enterHome() {
    if (this.busy || this.inside) return;
    const sim = this.sim;
    const p = sim.state.player;
    this.busy = true;
    this.player.cancelAction();
    const cam = this.cameras.main;
    cam.fadeOut(250, 0, 0, 0);
    cam.once('camerafadeoutcomplete', () => {
      p.outsideX = this.player.x;
      p.outsideY = this.player.y;
      this.interior.build(sim.home.tierId);
      this.player.teleport(this.interior.spawn.x, this.interior.spawn.y);
      this.player.facing = 'up';
      this.inside = true;
      p.indoors = true;
      // Zoom in so the cozy room fills a good part of the screen.
      const b = this.interior.bounds;
      const zoom = Math.max(1, Math.min(2.2, cam.width / (b.w + 160), cam.height / (b.h + 160)));
      cam.setZoom(zoom);
      const bw = Math.max(b.w, cam.width / zoom);
      const bh = Math.max(b.h, cam.height / zoom);
      cam.setBounds(b.x + b.w / 2 - bw / 2, b.y + b.h / 2 - bh / 2, bw, bh);
      cam.setBackgroundColor('#120d09');
      this.atmosphere.setIndoor(true);
      this.busy = false;
      cam.fadeIn(300);
    });
  }

  exitHome() {
    if (this.busy || !this.inside) return;
    const sim = this.sim;
    const p = sim.state.player;
    this.busy = true;
    const cam = this.cameras.main;
    cam.fadeOut(250, 0, 0, 0);
    cam.once('camerafadeoutcomplete', () => {
      const home = sim.world.buildings[p.homeId];
      const pos = sim.world.tileCenter(home.door.tx, home.door.ty + 1);
      this.player.teleport(pos.x, pos.y);
      this.player.facing = 'down';
      this.inside = false;
      p.indoors = false;
      cam.setZoom(1);
      cam.setBounds(0, 0, this.worldSize.W, this.worldSize.H);
      cam.setBackgroundColor('#20301f');
      this.atmosphere.setIndoor(false);
      this.busy = false;
      cam.fadeIn(300);
    });
  }

  /** Leave the interior instantly (no fade) — used when something else takes over the camera. */
  leaveInteriorNow() {
    if (!this.inside) return;
    this.inside = false;
    this.sim.state.player.indoors = false;
    this.cameras.main.setZoom(1).setBounds(0, 0, this.worldSize.W, this.worldSize.H).setBackgroundColor('#20301f');
    this.atmosphere.setIndoor(false);
  }

  /** Craft a recipe `times` times in a row (each is a timed action with a progress bar). */
  craft(recipeId, times = 1) {
    const sim = this.sim;
    const check = sim.crafting.check(recipeId);
    if (!check.ok) {
      sim.toast(`reason.${check.reason}`, check.params || {}, 'warn');
      return;
    }
    this.player.startAction({
      duration: sim.crafting.duration(recipeId),
      target: { x: this.player.x, y: this.player.y - 30 },
      particles: 'chip',
      onComplete: () => {
        if (sim.crafting.complete(recipeId) !== false && times > 1) this.craft(recipeId, times - 1);
      },
    });
  }

  // ---------------------------------------------------------------- effects

  /** A short line floating up from the player ("+25 XP"). cls: xp · gain · loss · money. */
  floatText(text, cls = 'xp') {
    if (!this.player || !this.ui) return;
    this.ui.floatWorld(this.player.x, this.player.y - 60, text, cls.startsWith('#') ? 'xp' : cls);
  }

  /** Pockets changed: gather what came and went for a moment, then show it (+3 Wood). */
  itemDelta(id, qty) {
    if (!qty || this.inside === undefined) return;
    this.pendingItems ??= {};
    this.pendingItems[id] = (this.pendingItems[id] || 0) + qty;
    if (this.itemTimer) return;
    this.itemTimer = this.time.delayedCall(260, () => {
      this.itemTimer = null;
      const all = this.pendingItems;
      this.pendingItems = {};
      for (const [item, n] of Object.entries(all)) {
        if (!n) continue;
        const html = `${n > 0 ? '+' : '−'}${Math.abs(n)} ${icon(item, 18)}<span>${escapeHtml(itemName(item))}</span>`;
        this.ui.floatWorld(this.player.x, this.player.y - 44, html, n > 0 ? 'gain' : 'loss', true);
      }
    });
  }

  levelUpBurst() {
    const e = this.add.particles(this.player.x, this.player.y - 20, 'spark', {
      speed: { min: 60, max: 180 },
      lifespan: 900,
      scale: { start: 1.6, end: 0 },
      tint: [0xffd65a, 0xffffff, 0xffa53a],
      emitting: false,
    });
    e.setDepth(DEPTH.PROMPT);
    e.explode(40);
    this.time.delayedCall(1200, () => e.destroy());
  }

  // ---------------------------------------------------------------- lifecycle

  /** Replace the running game with another simulation (after loading a save). */
  loadSimulation(sim) {
    this.scene.restart({ sim });
  }

  quitToTitle() {
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Boot'));
  }

  cleanup() {
    this.unsubs?.forEach((u) => u());
    this.ui?.destroy();
    this.atmosphere?.destroy();
    this.objects?.destroy();
    this.npcViews?.destroy();
    this.buildings?.destroy();
    this.constructionViews?.destroy();
    this.fieldViews?.destroy();
    this.sim?.destroy();
  }
}
