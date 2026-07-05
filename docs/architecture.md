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
│   ├── clouds.js
│   ├── vegetation.js
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
Inicializa cena, renderer, relogio, terreno, termicas, HUD, nuvens de horizonte, marcadores 3D de vento e loop principal. O renderer usa tone mapping ACES filmic com exposicao calibrada, color space SRGB e sombras `PCFSoftShadowMap`; a luz direcional do sol projeta sombras com frustum ortografico que acompanha a posicao do jogador a cada frame. O ceu usa o addon `Sky` (espalhamento atmosferico) com sol alinhado a luz direcional, environment map gerado via PMREM e nevoa com tinte atmosferico para perspectiva aerea (ver `docs/visual-realism-plan.md`). Controla o estado pre-voo com botao de inicio e escolha de cor do parapente; ao iniciar, cria jogador, bots, rodada, camera em terceira pessoa e musica. Ajusta dimensoes pelo `visualViewport`, limite de pixel ratio para telas compactas e FOV da camera para preservar leitura horizontal do mapa e das termicas em telas estreitas. Atualiza vento dinamico por frame e coordena as demais atualizacoes.

### `src/terrain.js`
Gera e gerencia o terreno local em chunks a partir do manifesto processado de `mapas/BRA_SUDESTE_HighRes.xcm`. O modulo carrega `manifest.json`, converte a posicao local do piloto para tile/pixel do mapa, calcula a escala horizontal em metros a partir do world file e da latitude central, carrega os chunks `terrain-rgb/{x}/{y}.png` ao redor do piloto e descarrega chunks distantes. URLs de tiles recebem versao de cache para evitar respostas antigas em navegadores móveis. A leitura dos PNGs de relevo usa um decoder PNG proprio para preservar bytes RGB exatos, porque os canais codificam altitude e nao podem sofrer conversao de cor do navegador. A inflacao dos chunks `IDAT` tenta primeiro `DecompressionStream('deflate')` nativo, valida o tamanho descomprimido esperado e usa `fflate` como fallback. O caminho por canvas fica desativado para relevo, especialmente no iOS, pois pode gerar altitudes incorretas. Chunks com falha sao marcados para evitar retry infinito por frame. O modulo registra eventos recentes em `window.__terrainDebug` para diagnosticar carregamento de chunks em dispositivos reais. A cena do terreno separa `XcmReliefLayer`, com a malha de relevo, de `XcmVectorOverlayLayer`, com estradas, ferrovias, rios, areas de agua, areas urbanas e pontos de cidades/vilas vindos de `vectors/{x}/{y}.json`. As camadas vetoriais sao renderizadas de forma realista: estradas, ferrovias e rios viram fitas de geometria com largura real em metros drapejadas sobre o relevo visivel (`getRenderedHeightAt`); os contornos de agua e area urbana sao encadeados em aneis (`chainSegmentsIntoRings`) e preenchidos por triangulacao (`ShapeUtils.triangulateShape`), com a agua plana na altura minima da margem e a area urbana translucida drapejada; pontos de cidades exibem apenas rotulos, sem marcadores geometricos. `getHeightAt()` consulta a altura do chunk carregado em metros e retorna altura de fallback enquanto o tile ainda nao carregou, quando a posicao e invalida ou quando esta fora dos tiles disponiveis. `getRenderedHeightAt()` interpola a altura no lattice de vertices da malha renderizada do chunk (que diverge de `getHeightAt` em encostas pelo espacamento dos vertices) e deve ser usada para apoiar objetos visuais sobre o relevo visivel, como a vegetacao. O acabamento visual dos chunks usa cores por vertice com ruido em duas escalas baseado em coordenadas de mundo, um material compartilhado com textura de detalhe tileavel e overlays vetoriais em cores realistas (ver `docs/visual-realism-plan.md`). O relevo online OSM/Mapzen usado no teste anterior fica desativado para nao conflitar com o mapa XCM local.

### `scripts/process-xcm-map.js`
Processa mapas XCSoar `.xcm` locais. O script extrai o pacote temporariamente, converte `terrain.jp2` para RAW 16-bit via ImageMagick e gera tiles PNG `256x256` em codificacao Terrarium RGB (`R * 256 + G - 32768`). Tambem le os shapefiles do pacote, converte todas as camadas vetoriais para JSONs por tile em `vectors/{x}/{y}.json` e escreve `manifest.json` com bounds, world file, grade de tiles, camadas disponiveis e indice de tiles vetoriais para carregamento progressivo conforme o piloto avanca. Ao final, remove a extracao temporaria e o RAW intermediario para manter `mapas/` somente com o XCM original e a saida usada pelo jogo.

### `src/physics.js`
Calcula movimento simplificado, sink, sustentacao de termicas, vento dinamico e colisao com terreno. A velocidade horizontal das entidades e armazenada em km/h e convertida para m/s antes de aplicar deslocamento em X/Z. O vento varia entre 8 km/h e 30 km/h e e somado como vetor a velocidade propria do parapente, com o angulo relativo discretizado em passos de 10 graus para controlar vento de cauda, vento de frente e deriva lateral. Tambem atualiza as metricas de altitude e distancia radial de cada entidade: altitude absoluta em relacao ao nivel do mar, altura do terreno no X/Z atual, altura sobre o solo naquele ponto e distancia em linha reta desde a decolagem. Detecta colisao entre parapentes e controla o estado enroscado, no qual os dois participantes deixam de voar normalmente e descem juntos a 4 m/s ate o solo.

