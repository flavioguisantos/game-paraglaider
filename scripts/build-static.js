import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');

const requiredPaths = [
  'index.html',
  'src',
  'image/nova-vortex.obj',
  'assets',
  'mapas/processed/BRA_SUDESTE_HighRes/manifest.json',
  'mapas/processed/BRA_SUDESTE_HighRes/terrain-rgb',
  'mapas/processed/BRA_SUDESTE_HighRes/vectors',
  'node_modules/fflate/esm/browser.js',
  'node_modules/three/build',
  'node_modules/three/examples/jsm'
];

for (const relativePath of requiredPaths) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Arquivo obrigatorio ausente para build estatico: ${relativePath}`);
  }
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

copyFile('index.html', 'index.html');
copyDirectory('src', 'src');
copyDirectory('image', 'image');
copyDirectory('assets', 'assets');
copyDirectory('mapas/processed', 'mapas/processed');
copyFile('node_modules/fflate/esm/browser.js', 'vendor/fflate/browser.js');
copyDirectory('node_modules/three/build', 'vendor/three');
copyDirectory('node_modules/three/examples/jsm', 'vendor/three/addons');

console.log(`Build estatico gerado em ${path.relative(rootDir, distDir)}`);

function copyFile(from, to) {
  const source = path.join(rootDir, from);
  const target = path.join(distDir, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDirectory(from, to) {
  fs.cpSync(path.join(rootDir, from), path.join(distDir, to), {
    recursive: true,
    force: true
  });
}
