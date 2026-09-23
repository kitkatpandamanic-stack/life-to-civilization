/**
 * InteractionSystem — finds the nearest thing the player can interact with,
 * shows a floating "[E] Chop tree" prompt above it, and runs the action
 * (or opens a small context menu when there are several options).
 */
import { BALANCE } from '../config/balance.js';
import { getActions, targetName } from './Interactions.js';
import { DEPTH } from './depth.js';

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

    // Fixed interaction points: building doors and interactive decorations.
    this.static = [];
    for (const b of this.sim.world.buildingList) {
      this.static.push({ kind: 'building', id: b.id, x: b.door.tx * TS + TS / 2, y: b.door.ty * TS + 4, labelY: 44 });
    }
    for (const d of this.sim.world.decor) {
      if (d.interact) this.static.push({ kind: 'decor', type: d.interact, id: `${d.interact}_${d.tx}_${d.ty}`, x: d.tx * TS + TS / 2, y: d.ty * TS + TS + 6, labelY: 56 });
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
    const consider = (cand, x, y) => {
      const dx = x - px;
      const dy = y - py;
      const d = Math.hypot(dx, dy);
      if (d > R) return;
      const facingBonus = d > 0 ? ((dx * fx + dy * fy) / d) * 14 : 0;
      const score = d - facingBonus;
      if (score < bestScore) {
        bestScore = score;
        best = { ...cand, x, y };
      }
    };

    for (const npc of this.sim.state.npcs) {
      if (!npc.inside && npc.simLevel !== 'abstract') consider({ kind: 'npc', id: npc.id, labelY: npc.age < 14 ? 44 : 56 }, npc.x, npc.y - 8);
    }
    const tile = this.sim.world.toTile(player.x, player.y);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const obj = this.scene.objects.objectAt(tile.tx + dx, tile.ty + dy);
        if (!obj || !this.sim.resources.isHarvestable(obj)) continue;
        consider({ kind: 'object', id: obj.id, labelY: LABEL_OFFSET[obj.kind] || 36 }, obj.tx * TS + TS / 2, obj.ty * TS + TS - 6);
      }
    }
    for (const s of this.static) consider(s, s.x, s.y);
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
    let text;
    if (actions.length === 1) {
      const a = actions[0];
      text = a.disabled ? `${a.label}\n${a.reason}` : `E  ${a.label}`;
    } else {
      text = `E  ${targetName(this.scene, this.target)}  ▾`;
    }
    if (text !== this.promptText) {
      this.promptText = text;
      this.prompt.setText(text);
      this.prompt.setColor(actions.length === 1 && actions[0].disabled ? '#d9c9b0' : '#fff6e0');
    }
    const bob = Math.sin(this.scene.time.now / 200) * 2;
    const topY = this.target.y - this.target.labelY;
    this.marker.setVisible(true).setPosition(this.target.x, topY + bob);
    this.prompt.setVisible(true).setPosition(this.target.x, topY - 14);
  }

  hide() {
    this.target = null;
    this.prompt.setVisible(false);
    this.marker.setVisible(false);
  }

  /** Called when the player presses E. */
  interact() {
    const target = this.target;
    if (!target) return false;
    const actions = getActions(this.scene, target);
    if (!actions.length) return false;
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
