/**
 * GameScene — the playable world.
 *
 * Builds the views (terrain, objects, buildings, characters, atmosphere),
 * runs the simulation every frame and handles the few flows that need the
 * camera: sleeping, working a shift, passing out and collapsing.
 */
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
import { UIManager } from '../ui/UIManager.js';

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
    this.physics.world.setBounds(0, 0, W, H);
    const cam = this.cameras.main;
    cam.setBounds(0, 0, W, H).setRoundPixels(true).setBackgroundColor('#20301f');

    this.solids = this.physics.add.staticGroup();
    this.terrain = new TerrainView(this, sim);
    this.objects = new WorldObjectViews(this, sim);
    this.buildings = new BuildingViews(this, sim);
    this.player = new PlayerController(this, sim);
    this.physics.add.collider(this.player.sprite, this.solids);
    this.physics.add.collider(this.player.sprite, this.terrain.layer);
    this.npcViews = new NPCViews(this, sim);
    this.atmosphere = new Atmosphere(this, sim, this.player);
    this.objective = new ObjectiveIndicator(this, sim);
    this.ui = new UIManager(this, sim);
    this.interaction = new InteractionSystem(this);

    cam.startFollow(this.player.sprite, true, 0.15, 0.15);
    cam.fadeIn(700);
    this.lightTimer = 0;
    this.floatY = 0;

    this.unsubs = [
      sim.bus.on('time:season', (s) => this.terrain.applySeason(s)),
      sim.bus.on('player:passout', () => this.passOut()),
      sim.bus.on('player:collapse', () => this.collapse()),
      sim.bus.on('player:xp', (amount) => this.floatText(`+${amount} XP`, '#ffe28a')),
      sim.bus.on('player:levelup', () => this.levelUpBurst()),
    ];
    this.events.once('shutdown', () => this.cleanup());
  }

  update(time, rawDelta) {
    const delta = Math.min(rawDelta, 100);
    const blocked = this.ui.isBlocking() || this.busy;
    if (!this.ui.isPaused()) this.sim.update(delta);
    this.player.update(delta, blocked);
    this.npcViews.update(delta);
    this.interaction.update(blocked);
    const darkness = this.atmosphere.update();
    this.lightTimer -= delta;
    if (this.lightTimer <= 0) {
      this.lightTimer = 200;
      this.buildings.update(darkness);
    }
    this.objective.update();
    this.ui.update(delta);
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
    const check = sim.jobs.canStartShift(sim.jobs.employerBuilding(job.jobId).id);
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

  /** Energy hit zero: the player passes out where they stand for a few hours. */
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
        p.money -= fee;
        sim.needs.resolveEmergency();
        this.player.setHidden(false);
        this.busy = false;
        this.ui.hideStatus();
        this.cameras.main.fadeIn(900);
        sim.toast('toast.collapsed', { money: fee }, 'danger');
      });
    });
  }

  // ---------------------------------------------------------------- effects

  floatText(text, color) {
    const now = this.time.now;
    if (now - this.floatY < 250) return; // avoid stacking many at once
    this.floatY = now;
    const t = this.add
      .text(this.player.x, this.player.y - 60, text, { fontFamily: 'Nunito, sans-serif', fontSize: '14px', fontStyle: 'bold', color, stroke: '#2a1a08', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(DEPTH.PROMPT);
    this.tweens.add({ targets: t, y: t.y - 36, alpha: 0, duration: 1300, ease: 'Cubic.out', onComplete: () => t.destroy() });
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
    this.sim?.destroy();
  }
}
