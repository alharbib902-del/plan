// scripts/generate-pwa-icons.mjs
//
// Phase 4.2 — regenerates the PWA icon set from a single SVG source.
// Uses sharp (already in dependencies — no new packages).
// PNG output only; no .ico (sharp doesn't emit multi-resolution ICO,
// and modern browsers accept PNG favicons via <link rel="icon">).
//
// Run: npm run generate:icons
//
// Output (under aeris/public/icons/):
//   icon-192.png            — standard PWA install (Android, desktop)
//   icon-512.png            — high-res install + splash
//   icon-maskable-192.png   — Android adaptive (60% safe-area content)
//   icon-maskable-512.png   — Android adaptive high-res
//   apple-touch-icon.png    — iOS home screen (180×180)
//   favicon-32.png          — browser tab
//   favicon-16.png          — browser tab small

import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const NAVY = { r: 10, g: 22, b: 40, alpha: 1 }; // #0A1628 (must match manifest.background_color)

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');
const SOURCE = join(ROOT, 'public', 'icons', 'icon-source.svg');
const OUT_DIR = join(ROOT, 'public', 'icons');

// Maskable safe area: 40% of canvas radius is the "safe zone" per the
// W3C maskable icon spec. We render the source SVG into 60% of the
// target canvas (i.e., 20% padding on each side) and composite it onto
// a navy background, so adaptive launchers can crop to circle/square
// without losing the wordmark.
const MASKABLE_INNER_SCALE = 0.6;

async function renderAny(svgBuffer, size, outputPath) {
  // Standard "any" purpose: full-bleed render of the SVG (which already
  // has navy background + gold wordmark filling the canvas).
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(outputPath);
}

async function renderMaskable(svgBuffer, size, outputPath) {
  // Maskable: shrink the source to the safe-area, then composite onto
  // a fully-opaque navy canvas at the target size. The result has no
  // transparency so adaptive launchers can mask it to any shape.
  const innerSize = Math.round(size * MASKABLE_INNER_SCALE);
  const innerPng = await sharp(svgBuffer)
    .resize(innerSize, innerSize)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: NAVY,
    },
  })
    .composite([{ input: innerPng, gravity: 'center' }])
    .png()
    .toFile(outputPath);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const svgBuffer = await readFile(SOURCE);

  const outputs = [
    ['icon-192.png',           () => renderAny(svgBuffer, 192, join(OUT_DIR, 'icon-192.png'))],
    ['icon-512.png',           () => renderAny(svgBuffer, 512, join(OUT_DIR, 'icon-512.png'))],
    ['icon-maskable-192.png',  () => renderMaskable(svgBuffer, 192, join(OUT_DIR, 'icon-maskable-192.png'))],
    ['icon-maskable-512.png',  () => renderMaskable(svgBuffer, 512, join(OUT_DIR, 'icon-maskable-512.png'))],
    ['apple-touch-icon.png',   () => renderAny(svgBuffer, 180, join(OUT_DIR, 'apple-touch-icon.png'))],
    ['favicon-32.png',         () => renderAny(svgBuffer, 32,  join(OUT_DIR, 'favicon-32.png'))],
    ['favicon-16.png',         () => renderAny(svgBuffer, 16,  join(OUT_DIR, 'favicon-16.png'))],
  ];

  for (const [name, fn] of outputs) {
    await fn();
    console.log(`  ✓ ${name}`);
  }

  console.log(`\nGenerated ${outputs.length} PWA icons in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
