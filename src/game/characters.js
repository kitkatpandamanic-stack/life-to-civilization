/**
 * Creates a character texture + walk/work animations from a "look" description.
 */
import { drawCharacterSheet, CHAR_W, CHAR_H, CHAR_COLS, DIRS } from '../render/CharacterArt.js';

export const CHAR_ORIGIN_Y = 45 / CHAR_H; // feet position in the frame

export function ensureCharacter(scene, key, look) {
  const tex = `char_${key}`;
  if (!scene.textures.exists(tex)) {
    const t = scene.textures.addCanvas(tex, drawCharacterSheet(look));
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < CHAR_COLS; c++) t.add(r * CHAR_COLS + c, 0, c * CHAR_W, r * CHAR_H, CHAR_W, CHAR_H);
    }
  }
  DIRS.forEach((dir, r) => {
    const walk = `${tex}_walk_${dir}`;
    if (!scene.anims.exists(walk)) {
      // a four-step stride: step, passing (body up), step, passing
      scene.anims.create({ key: walk, frames: [1, 2, 3, 4].map((c) => ({ key: tex, frame: r * CHAR_COLS + c })), frameRate: 9, repeat: -1 });
    }
    const work = `${tex}_work_${dir}`;
    if (!scene.anims.exists(work)) {
      // raise the tool, bring it down
      scene.anims.create({ key: work, frames: [5, 6].map((c) => ({ key: tex, frame: r * CHAR_COLS + c })), frameRate: 3.5, repeat: -1 });
    }
  });
  return tex;
}

export function idleFrame(dir) {
  return Math.max(0, DIRS.indexOf(dir)) * CHAR_COLS;
}
