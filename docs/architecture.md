# Arquitetura Inicial

## Visao geral
O projeto sera uma aplicacao web estatica servida por Express. A logica do jogo roda no cliente, em JavaScript, usando Three.js para cena, camera, renderer, geometrias, materiais e animacao.

## Estrutura prevista
```text
jogo-parapente/
├── docs/
│   ├── project-context.md
│   ├── architecture.md
│   ├── game-design.md
│   ├── implementation-plan.md
│   └── ai-guidelines.md
├── assets/
├── src/
│   ├── main.js
│   ├── terrain.js
│   ├── physics.js
│   ├── thermal.js
│   ├── player.js
│   ├── bot.js
│   ├── paragliderModel.js
│   ├── audio.js
│   ├── camera.js
│   └── hud.js
├── index.html
├── package.json
└── server.js
```

## Responsabilidades dos modulos

### `src/main.js`
Inicializa cena, renderer, relogio, terreno, jogador, bots, termicas, HUD e loop principal. Coordena atualizacoes por frame.

### `src/terrain.js`
Gera geometria procedural do terreno e expoe uma funcao para consultar altura do solo em uma coordenada X/Z.

### `src/physics.js`
Calcula movimento simplificado, sink, sustentacao de termicas, efeito do vento e colisao com terreno.

### `src/thermal.js`
Cria, atualiza e renderiza zonas de termica. Deve separar dados de gameplay da representacao visual.

### `src/player.js`
Representa o parapente do jogador, controles, estado de voo, posicao, direcao, altitude e pouso.

### `src/bot.js`
Representa bots simples que escolhem a termica mais proxima e voam em sua direcao.

### `src/paragliderModel.js`
Cria o modelo visual compartilhado de parapente, incluindo vela, linhas de suspensao, piloto e poses de voo/pouso. Jogador e bots carregam a vela OBJ `image/nova-vortex.obj` via `OBJLoader`, usando a mesma escala e configuracao visual, com cores diferentes por participante. O modulo remapeia os eixos do OBJ para o padrao da cena, centraliza, escala e aplica material proprio. Apos o OBJ carregar, as ancoragens das linhas sao recalculadas a partir dos vertices transformados da area inferior da vela, conectando as linhas a pontos reais da malha. Se o asset falhar, o modelo usa a vela procedural como fallback. Na pose de pouso, `player.js` e `bot.js` passam a altura do terreno para o modelo, que achata a vela visualmente e a posiciona deitada perto do solo.

### `src/audio.js`
Controla feedback sonoro local com Web Audio API. O variometro sonoro destrava apos o primeiro gesto do usuario e emite bips apenas quando o jogador esta com velocidade vertical positiva suficiente.

### `src/camera.js`
Controla camera em terceira pessoa com suavizacao. Apos pouso do jogador, os mesmos comandos de direcao passam a orbitar e aproximar/afastar a camera ao redor do local de pouso.

### `src/hud.js`
Atualiza elementos 2D de interface: altitude, variometro, tempo, estado de rodada e ranking.

## Loop principal
1. Ler input do jogador.
2. Atualizar vento e termicas.
3. Atualizar jogador.
4. Atualizar bots.
5. Checar colisao com terreno.
6. Atualizar audio do variometro.
7. Atualizar camera.
8. Atualizar HUD.
9. Renderizar cena.

## Estado minimo de uma entidade voadora
- `position`: coordenadas X/Y/Z.
- `velocity`: vetor X/Y/Z.
- `heading`: direcao horizontal.
- `turnRate`: taxa de curva atual.
- `verticalSpeed`: variometro atual.
- `distanceTravelled`: distancia acumulada.
- `landed`: se ja pousou.
