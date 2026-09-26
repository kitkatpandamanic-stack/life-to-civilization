/**
 * NPCViews — draws villagers from the simulation state.
 *
 * The NPCSystem moves villagers in state (npc.x / npc.y); this class just
 * mirrors that onto sprites. Villagers inside buildings are hidden, far-away
 * ("abstract" simulation level) villagers skip animation work entirely.
 */
import { npcName } from '../i18n/i18n.js';
import { BALANCE } from '../config/balance.js';
import { ensureCharacter, idleFrame, CHAR_ORIGIN_Y } from './characters.js';
import { DEPTH } from './depth.js';
import { workerIndicator } from '../ui/workerCard.js';

const WORK_FX = { chop: 'chip', mine: 'dot', spot: 'spark', build: 'chip' };

export class NPCViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.views = new Map();
    for (const npc of sim.state.npcs) this.create(npc);
    // The villager you picked (their card is open) or are following: a ring at their feet.
    this.selected = null;
    this.ring = scene.add.ellipse(0, 0, 30, 12).setStrokeStyle(2, 0xffcf5a, 0.95).setFillStyle(0xffcf5a, 0.18).setVisible(false);
    this.fx = {};
    for (const tex of new Set(Object.values(WORK_FX))) {
      this.fx[tex] = scene.add
        .particles(0, 0, tex, { speed: { min: 30, max: 90 }, angle: { min: 200, max: 340 }, gravityY: 240, lifespan: 500, scale: { start: 0.8, end: 0.3 }, emitting: false })
        .setDepth(DEPTH.WORLD_UI - 1);
    }
    this.unsubs = [
      sim.bus.on('npc:chat', ({ a, b }) => this.showBubble(a, b)),
      sim.bus.on('npc:argue', ({ a, b }) => this.showAngry(a, b)),
      // Villagers are born, arrive and pass away while you play.
      sim.bus.on('npc:added', (id) => {
        const npc = sim.npcs.byId(id);
        if (npc && !this.views.has(id)) this.create(npc);
      }),
      sim.bus.on('npc:removed', (id) => this.destroyView(id)),
    ];
  }

  create(npc) {
    // Seed in the key: a different save = different villagers' looks.
    const tex = ensureCharacter(this.scene, `npc_${this.sim.state.seed}_${npc.id}`, npc.look);
    const sprite = this.scene.add.sprite(npc.x, npc.y, tex, idleFrame(npc.facing)).setOrigin(0.5, CHAR_ORIGIN_Y);
    sprite.setScale(this.scaleFor(npc));
    const tag = this.scene.add
      .text(0, 0, '', { fontFamily: 'Nunito, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#fff8e8', stroke: '#2a1d14', strokeThickness: 3 })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.WORLD_UI)
      .setVisible(false);
    const bubble = this.scene.add.image(0, 0, 'bubble').setOrigin(0.5, 1).setDepth(DEPTH.WORLD_UI).setVisible(false);
    // Thought icon: hungry, tired, sick, job hunting, unpaid, carrying goods...
    const thought = this.scene.add.text(0, 0, '', { fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif', fontSize: '15px' }).setOrigin(0.5, 1).setDepth(DEPTH.WORLD_UI).setVisible(false);
    this.views.set(npc.id, { npc, tex, sprite, tag, bubble, thought, thoughtText: '', bubbleUntil: 0, fxTimer: 0, anim: '' });
  }

  /** Pick a villager (their card is open): the ring goes round them. */
  select(id) {
    this.selected = id;
  }

  /** A villager's sprite while they're out in the world (null indoors / away) — for the camera to follow. */
  spriteOf(id) {
    const v = this.views.get(id);
    return v && v.sprite.visible ? v.sprite : null;
  }

  destroyView(id) {
    const v = this.views.get(id);
    if (!v) return;
    for (const o of [v.sprite, v.tag, v.bubble, v.thought, v.badge]) o?.destroy();
    this.views.delete(id);
  }

  /** An argument: an angry mark over both heads for a moment. */
  showAngry(...ids) {
    const until = this.scene.time.now + 2500;
    for (const id of ids) {
      const v = this.views.get(id);
      if (v) v.angryUntil = until;
    }
  }

  showBubble(...ids) {
    const until = this.scene.time.now + 2200;
    for (const id of ids) {
      const v = this.views.get(id);
      if (v) v.bubbleUntil = until;
    }
  }

  /** Children are smaller; the youngest smaller still. */
  scaleFor(npc) {
    if (npc.age < 5) return 0.55;
    if (npc.age < 10) return 0.7;
    if (npc.age < 14) return 0.78;
    if (npc.age < 16) return 0.88;
    return 1;
  }

  isWorking(npc) {
    const t = npc.task;
    if (t?.type === 'firefight' && t.stage === 'fighting') return 'build';
    // Evenings spent raising a house.
    if (t?.type === 'leisure' && t.plan === 'build' && t.stage === 'idle' && !npc.moving) return 'build';
    if (!t || t.type !== 'work' || npc.moving) return null;
    if (npc.employer === 'player') {
      // Your workers: chopping, mining, building, crafting, farming.
      if (t.stage === 'doing') return this.sim.workers.contract(npc.id)?.assignment.type === 'gather_stone' ? 'mine' : 'chop';
      if (t.stage === 'building' || t.stage === 'crafting') return 'build';
      if (t.stage === 'farming') return 'farm';
      // Loading and unloading a barrow or an armful: busy hands.
      if (t.stage === 'loading' || t.stage === 'unloading') return 'load';
      if (t.stage === 'working') {
        const k = this.sim.workers.contract(npc.id)?.task?.kind;
        if (k === 'gather_wood') return 'chop';
        if (k === 'gather_stone') return 'mine';
        if (k === 'farm' || k === 'charvest' || k === 'cwater' || k === 'gather_berries') return 'farm';
        if (k === 'build' || k === 'repair' || k === 'crepair') return 'build';
        return 'load';
      }
      return null;
    }
    const act = this.sim.npcs.activityOf(npc);
    if (act === 'build') return t.stage === 'doing' ? 'build' : null;
    if (act === 'chop' || act === 'mine') return t.stage === 'doing' ? act : null;
    if (act === 'farm') return t.stage === 'doing' ? 'farm' : null;
    if (act === 'spot' && npc.occupation === 'blacksmith') return t.stage === 'working' ? 'spot' : null;
    return null;
  }

  update(delta) {
    const p = this.sim.state.player;
    const now = this.scene.time.now;
    const followed = this.scene.camDir?.following() || null;
    // The picked villager stays picked while their card is open (or while you follow them).
    if (this.selected && !this.scene.ui?.menu && this.selected !== followed) this.selected = null;
    const ringOn = this.selected || followed;
    let ringShown = false;
    for (const v of this.views.values()) {
      const npc = v.npc;
      const visible = !npc.inside && npc.simLevel !== 'abstract';
      v.sprite.setVisible(visible);
      if (!visible) {
        v.tag.setVisible(false);
        v.bubble.setVisible(false);
        v.thought.setVisible(false);
        v.badge?.setVisible(false);
        continue;
      }
      if (npc.id === ringOn) {
        this.ring.setPosition(npc.x, npc.y + 1).setDepth(npc.y - 1).setVisible(true);
        this.ring.setScale(1 + Math.sin(now / 250) * 0.06);
        ringShown = true;
      }
      v.sprite.setPosition(npc.x, npc.y).setDepth(npc.y);

      // Animation
      const working = this.isWorking(npc);
      let anim = '';
      if (npc.moving) anim = `${v.tex}_walk_${npc.facing}`;
      else if (working && working !== 'farm') anim = `${v.tex}_work_${npc.facing}`;
      else if (working === 'farm') anim = `${v.tex}_work_down`;
      if (anim) {
        if (v.anim !== anim) v.sprite.anims.play(anim, true);
      } else if (v.anim) {
        v.sprite.anims.stop();
        v.sprite.setFrame(idleFrame(npc.facing));
      } else {
        v.sprite.setFrame(idleFrame(npc.facing));
      }
      v.anim = anim;

      // Work particles (wood chips, stone dust, sparks)
      if (working && WORK_FX[working]) {
        v.fxTimer -= delta;
        if (v.fxTimer <= 0) {
          v.fxTimer = 600;
          this.fx[WORK_FX[working]].explode(3, npc.x + (npc.facing === 'left' ? -14 : npc.facing === 'right' ? 14 : 0), npc.y - 20);
          this.scene.sfx?.work(working, npc); // and you hear it, if you're near
        }
      }

      // Name tag when the player is close (or it's who you picked / follow)
      // (info mode: your workers' names too)
      const near = Math.hypot(npc.x - p.x, npc.y - p.y) < 120 || npc.talkingToPlayer || npc.id === ringOn || (this.scene.overlay?.info && !!this.sim.workers.contract(npc.id));
      v.tag.setVisible(near);
      if (near) {
        v.tag.setText(npcName(npc));
        v.tag.setPosition(npc.x, npc.y - (npc.age < 14 ? 38 : 48));
      }
      const bubble = now < v.bubbleUntil;
      v.bubble.setVisible(bubble);
      if (bubble) v.bubble.setPosition(npc.x + 10, npc.y - (npc.age < 14 ? 40 : 50) - (near ? 12 : 0));

      const dist = Math.hypot(npc.x - p.x, npc.y - p.y);
      const angry = now < (v.angryUntil || 0);
      const icon = angry ? '💢' : !bubble && dist < BALANCE.npc.thoughtRadius ? this.sim.npcs.thought(npc) : null;
      // Children grow up in front of you.
      const scale = this.scaleFor(npc);
      if (v.sprite.scaleX !== scale) v.sprite.setScale(scale);
      if (icon !== v.thoughtText) {
        v.thoughtText = icon;
        v.thought.setText(icon || '');
      }
      v.thought.setVisible(!!icon);
      if (icon) v.thought.setPosition(npc.x + (near ? 22 : 0), npc.y - (npc.age < 14 ? 38 : 48) + Math.sin(now / 300) * 2);

      // Your workers: what they're at, as one small icon — only near you, or for the one you picked / follow.
      const wIcon = dist < BALANCE.npc.thoughtRadius * 2.2 || npc.id === ringOn || this.scene.overlay?.info ? workerIndicator(this.sim, npc) : null;
      if (wIcon && !v.badge) v.badge = this.scene.add.text(0, 0, '', { fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif', fontSize: '12px', backgroundColor: 'rgba(20,14,9,0.72)', padding: { x: 3, y: 1 } }).setOrigin(0.5, 1).setDepth(DEPTH.WORLD_UI);
      if (v.badge) {
        if (wIcon !== v.badgeText) {
          v.badgeText = wIcon;
          v.badge.setText(wIcon || '');
        }
        v.badge.setVisible(!!wIcon);
        if (wIcon) v.badge.setPosition(npc.x - (icon ? 16 : 0), npc.y - (npc.age < 14 ? 38 : 48) - (near ? 16 : 0));
      }
    }
    if (!ringShown) this.ring.setVisible(false);
  }

  destroy() {
    this.unsubs.forEach((u) => u());
  }
}