### `src/thermal.js`
Cria, atualiza e renderiza zonas de termica. Mantem um conjunto inicial perto da largada e gera novas termicas no corredor a frente do jogador conforme ele avanca, removendo colunas que ficam muito para tras para controlar o custo da cena. As termicas derivam na mesma escala do vento aplicado ao parapente, mantendo a leitura de massa de ar em movimento. Cada coluna recalcula sua altura visual a partir do terreno local ate o teto absoluto de 2000 m acima do nivel do mar; o visual inclina levemente na direcao do vento para comunicar a deriva, com coluna e anel sutis, particulas de poeira subindo pelo eixo inclinado, passaros circulando dentro da coluna como marcador natural de termica, uma nuvem billboard no topo (via `src/clouds.js`) e um rotulo na base mostrando a sustentacao maxima em m/s. A sustentacao enfraquece gradualmente nos ultimos 650 m antes do teto (ate 2 m/s no centro do topo) e para acima dele. Deve separar dados de gameplay da representacao visual.

### `src/player.js`
Representa o parapente do jogador, controles, estado de voo, posicao, direcao, altitude, cor principal da vela e pouso. A direcao muda por uma taxa de curva suavizada, evitando giro instantaneo quando o jogador pressiona ou solta o comando. O estado de input aceita teclado e botoes touch sobrepostos, usando os mesmos comandos de acelerar, frear e virar. A posicao inicial do jogador fica em `x=0`, `z=0`, que corresponde a Pedra Grande em Atibaia pela configuracao central do terreno.

### `src/bot.js`
Representa bots simples que escolhem a termica mais proxima e voam em sua direcao usando taxa de curva suavizada. O conjunto inicial inclui quatro parapentes coloridos para manter trafego visual durante a rodada.

### `src/paragliderModel.js`
Cria o modelo visual compartilhado de parapente, incluindo vela, linhas de suspensao, piloto e poses de voo/pouso. O piloto tem casulo (pod harness), tronco, capacete e bracos erguidos aos tirantes em voo; vela e piloto projetam sombras. Jogador e bots carregam a vela OBJ `image/nova-vortex.obj` via `OBJLoader`, usando a mesma escala e configuracao visual, com cores diferentes por participante. O modulo remapeia os eixos do OBJ para o padrao da cena, centraliza, escala e aplica material proprio. O carregamento do OBJ usa cache por URL para evitar requisicoes duplicadas entre jogador e bots, e pula a tentativa quando o navegador esta offline. Apos o OBJ carregar, as ancoragens das linhas sao recalculadas a partir dos vertices transformados da area inferior da vela, conectando as linhas a pontos reais da malha. Se o asset falhar, o modelo usa a vela procedural como fallback. Na pose de pouso, `player.js` e `bot.js` passam a altura do terreno para o modelo, que achata a vela visualmente e a posiciona deitada perto do solo.

### `src/vegetation.js`
Espalha arvores low-poly (tronco + copa em duas `InstancedMesh` com matrizes compartilhadas) ao redor do jogador, com posicionamento deterministico por celula de grade, plantio restrito a cotas de floresta sobre chunks de terreno carregados, variacao de escala/cor por instancia e reconstrucao conforme o jogador avanca.

### `src/clouds.js`
Cria nuvens billboard compartilhadas por `main.js` (horizonte) e `thermal.js` (cumulus no topo das termicas). Cada nuvem combina tres sprites com texturas de nuvem desenhadas em canvas (gradientes radiais com base achatada e sombreamento inferior), cacheadas por variante e marcadas como compartilhadas para nao serem descartadas junto com nuvens individuais. Tambem exporta `createCloudShadow`, a mancha translucida usada por `thermal.js` para projetar a sombra da cumulus no terreno ao longo da direcao do sol.

### `src/audio.js`
Controla feedback sonoro local com Web Audio API. O variometro sonoro e a musica usam um `AudioContext` compartilhado, destravado explicitamente no gesto de iniciar voo e preparado com um pulso curto para melhorar compatibilidade mobile. O variometro emite bips apenas quando o jogador esta com velocidade vertical positiva suficiente, aumentando frequencia, ritmo, intensidade e sustentacao conforme a subida fica mais forte. Tambem gera uma trilha procedural de aventura mais animada durante a rodada. Quando a URL contem `audioDebug=1`, registra eventos em `window.__audioDebug` e mostra um overlay com suporte, estado do contexto, unlock, musica e bips do variometro.

### `src/camera.js`
Controla camera em terceira pessoa com suavizacao. Mantem a camera acima do terreno consultando `terrain.getHeightAt()` para evitar que o relevo oclua mapa e termicas, especialmente em telas estreitas e regioes montanhosas. Tambem posiciona a camera de pre-voo sobre o terreno real carregado. Apos pouso do jogador, os mesmos comandos de direcao passam a orbitar e aproximar/afastar a camera ao redor do local de pouso.

### `src/hud.js`
Atualiza elementos 2D de interface: altura sobre o solo, altitude em relacao ao nivel do mar, variometro, velocidade real sobre o solo, distancia radial desde a decolagem, cronometro sem limite, vento, estado de rodada e ranking. A marcacao do HUD separa metricas principais e secundarias para permitir layout compacto em telas de celular.

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
- `distanceTravelled`: distancia horizontal acumulada em metros, mantida para diagnostico.
- `distanceFromStart`: distancia horizontal em linha reta desde a decolagem, usada no HUD e ranking.
- `groundSpeedKmh`: velocidade real sobre o solo apos efeito do vento.
- `entangled`: se esta enroscado com outro parapente apos colisao.
- `landed`: se ja pousou.
