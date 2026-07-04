# Arquitetura Inicial

## Visao geral
O projeto e uma aplicacao web estatica. A logica do jogo roda no cliente, em JavaScript, usando Three.js para cena, camera, renderer, geometrias, materiais e animacao. O build copia os arquivos necessarios para `dist/`, que pode ser publicado como Static Site no Render.

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
├── render.yaml
└── scripts/
    ├── build-static.js
    └── process-xcm-map.js
```

## Responsabilidades dos modulos

### `render.yaml`
Configura o deploy no Render como Static Site, usando `npm install && npm run build` e publicando `dist/`.

### `scripts/build-static.js`
Gera o build estatico em `dist/`, copiando `index.html`, `src/`, `image/`, `mapas/processed/`, o modulo ESM do `fflate` para `vendor/fflate/` e os arquivos necessarios do Three.js para `vendor/three/`.

### `src/main.js`
Inicializa cena, renderer, relogio, terreno, termicas, HUD e loop principal. Controla o estado pre-voo com botao de inicio e escolha de cor do parapente; ao iniciar, cria jogador, bots, rodada, camera em terceira pessoa e musica. Ajusta dimensoes pelo `visualViewport`, limite de pixel ratio para telas compactas e FOV da camera para preservar leitura horizontal do mapa e das termicas em telas estreitas. Coordena atualizacoes por frame.

### `src/terrain.js`
Gera e gerencia o terreno local em chunks a partir do manifesto processado de `mapas/BRA_SUDESTE_HighRes.xcm`. O modulo carrega `manifest.json`, converte a posicao local do piloto para tile/pixel do mapa, calcula a escala horizontal em metros a partir do world file e da latitude central, carrega os chunks `terrain-rgb/{x}/{y}.png` ao redor do piloto e descarrega chunks distantes. A leitura dos PNGs de relevo usa um decoder PNG proprio para preservar bytes RGB exatos, porque os canais codificam altitude e nao podem sofrer conversao de cor do navegador. A inflacao dos chunks `IDAT` tenta primeiro `DecompressionStream('deflate')` nativo e usa `fflate` como fallback. O caminho por canvas fica desativado para relevo, especialmente no iOS, pois pode gerar altitudes incorretas. O modulo registra eventos recentes em `window.__terrainDebug` para diagnosticar carregamento de chunks em dispositivos reais. A cena do terreno separa `XcmReliefLayer`, com a malha de relevo, de `XcmVectorOverlayLayer`, com estradas, ferrovias, rios, areas de agua, areas urbanas e pontos de cidades/vilas vindos de `vectors/{x}/{y}.json`. `getHeightAt()` consulta a altura do chunk carregado em metros e retorna altura de fallback enquanto o tile ainda nao carregou, quando a posicao e invalida ou quando esta fora dos tiles disponiveis. O relevo online OSM/Mapzen usado no teste anterior fica desativado para nao conflitar com o mapa XCM local.

### `scripts/process-xcm-map.js`
Processa mapas XCSoar `.xcm` locais. O script extrai o pacote temporariamente, converte `terrain.jp2` para RAW 16-bit via ImageMagick e gera tiles PNG `256x256` em codificacao Terrarium RGB (`R * 256 + G - 32768`). Tambem le os shapefiles do pacote, converte todas as camadas vetoriais para JSONs por tile em `vectors/{x}/{y}.json` e escreve `manifest.json` com bounds, world file, grade de tiles, camadas disponiveis e indice de tiles vetoriais para carregamento progressivo conforme o piloto avanca. Ao final, remove a extracao temporaria e o RAW intermediario para manter `mapas/` somente com o XCM original e a saida usada pelo jogo.

### `src/physics.js`
Calcula movimento simplificado, sink, sustentacao de termicas, efeito do vento e colisao com terreno. A velocidade horizontal das entidades e armazenada em km/h e convertida para m/s antes de aplicar deslocamento em X/Z, mantendo a distancia percorrida proporcional ao mapa real. Tambem atualiza as metricas de altitude de cada entidade: altitude absoluta em relacao ao nivel do mar, altura do terreno no X/Z atual e altura sobre o solo naquele ponto. Detecta colisao entre parapentes e controla o estado enroscado, no qual os dois participantes deixam de voar normalmente e descem juntos a 4 m/s ate o solo.

### `src/thermal.js`
Cria, atualiza e renderiza zonas de termica. Mantem um conjunto inicial perto da largada e gera novas termicas no corredor a frente do jogador conforme ele avanca, removendo colunas que ficam muito para tras para controlar o custo da cena. Deve separar dados de gameplay da representacao visual.

### `src/player.js`
Representa o parapente do jogador, controles, estado de voo, posicao, direcao, altitude, cor principal da vela e pouso. A direcao muda por uma taxa de curva suavizada, evitando giro instantaneo quando o jogador pressiona ou solta o comando. O estado de input aceita teclado e botoes touch sobrepostos, usando os mesmos comandos de acelerar, frear e virar. A posicao inicial do jogador fica em `x=0`, `z=0`, que corresponde a Pedra Grande em Atibaia pela configuracao central do terreno.

### `src/bot.js`
Representa bots simples que escolhem a termica mais proxima e voam em sua direcao usando taxa de curva suavizada. O conjunto inicial inclui quatro parapentes coloridos para manter trafego visual durante a rodada.

### `src/paragliderModel.js`
Cria o modelo visual compartilhado de parapente, incluindo vela, linhas de suspensao, piloto e poses de voo/pouso. Jogador e bots carregam a vela OBJ `image/nova-vortex.obj` via `OBJLoader`, usando a mesma escala e configuracao visual, com cores diferentes por participante. O modulo remapeia os eixos do OBJ para o padrao da cena, centraliza, escala e aplica material proprio. O carregamento do OBJ usa cache por URL para evitar requisicoes duplicadas entre jogador e bots, e pula a tentativa quando o navegador esta offline. Apos o OBJ carregar, as ancoragens das linhas sao recalculadas a partir dos vertices transformados da area inferior da vela, conectando as linhas a pontos reais da malha. Se o asset falhar, o modelo usa a vela procedural como fallback. Na pose de pouso, `player.js` e `bot.js` passam a altura do terreno para o modelo, que achata a vela visualmente e a posiciona deitada perto do solo.

### `src/audio.js`
Controla feedback sonoro local com Web Audio API. O variometro sonoro destrava apos o primeiro gesto do usuario e emite bips apenas quando o jogador esta com velocidade vertical positiva suficiente, aumentando frequencia, ritmo, intensidade e sustentacao conforme a subida fica mais forte. Tambem gera uma trilha procedural de aventura mais animada durante a rodada.

### `src/camera.js`
Controla camera em terceira pessoa com suavizacao. Mantem a camera acima do terreno consultando `terrain.getHeightAt()` para evitar que o relevo oclua mapa e termicas, especialmente em telas estreitas e regioes montanhosas. Tambem posiciona a camera de pre-voo sobre o terreno real carregado. Apos pouso do jogador, os mesmos comandos de direcao passam a orbitar e aproximar/afastar a camera ao redor do local de pouso.

### `src/hud.js`
Atualiza elementos 2D de interface: altura sobre o solo, altitude em relacao ao nivel do mar, variometro, velocidade, distancia, tempo, estado de rodada e ranking. A marcacao do HUD separa metricas principais e secundarias para permitir layout compacto em telas de celular.

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
- `turnRate`: taxa de curva atual suavizada.
- `verticalSpeed`: variometro atual.
- `altitudeAboveSeaLevel`: altitude absoluta em metros.
- `groundHeight`: altura do terreno consultada no X/Z atual.
- `groundClearance`: altura sobre o terreno no X/Z atual.
- `speed`: velocidade horizontal em km/h.
- `distanceTravelled`: distancia horizontal acumulada em metros.
- `entangled`: se esta enroscado com outro parapente apos colisao.
- `landed`: se ja pousou.
