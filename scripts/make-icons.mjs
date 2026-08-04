// Generates every PWA icon size from one source image.
//
//   npm run icons
//
// The source is public/images/icon-source.png. Replace that file with better artwork and
// re-run -- nothing else needs editing, because the manifest references the generated
// filenames, not the source.
//
// Run on demand, never in the build or in CI: the outputs are committed, so a deploy does
// not need sharp installed. sharp arrives today as a transitive dependency of Next rather
// than a direct one, which is why the import is guarded with an explicit message instead of
// being allowed to fail as an opaque MODULE_NOT_FOUND.
import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';

const SOURCE = 'public/images/icon-source.png';
const OUT_DIR = 'public/icons';

// Icons need an opaque background: iOS composites a transparent PNG onto black, which turns
// a dark logo into a dark smudge on the home screen.
//
// White rather than the brand navy, because of what the artwork actually is. The logo's ring
// text ("CBS PEWOSA", "EYEETEREKERA") and the cupped hands are near-black navy, drawn for a
// light backdrop -- rendered on #253b8e they disappear into it and the icon reads as a gold
// blob. Checked by generating both and looking at them.
const BRAND_BG = '#ffffff';

// Android applies its own mask (circle, squircle, teardrop -- the launcher decides) to a
// maskable icon and can crop up to 20% off each edge. Keeping the artwork inside 60% of the
// canvas means no launcher shape can clip it.
const MASKABLE_SCALE = 0.6;

// A plain icon is displayed as-is, so it can use more of the canvas.
const STANDARD_SCALE = 0.72;

const TARGETS = [
  { file: 'icon-192.png', size: 192, scale: STANDARD_SCALE, purpose: 'any' },
  { file: 'icon-512.png', size: 512, scale: STANDARD_SCALE, purpose: 'any' },
  { file: 'icon-maskable-192.png', size: 192, scale: MASKABLE_SCALE, purpose: 'maskable' },
  { file: 'icon-maskable-512.png', size: 512, scale: MASKABLE_SCALE, purpose: 'maskable' },
  // iOS ignores the manifest and reads this one from a <link>. 180 is the size current
  // iPhones ask for.
  { file: 'apple-touch-icon.png', size: 180, scale: STANDARD_SCALE, purpose: 'apple' }
];

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error(
    '\nsharp is not available.\n\n' +
    'It is normally present as a transitive dependency of Next. If a Next upgrade has\n' +
    'dropped it, install it directly -- it is only needed to regenerate icons, never to\n' +
    'build or deploy:\n\n  npm install --save-dev sharp\n'
  );
  process.exit(1);
}

try {
  await access(SOURCE);
} catch {
  console.error(`\nNo source image at ${SOURCE}.\n\nDrop a square PNG there (512x512 or larger) and run this again.\n`);
  process.exit(1);
}

const meta = await sharp(SOURCE).metadata();
console.log(`Source: ${SOURCE} (${meta.width}x${meta.height})`);

// Upscaling is worth a warning rather than a failure -- a soft icon still installs, and
// holding up the whole PWA over artwork would be the wrong trade.
const largest = Math.max(...TARGETS.map((t) => Math.round(t.size * t.scale)));
if (Math.min(meta.width, meta.height) < largest) {
  console.warn(
    `Warning: the source is smaller than the largest rendered logo (${largest}px), so the\n` +
    `         bigger icons are upscaled and will look soft. Replace ${SOURCE} with\n` +
    `         higher-resolution artwork and re-run to fix.`
  );
}

await mkdir(OUT_DIR, { recursive: true });

for (const { file, size, scale, purpose } of TARGETS) {
  const logoSize = Math.round(size * scale);

  // fit: 'contain' preserves the source's aspect ratio -- the logo is 279x256, and squashing
  // it to a square would visibly distort it. The transparent padding it adds is flattened
  // onto the brand background by the composite below.
  const logo = await sharp(SOURCE)
    .resize(logoSize, logoSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'lanczos3'
    })
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BRAND_BG
    }
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(path.join(OUT_DIR, file));

  console.log(`  ${file.padEnd(26)} ${size}x${size}  logo ${logoSize}px  (${purpose})`);
}

console.log(`\n${TARGETS.length} icons written to ${OUT_DIR}/`);
