/**
 * InteractionSystem — finds the nearest thing the player can interact with,
 * shows a floating "[E] Chop tree" prompt above it, and runs the action
 * (or opens a small context menu when there are several options).
 */
import { BALANCE } from '../config/balance.js';
import { getActions, targetName, targetSubtitle } from './Interactions.js';
import { DEPTH } from './depth.js';
import { escapeHtml } from '../ui/format.js';

/** The tool each kind of work takes (the hotbar hints at it). */
const TOOL_FOR = { chop: 'axe', mine: 'pickaxe', till: 'hoe', water: 'watering_can', fish: 'fishing_rod', hunt: 'bow', build: 'hammer' };

const TS = BALANCE.tileSize;
const FACING = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
const LABEL_OFFSET = { tree: 84, rock: 36, bush: 30, crop: 40 };

export class InteractionSystem {
  constructor(scene) {
    this.scene = scene;
    this.sim = scene.sim;
    this.target = null;
    this.promptText = '';
    this.prompt = scene.add
      .text(0, 0, '', {
        fontFamily: 'Nunito, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#fff6e0',
        backgroundColor: 'rgba(24,16,10,0.82)',
        padding: { x: 8, y: 4 },
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.PROMPT)
      .setVisible(false);
    this.marker = scene.add.image(0, 0, 'marker').setOrigin(0.5, 1).setDepth(DEPTH.PROMPT).setVisible(false);

    // Fixed interaction points: interactive decorations (well, notice board, land signs).
    // Buildings and construction sites are read live because they appear during play.
    this.static = [];
    for (const d of this.sim.world.decor) {
      if (d.interact) this.static.push({ kind: 'decor', type: d.interact, plotId: d.plotId, id: `${d.interact}_${d.tx}_${d.ty}`, x: d.tx * TS + TS / 2, y: d.ty * TS + TS + 6, labelY: 56 });
    }
  }

  findTarget() {
    const player = this.scene.player;
    const px = player.x;
    const py = player.y - 6;
    const R = BALANCE.player.interactRadius;
    const [fx, fy] = FACING[player.facing] || [0, 1];
    let best = null;
    let bestScore = Infinity;
    // bias < 0 makes a candidate more likely to be chosen (villagers beat nearby crops).
    const consider = (cand, x, y, bias = 0, range = R) => {
      const dx = x - px;
      const dy = y - py;
      const d = Math.hypot(dx, dy);
      if (d > range) return;
      const facingBonus = d > 0 ? ((dx * fx + dy * fy) / d) * 14 : 0;
      const score = d - facingBonus + bias;
      if (score < bestScore) {
        bestScore = score;
        best = { ...cand, x, y };
      }
    };

    // Inside your home, only the furniture and the door are interactive.
    if (this.scene.inside) {
      for (const f of this.scene.interior.interactables) consider(f, f.x, f.y);
      return best;
    }
    for (const npc of this.sim.state.npcs) {
      if (!npc.inside && npc.simLevel === 'full') consider({ kind: 'npc', id: npc.id, labelY: npc.age < 14 ? 44 : 56 }, npc.x, npc.y - 8, -16);
    }
    const tile = this.sim.world.toTile(player.x, player.y);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const obj = this.scene.objects.objectAt(tile.tx + dx, tile.ty + dy);
        if (!obj || !this.sim.resources.isHarvestable(obj)) continue;
        // Things you can't use right now (e.g. the farm's crops) are less important.
        const bias = this.sim.actions.check(obj).ok ? 0 : 14;
        consider({ kind: 'object', id: obj.id, labelY: LABEL_OFFSET[obj.kind] || 36 }, obj.tx * TS + TS / 2, obj.ty * TS + TS - 6, bias);
      }
    }
    for (const s of this.static) consider(s, s.x, s.y);
    // Discovery sites out in the valley.
    for (const s of this.sim.state.exploration.sites) {
      if (Math.abs(s.tx - tile.tx) > 4 || Math.abs(s.ty - tile.ty) > 4) continue;
      consider({ kind: 'discovery', id: s.id, labelY: 52 }, (s.tx + 1) * TS, (s.ty + 1) * TS + 4);
    }
    // The ground right in front of you: your fields, or water to fill a watering can.
    const ft = { tx: tile.tx + fx, ty: tile.ty + fy };
    const onLand = this.sim.land.ownsTile(ft.tx, ft.ty);
    if (onLand && (this.sim.farming.field(ft.tx, ft.ty) || this.sim.progression.hasUnlock('farming'))) {
      if (!this.sim.world.isBlocked(ft.tx, ft.ty) || this.sim.farming.field(ft.tx, ft.ty)) {
        consider({ kind: 'ground', tx: ft.tx, ty: ft.ty, labelY: 30 }, ft.tx * TS + TS / 2, ft.ty * TS + TS / 2, 20);
      }
    } else if (this.sim.world.isWater(ft.tx, ft.ty) && (this.sim.farming.canNeedsRefill() || this.sim.inventory.bestTool('fishing_rod'))) {
      consider({ kind: 'water', tx: ft.tx, ty: ft.ty, labelY: 26 }, ft.tx * TS + TS / 2, ft.ty * TS + TS / 2, 10);
    }
    // Game within bow range (only if you carry a bow — otherwise they're just scenery).
    if (this.sim.inventory.bestTool('bow') && this.scene.animals) {
      for (const a of this.scene.animals.near(player.x, player.y, 190)) {
        // Aim by facing: game roughly in front of you takes priority over the tree at your elbow.
        const dx = a.x - px;
        const dy = a.y - 6 - py;
        const aim = (dx * fx + dy * fy) / (Math.hypot(dx, dy) || 1);
        consider({ kind: 'animal', animal: a, id: `animal_${a.id}`, labelY: a.kind === 'deer' ? 34 : 18 }, a.x, a.y - 6, aim > 0.8 ? -140 : 40, 190);
      }
    }
    for (const b of this.sim.world.buildingList) {
      consider({ kind: 'building', id: b.id, labelY: b.w === 1 ? 56 : 44 }, b.door.tx * TS + TS / 2, b.door.ty * TS + 4);
    }
    // Barrows, carts and baskets left on the ground (EquipmentSystem).
    for (const eq of this.sim.equipment?.parkedNear(tile.tx, tile.ty, 2) || []) consider({ kind: 'equipment', id: eq.id, labelY: 40 }, eq.at.tx * TS + TS / 2, eq.at.ty * TS + TS - 4, -4);
    // Pushing one yourself: with nothing else in front of you, you can put it down here.
    if (this.sim.equipment?.playerHeld()) consider({ kind: 'held', id: 'held', labelY: 58 }, px, py + 2, 60, R + 60);
    for (const c of this.sim.construction.sites()) {
      if (c.kind !== 'building' && c.kind !== 'repair') continue;
      consider({ kind: 'site', id: c.id, labelY: c.h * TS + 36 }, (c.tx + c.w / 2) * TS, (c.ty + c.h) * TS + 6);
    }
    return best;
  }

  update(blocked) {
    const player = this.scene.player;
    if (blocked || player.hidden || player.isBusy()) {
      this.hide();
      return;
    }
    this.target = this.findTarget();
    if (!this.target) {
      this.hide();
      return;
    }
    const actions = getActions(this.scene, this.target);
    if (!actions.length) {
      this.hide();
      return;
    }
    const name = targetName(this.scene, this.target);
    const sub = targetSubtitle(this.scene, this.target);
    // The prompt: the thing's name, a line about it, and what the keys do.
    let acts;
    if (actions.every((a) => a.key)) acts = actions.map((a) => `<span class="${a.disabled ? 'off' : ''}"><kbd>${a.key}</kbd>${escapeHtml(a.label)}</span>`).join('');
    else if (actions.length === 1) {
      const a = actions[0];
      acts = a.disabled ? `<span class="off">${escapeHtml(a.label)}</span><span class="why">${escapeHtml(a.reason)}</span>` : `<span><kbd>E</kbd>${escapeHtml(a.label)}</span>`;
    } else acts = `<span><kbd>E</kbd>${escapeHtml(this.scene.ui.tr('ui.n_actions', { n: actions.length }))} ▾</span>`;
    const html = `<div class="wp-name">${escapeHtml(name)}</div>${sub ? `<div class="wp-sub">${escapeHtml(sub)}</div>` : ''}<div class="wp-actions">${acts}</div>`;
    const el = this.scene.ui.promptEl;
    if (html !== this.promptText) {
      this.promptText = html;
      el.innerHTML = html;
    }
    el.classList.remove('hidden');
    this.scene.ui.setWantedTool(this.toolFor(this.target));
    this.scene.buildings?.highlight(this.target.kind === 'building' ? this.target.id : null);
    const bob = Math.sin(this.scene.time.now / 200) * 2;
    const topY = this.target.y - this.target.labelY;
    this.marker.setVisible(true).setPosition(this.target.x, topY + bob);
    const p = this.scene.ui.worldToScreen(this.target.x, topY - 10);
    el.style.left = `${Math.round(p.x)}px`;
    el.style.top = `${Math.round(p.y)}px`;
  }

  /** The tool the thing in front of you takes, if any. */
  toolFor(target) {
    const sim = this.sim;
    if (target.kind === 'object') return TOOL_FOR[sim.actions.actionFor(sim.state.objects[target.id])] || null;
    if (target.kind === 'ground') return TOOL_FOR[sim.farming.actionFor(target.tx, target.ty)] || null;
    if (target.kind === 'water') return 'fishing_rod';
    if (target.kind === 'animal') return 'bow';
    if (target.kind === 'site' || (target.kind === 'building' && sim.structures?.works(target.id))) return 'hammer';
    return null;
  }

  hide() {
    this.target = null;
    this.prompt.setVisible(false);
    this.marker.setVisible(false);
    this.scene.ui?.promptEl?.classList.add('hidden');
    this.scene.ui?.setWantedTool?.(null);
    this.scene.buildings?.highlight(null);
  }

  /** Called when the player presses E (key = 'E') or F (key = 'F'). */
  interact(key = 'E') {
    const target = this.target;
    if (!target) return false;
    const actions = getActions(this.scene, target);
    if (!actions.length) return false;
    const keyed = actions.find((a) => a.key === key);
    if (keyed) {
      if (keyed.disabled) this.scene.ui.toastText(keyed.reason, 'warn');
      else keyed.run();
      return true;
    }
    if (key !== 'E') return false;
    if (actions.length === 1) {
      const a = actions[0];
      if (a.disabled) this.scene.ui.toastText(a.reason, 'warn');
      else a.run();
      return true;
    }
    const cam = this.scene.cameras.main;
    const sx = (target.x - cam.worldView.x) * cam.zoom;
    const sy = (target.y - target.labelY - cam.worldView.y) * cam.zoom;
    this.scene.ui.openContextMenu({ title: targetName(this.scene, target), actions, x: sx, y: sy });
    return true;
  }
}
