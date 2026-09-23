import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, open: false },
  build: {
    // Phaser itself is ~1.2 MB; that's expected for a game engine.
    chunkSizeWarningLimit: 2000,
  },
});
