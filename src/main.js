/**
 * Entry point. Creates the Phaser game with two scenes:
 *   Boot — builds textures and shows the title screen
 *   Game — the playable world
 */
import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';
import { getLanguage } from './i18n/i18n.js';
import { applySettings } from './ui/settings.js';
import * as audio from './audio/AudioEngine.js';
import { music, MOODS } from './audio/Music.js';

const { unlock, play } = audio;

document.documentElement.lang = getLanguage();
applySettings(); // the interface size you chose
if (import.meta.env.DEV) {
  import('./debug/devTools.js');
  window.sound = { ...audio, music, MOODS }; // dev: sound.play('chop'), sound.music.setMood('festival')
}

// Sound can only start after a click or a key press (browsers' rule), so the first one switches it on.
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, unlock, { capture: true });
// A soft click for every button in the interface.
document.addEventListener(
  'click',
  (e) => {
    const b = e.target.closest?.('#ui button, #ui [data-action]');
    if (b && !b.disabled) play('click');
  },
  { capture: true },
);

function startGame() {
  const parent = document.getElementById('game');
  // Phaser's RESIZE mode measures the parent. If the page isn't laid out yet (0×0),
  // WebGL would create an empty framebuffer and crash — so wait a frame and retry.
  if (!parent.clientWidth || !parent.clientHeight) {
    requestAnimationFrame(startGame);
    return;
  }
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#15201a',
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: parent.clientWidth,
      height: parent.clientHeight,
      // Never let the renderer shrink to 0×0 (e.g. while a window is collapsed):
      // zero-sized WebGL framebuffers throw and would stop the game loop.
      min: { width: 320, height: 240 },
    },
    render: { antialias: true, roundPixels: true },
    physics: { default: 'arcade', arcade: { debug: false } },
    scene: [BootScene, GameScene],
  });
  // Handy for debugging from the browser console: game.scene.getScene('Game').sim
  window.game = game;
}

// Wait for the UI font so in-world text (name tags, prompts) renders with it.
const fontsReady = document.fonts?.ready ?? Promise.resolve();
Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]).then(startGame);
