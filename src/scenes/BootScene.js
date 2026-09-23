/**
 * BootScene — generates all procedural textures once, then shows the title screen.
 */
import Phaser from 'phaser';
import { createAllTextures } from '../render/TextureFactory.js';
import { TitleScreen } from '../ui/TitleScreen.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    if (!this.textures.exists('tiles')) createAllTextures(this);
    this.cameras.main.setBackgroundColor('#15201a');
    this.title = new TitleScreen({
      onStart: (sim) => {
        this.title.destroy();
        this.scene.start('Game', { sim });
      },
    });
  }
}
