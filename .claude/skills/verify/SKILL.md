---
name: verify
description: Como buildar, rodar e verificar o jogo de parapente end-to-end (headless via Playwright).
---

# Verificação do jogo-parapente

Site estático (three.js via importmap `/vendor/three`). Sem testes; a verificação é visual.

## Assets gerados

- `image/pilot-arms.glb` (braços skinned da primeira pessoa, até o punho) é gerado por `node scripts/generate-pilot-arms.js`.
- `image/pilot-hands.glb` (mãos cartoon rígidas presas ao osso do punho) é gerado por `node scripts/generate-pilot-hands.js` a partir de `image/obj_9_ARM2-1.stl` (decima ~124k → ~14k triângulos).
- Regenerar após editar esses scripts, antes do build.

## Build + servir

```bash
node scripts/build-static.js   # copia index.html/src/assets p/ dist e monta dist/vendor a partir de node_modules
npx serve dist -l 4173         # rodar em background
```

Cache busting por query string: ao alterar um módulo, bumpar o `?v=` no import (em `index.html` para main.js; em `main.js`/módulos para os demais). Módulos importados com specifiers diferentes (query diferente) viram instâncias separadas — imports do mesmo módulo devem usar a MESMA query em todos os arquivos.

## Dirigir headless

Playwright já está em `node_modules` (browser: `npx playwright install chromium` se faltar). Num script `.mjs` fora do repo, resolver via:

```js
import { createRequire } from 'node:module';
const { chromium } = createRequire('file:///C:/jogo-parapente/package.json')('playwright');
```

Fluxo típico: `goto http://localhost:4173/` → esperar ~4s (carrega terreno) → `click('#start-flight')` → screenshots. Controles: W/A/S/D (voo), C (alterna câmera externa/primeira pessoa). Capturar `pageerror`/`console.error`.

## Gotchas

- No primeiro frame em headless pode aparecer `THREE.WebGLProgram: Shader Error ... MeshBasicMaterial` (SwiftShader, transiente); só é problema se persistir entre execuções.
- O HUD cobre ~250px à esquerda; elementos 3D desse lado ficam ocultos nos screenshots.
