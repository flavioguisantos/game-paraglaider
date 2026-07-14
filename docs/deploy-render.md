# Deploy no Render

O projeto nao usa backend permanente no MVP. O deploy recomendado e **Static Site**.

Para a trilha pos-MVP de radio por voz, o jogo passa a depender tambem do backend realtime separado para:
- `WSS` em `/api/game/realtime`
- `GET /api/game/runtime-config`
- configuracao de `STUN/TURN`

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

## Variaveis relevantes no backend do jogo para o radio

- `GAME_RADIO_ENABLED`
  - liga/desliga o radio por voz em runtime sem remover a presenca online
- `GAME_WEBRTC_ICE_SERVERS`
  - JSON array com os ICE servers entregues ao cliente
  - exemplo:

```json
[
  { "urls": "stun:stun.l.google.com:19302" },
  {
    "urls": ["turn:turn.seudominio.com:3478"],
    "username": "usuario",
    "credential": "senha"
  }
]
```

Sem `TURN`, o radio pode funcionar em algumas redes e falhar em outras.
