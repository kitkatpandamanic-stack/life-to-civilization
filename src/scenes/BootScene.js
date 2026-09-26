/**
 * BootScene — generates all procedural textures once, then shows the title screen.
 */
import Phaser from 'phaser';
import { createAllTextures } from '../render/TextureFactory.js';
import { TitleScreen } from '../ui/TitleScreen.js';
import { music } from '../audio/Music.js';
import { onAudioReady } from '../audio/AudioEngine.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    if (!this.textures.exists('tiles')) createAllTextures(this);
    this.cameras.main.setBackgroundColor('#15201a');
    // The title tune (once the first click lets the page make sound).
    music.setMood('title');
    onAudioReady(() => music.start());
    this.title = new TitleScreen({
      onStart: (sim) => {
        this.title.destroy();
        this.scene.start('Game', { sim });
      },
    });
  }
}
