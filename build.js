// Bundles the renderer (src/) into dist/bundle.js with esbuild and copies fonts.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

esbuild.buildSync({
  entryPoints: ['src/main.js'],
  bundle: true,
  outfile: 'dist/bundle.js',
  format: 'iife',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'warning',
});

// The simulation is also bundled as an ES module so the headless test can run it in Node.
esbuild.buildSync({
  entryPoints: ['src/game/sim.js'],
  bundle: true,
  outfile: 'dist/sim.mjs',
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
});

// Rounded fonts (Fredoka for headings, Nunito for body text), bundled locally.
const fontDir = path.join('dist', 'fonts');
fs.mkdirSync(fontDir, { recursive: true });
const fonts = [
  ['fredoka', [500, 600, 700]],
  ['nunito', [400, 600, 700, 800]],
];
for (const [family, weights] of fonts) {
  for (const w of weights) {
    const file = `${family}-latin-${w}-normal.woff2`;
    fs.copyFileSync(path.join('node_modules', '@fontsource', family, 'files', file), path.join(fontDir, file));
  }
}

console.log('build ok');
