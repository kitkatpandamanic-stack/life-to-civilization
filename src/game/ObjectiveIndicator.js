/**
 * ObjectiveIndicator — shows where to go for the current job:
 * a bouncing marker above the target when it's on screen, or an arrow at
 * the screen edge pointing toward it when it's off screen.
 */
import { DEPTH } from './depth.js';

export class ObjectiveIndicator {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.marker = scene.add.image(0, 0, 'objective_marker').setOrigin(0.5, 1).setDepth(DEPTH.PROMPT).setVisible(false);
    this.arrow = scene.add.image(0, 0, 'arrow').setScrollFactor(0).setDepth(DEPTH.PROMPT).setVisible(false);
    this.cache = null;
    this.cacheAt = 0;
  }

  update() {
    const now = this.scene.time.now;
    // Finding the nearest resource is not free, so refresh the objective a few times per second.
    if (now - this.cacheAt > 300) {
      this.cache = this.sim.jobs.objective();
      this.cacheAt = now;
    }
    const target = this.cache?.target;
    if (!target || this.scene.inside) {
      this.marker.setVisible(false);
      this.arrow.setVisible(false);
      return;
    }
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    const onScreen = target.x > view.x + 20 && target.x < view.right - 20 && target.y > view.y + 40 && target.y < view.bottom - 20;
    const bob = Math.sin(now / 220) * 4;
    if (onScreen) {
      this.arrow.setVisible(false);
      this.marker.setVisible(true).setPosition(target.x, target.y - 34 + bob);
    } else {
      this.marker.setVisible(false);
      const cx = cam.width / 2;
      const cy = cam.height / 2;
      const angle = Math.atan2(target.y - (view.y + view.height / 2), target.x - (view.x + view.width / 2));
      const r = Math.min(cam.width, cam.height) / 2 - 50;
      const ex = Math.max(40, Math.min(cam.width - 40, cx + Math.cos(angle) * r * (cam.width / Math.min(cam.width, cam.height))));
      const ey = Math.max(90, Math.min(cam.height - 70, cy + Math.sin(angle) * r));
      this.arrow.setVisible(true).setPosition(ex, ey).setRotation(angle).setScale(1 + bob * 0.02);
    }
  }
}
