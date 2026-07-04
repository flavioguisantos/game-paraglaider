# Deploy no Render

O projeto nao usa backend permanente no MVP. O deploy recomendado e **Static Site**.

## Configuracao

O arquivo `render.yaml` na raiz configura:

- Runtime: `static`
- Build command: `npm install && npm run build`
- Publish path: `./dist`

## Build

`npm run build` gera `dist/` copiando:

- `index.html`
- `src/`
- `image/`
- `mapas/processed/`
- arquivos necessarios do Three.js para `vendor/three/`

## Mapas

O jogo carrega `/mapas/processed/BRA_SUDESTE_HighRes/manifest.json`, `terrain-rgb/` e `vectors/` em runtime. Esses arquivos precisam estar presentes no repositorio usado pelo Render antes do deploy.

Se o mapa processado for apagado, gere novamente localmente com:

```bash
npm run process:xcm
```

Depois confirme que `mapas/processed/BRA_SUDESTE_HighRes/` existe antes de rodar:

```bash
npm run build
```
