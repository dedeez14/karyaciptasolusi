// Builds the Font Awesome Pro icon sprite used by <Icon> from the licensed Pro kit on this machine.
//
// Font Awesome Pro may not be published in a public repository (Pro license), so nothing derived from it is committed:
// the sprite (public/icons/fa-*.svg) and its manifest (src/components/ui/fa.generated.json) are git-ignored and made
// here at dev / build time. Without the kit the app keeps working with its built-in (lucide) icons.
//
// Where the kit is found (first that exists):
//   FA_PRO_DIR  extracted "fontawesome-pro-<version>-web" folder
//   FA_PRO_ZIP  the "fontawesome-pro-<version>-web.zip" download
//   C:/DEV/assets/fontawesomepro-652/fontawesomepro-652/fontawesome-pro-6.5.2-web.zip
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP = join(WEB, 'src/components/ui/fa-map.json');
const MANIFEST = join(WEB, 'src/components/ui/fa.generated.json');
const OUT_DIR = join(WEB, 'public/icons');
const CACHE = join(WEB, 'node_modules/.cache/fa-pro');
const DEFAULT_ZIP = 'C:/DEV/assets/fontawesomepro-652/fontawesomepro-652/fontawesome-pro-6.5.2-web.zip';

/** folder that contains svgs/regular, svgs/solid, svgs/brands */
function kitDir() {
  const find = (root) => {
    if (!root || !existsSync(root)) return null;
    if (existsSync(join(root, 'svgs/regular'))) return root;
    for (const d of readdirSync(root, { withFileTypes: true })) if (d.isDirectory() && existsSync(join(root, d.name, 'svgs/regular'))) return join(root, d.name);
    return null;
  };
  const fromDir = find(process.env.FA_PRO_DIR);
  if (fromDir) return fromDir;
  const cached = find(CACHE);
  if (cached) return cached;
  const zip = [process.env.FA_PRO_ZIP, DEFAULT_ZIP].find((z) => z && existsSync(z));
  if (!zip) return null;
  mkdirSync(CACHE, { recursive: true });
  try {
    execFileSync('tar', ['-xf', zip, '-C', CACHE], { stdio: 'ignore' }); // Windows 10+ / bsdtar read zip files
  } catch {
    try {
      execFileSync('unzip', ['-q', '-o', zip, '-d', CACHE], { stdio: 'ignore' });
    } catch {
      return null;
    }
  }
  return find(CACHE);
}

/** viewBox and path data of one Font Awesome svg file */
function read(file) {
  const s = readFileSync(file, 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(s)?.[1];
  const paths = [...s.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  return viewBox && paths.length ? { viewBox, paths } : null;
}

export function buildIcons({ quiet = false } = {}) {
  const log = (m) => !quiet && console.log(`[fa-icons] ${m}`);
  const kit = kitDir();
  if (!kit) {
    writeFileSync(MANIFEST, JSON.stringify({ sprite: null, names: [] }) + '\n');
    log('Font Awesome Pro kit not found: using the built-in icons (set FA_PRO_DIR or FA_PRO_ZIP)');
    return;
  }
  const map = JSON.parse(readFileSync(MAP, 'utf8'));
  const symbols = [];
  const names = [];
  for (const [name, target] of Object.entries(map)) {
    const brand = target.startsWith('brands:');
    const fa = brand ? target.slice(7) : target;
    // regular for everyday use, solid for selected / emphasised states (brands have one style)
    for (const [prefix, style] of brand ? [['r', 'brands'], ['s', 'brands']] : [['r', 'regular'], ['s', 'solid']]) {
      const icon = read(join(kit, 'svgs', style, `${fa}.svg`));
      if (!icon) continue;
      symbols.push(`<symbol id="${prefix}-${name}" viewBox="${icon.viewBox}">${icon.paths.map((d) => `<path d="${d}"/>`).join('')}</symbol>`);
    }
    names.push(name);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none"><!-- Font Awesome Pro 6.5.2 by @fontawesome - https://fontawesome.com, commercial license --><defs>${symbols.join('')}</defs></svg>`;
  const hash = createHash('sha256').update(svg).digest('hex').slice(0, 10);
  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of readdirSync(OUT_DIR)) if (/^fa-[0-9a-f]+\.svg$/.test(f) && f !== `fa-${hash}.svg`) rmSync(join(OUT_DIR, f));
  writeFileSync(join(OUT_DIR, `fa-${hash}.svg`), svg);
  writeFileSync(MANIFEST, JSON.stringify({ sprite: `/icons/fa-${hash}.svg`, names }) + '\n');
  log(`${names.length} icons -> public/icons/fa-${hash}.svg (${Math.round(svg.length / 1024)} KB)`);
}

/** Vite plugin: (re)build the sprite when dev or build starts */
export function faIcons() {
  return {
    name: 'kcs-fa-icons',
    buildStart() {
      buildIcons();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildIcons();
