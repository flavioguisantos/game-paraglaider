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
│   ├── orographicLift.js
│   ├── player.js
│   ├── bot.js
│   ├── paragliderModel.js
│   ├── firstPersonRig.js
│   ├── clouds.js
│   ├── vegetation.js
│   ├── urbanScenery.js
│   ├── audio.js
│   ├── camera.js
│   ├── celebration.js
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
Inicializa cena, renderer, relogio, terreno, termicas, HUD, nuvens de horizonte, marcadores 3D de vento e loop principal. O renderer usa tone mapping ACES filmic com exposicao calibrada, color space SRGB e sombras `PCFSoftShadowMap`; a luz direcional do sol projeta sombras com frustum ortografico que acompanha o jogador a cada frame. O ceu usa o addon `Sky` (espalhamento atmosferico) com sol alinhado a luz direcional, environment map gerado via PMREM e nevoa com tinte atmosferico para perspectiva aerea (ver `docs/visual-realism-plan.md`). Controla o estado pre-voo com botao de inicio, nome obrigatorio do piloto, escolha de local de voo e escolha de cor do parapente; em telas mobile, mantem essas escolhas junto da selecao entre parapente e drone em um painel mais compacto e rolavel. Na carga inicial, recupera apenas o ultimo nome digitado, busca o catalogo de rampas e o total global de partidas na API de jogo e exibe tanto o contador global quanto a presenca da rampa selecionada no painel inicial. Ao trocar o local antes da rodada, pede ao terreno para recentrar a origem do mundo no ponto geografico escolhido e atualiza o resumo da sessao da rampa. Ao iniciar, valida o nome, emite a identidade guest do jogador para aquela sessao, entra primeiro na sessao HTTP da rampa para capturar o bundle autoritativo do mundo e so depois cria jogador, bots, rodada, camera em terceira pessoa e musica; quando a rodada realmente nasce com sucesso, registra a partida iniciada na API desacoplada de jogo e abre um WebSocket para publicar snapshots do jogador local e receber presenca/snapshots dos outros pilotos. Quando a sessao da rampa traz mundo autoritativo, o front passa a usar a rota, as termicas e os parametros principais do vento vindos da API, mantendo fallback local apenas quando esse bundle nao existe. Ajusta dimensoes pelo `visualViewport`, limite de pixel ratio para telas compactas e FOV da camera para preservar leitura horizontal do mapa e das termicas em telas estreitas. Tambem oculta completamente o toggle de camera quando o drone esta selecionado, ja que esse modo fica travado em primeira pessoa, reposiciona esse toggle mais acima do joystick touch quando o parapente esta ativo no mobile, atualiza os rotulos do pad conforme o veiculo escolhido, reduz o joystick principal mobile e sincroniza na direita um stack com radio toggle e joystick de camera touch que so aparece em primeira pessoa e recentra o olhar ao soltar. Atualiza vento dinamico por frame e coordena as demais atualizacoes.

### `src/gameApi.js`
Cliente HTTP isolado para a API do dominio `game`. Resolve a base por `window.__GAME_API_BASE_URL` quando configurada e, por padrao, aponta para o back-end compartilhado publicado. Expoe operacoes para identidade guest, contador global de partidas, catalogo de rampas, sessao da rampa e mutacoes basicas do jogador na sessao. Tambem persiste localmente o ultimo nome digitado do piloto para pre-preencher a tela inicial sem acoplar o restante da UI ao back-end.

### `src/gameRealtimeClient.js`
Cliente WebSocket fino para `/api/game/realtime`. Faz `join_launch`, envia heartbeats e snapshots resumidos do jogador local e repassa `joined_launch`, `presence_update`, `world_snapshot` e `round_event` para o `main.js`.

### `src/remotePlayer.js`
Representacao visual dos outros jogadores recebidos por snapshot da sessao online. Reaproveita o modelo de parapente/drone do jogo, exibe o nome do piloto acima da vela apenas para os outros participantes e suaviza posicao/heading locais sem participar da fisica, do scoring ou da colisao do jogador local.

### `src/flightLocations.js`
Mantem o catalogo inicial de locais de voo usados como fallback da tela inicial e tambem aceita substituicao em runtime pelo catalogo persistido da API de jogo. Cada local define `id`, nome, regiao, coordenadas de latitude/longitude e ajustes locais de decolagem/sustentacao, incluindo altura, heading inicial e heading de camera pre-voo. O local padrao e Atibaia / Pedra Grande; a Praia de Sao Vicente, Itarare, tambem fica disponivel para o MVP com altitude inicial maior, parapente/camera apontados para o mar, perfil de vento vindo do mar, termicas desativadas e lift orografico.

### `src/terrain.js`
Gera e gerencia o terreno local em chunks a partir do manifesto processado de `mapas/BRA_SUDESTE_HighRes.xcm`. O modulo carrega `manifest.json`, converte a posicao local do piloto para tile/pixel do mapa, calcula a escala horizontal em metros a partir do world file e da latitude central, carrega os chunks `terrain-rgb/{x}/{y}.png` ao redor do piloto e descarrega chunks distantes. `setCenterCoordinates()` troca qual latitude/longitude corresponde a `x=0,z=0`, descarrega chunks antigos, limpa falhas pendentes e ignora tiles assíncronos de centros anteriores. `ensureHeightAt()` permite aguardar o chunk do ponto de decolagem antes de criar o jogador, evitando largada com altura de fallback. URLs de tiles recebem versao de cache para evitar respostas antigas em navegadores móveis. A leitura dos PNGs de relevo usa um decoder PNG proprio para preservar bytes RGB exatos, porque os canais codificam altitude e nao podem sofrer conversao de cor do navegador. Pixels NoData do DEM (ex.: mar aberto em Sao Vicente) sao normalizados para altitude 0 e recebem cor de agua na malha do relevo, removendo buracos costeiros. Amostras de terra baixa proximas a NoData costeiro recebem cor de areia para formar a faixa clara entre praia/rodovia e mar. A inflacao dos chunks `IDAT` tenta primeiro `DecompressionStream('deflate')` nativo, valida o tamanho descomprimido esperado e usa `fflate` como fallback. O caminho por canvas fica desativado para relevo, especialmente no iOS, pois pode gerar altitudes incorretas. Chunks com falha sao marcados para evitar retry infinito por frame. O modulo registra eventos recentes em `window.__terrainDebug` para diagnosticar carregamento de chunks em dispositivos reais. A cena do terreno separa `XcmReliefLayer`, com a malha de relevo, `XcmVectorOverlayLayer`, com estradas, ferrovias, rios, areas de agua, areas urbanas e pontos de cidades/vilas vindos de `vectors/{x}/{y}.json`, e `UrbanScenery`, com casas, ruas locais e veiculos em rodovias gerados a partir dos mesmos vetores. As camadas vetoriais sao renderizadas de forma realista: estradas, ferrovias e rios viram fitas de geometria com largura real em metros drapejadas sobre o relevo visivel (`getRenderedHeightAt`); os contornos de agua e area urbana sao encadeados em aneis (`chainSegmentsIntoRings`) e preenchidos por triangulacao (`ShapeUtils.triangulateShape`), com a agua plana na altura minima da margem e a area urbana translucida drapejada; pontos de cidades exibem apenas rotulos, sem marcadores geometricos. `getHeightAt()` consulta a altura do chunk carregado em metros e retorna altura de fallback enquanto o tile ainda nao carregou, quando a posicao e invalida ou quando esta fora dos tiles disponiveis. `getRenderedHeightAt()` interpola a altura no lattice de vertices da malha renderizada do chunk (que diverge de `getHeightAt` em encostas pelo espacamento dos vertices) e deve ser usada para apoiar objetos visuais sobre o relevo visivel, como a vegetacao. O acabamento visual dos chunks usa cores por vertice com ruido em duas escalas baseado em coordenadas de mundo, um material compartilhado com textura de detalhe tileavel e overlays vetoriais em cores realistas (ver `docs/visual-realism-plan.md`). O relevo online OSM/Mapzen usado no teste anterior fica desativado para nao conflitar com o mapa XCM local.

### `src/urbanScenery.js`
Cria detalhes urbanos por chunk usando os vetores ja carregados pelo terreno. Areas `city_area` geram ruas locais estreitas e casas low-poly instanciadas em densidade alta, com telhados e paredes em cores variadas, apoiadas por `terrain.getVectorHeight()` para seguir o relevo renderizado. Segmentos `roadbig_line` e `roadmedium_line` geram trafego denso com multiplos veiculos por segmento longo: carros, vans/pickups, onibus e caminhoes com bau/carga, rodas, cabine, para-brisa e farois. Os veiculos se movem continuamente sobre as vias com faixa lateral, velocidade deterministica por tipo e altura recalculada a cada frame. A camada e adicionada/descarregada junto dos chunks para manter custo controlado e nao altera fisica, colisao ou regras de voo.

### `scripts/process-xcm-map.js`
Processa mapas XCSoar `.xcm` locais. O script extrai o pacote temporariamente, converte `terrain.jp2` para RAW 16-bit via ImageMagick e gera tiles PNG `256x256` em codificacao Terrarium RGB (`R * 256 + G - 32768`). Tambem le os shapefiles do pacote, converte todas as camadas vetoriais para JSONs por tile em `vectors/{x}/{y}.json` e escreve `manifest.json` com bounds, world file, grade de tiles, camadas disponiveis e indice de tiles vetoriais para carregamento progressivo conforme o piloto avanca. Ao final, remove a extracao temporaria e o RAW intermediario para manter `mapas/` somente com o XCM original e a saida usada pelo jogo.

### `src/physics.js`
Calcula movimento simplificado, sink, sustentacao de termicas e lift orografico, vento dinamico e colisao com terreno. A velocidade horizontal das entidades e armazenada em km/h e convertida para m/s antes de aplicar deslocamento em X/Z. O vento varia entre 8 km/h e 30 km/h e e somado como vetor a velocidade propria do parapente, com o angulo relativo discretizado em passos de 10 graus para controlar vento de cauda, vento de frente e deriva lateral. `configureWind()` permite trocar a direcao base e a amplitude de variacao conforme o local selecionado antes da rodada. Tambem atualiza as metricas de altitude e distancia radial de cada entidade: altitude absoluta em relacao ao nivel do mar, altura do terreno no X/Z atual, altura sobre o solo naquele ponto e distancia em linha reta desde a decolagem. Detecta colisao entre parapentes e controla o estado enroscado, no qual os dois participantes deixam de voar normalmente e descem juntos a 4 m/s ate o solo. Tambem expõe `detectVegetationCollisions()`, que consulta volumes simples das arvores plantadas para marcar contato com vegetacao como colisao/crash.

### `src/orographicLift.js`
Calcula a sustentacao de encosta para locais sem termicas, inicialmente Sao Vicente. O modulo compara o terreno a barlavento e a sotavento no sentido do vento: quando a massa de ar vinda do mar encontra relevo subindo dentro de uma faixa de cerca de 50 m, gera lift proporcional ao vento, ao ganho de altura da encosta e a altura do piloto. A sustentacao enfraquece nos ultimos metros e zera por volta de 300 m acima da crista local. Tambem mantem um grupo visual leve em formato de faixa, com base alongada, parede translucida de corrente ascendente e rotulos de m/s nos pontos mais fortes encontrados ao redor do piloto.

### `src/thermal.js`
Cria, atualiza e renderiza zonas de termica. Em fallback local, mantem um conjunto inicial perto da largada e gera novas termicas no corredor a frente do jogador conforme ele avanca, removendo colunas que ficam muito para tras para controlar o custo da cena. Quando existe rota ativa, tanto a geracao quanto a poda passam a respeitar o corredor das pernas restantes, preservando termicas uteis entre `TPs` e ate o `GOL` mesmo quando o piloto deriva, muda de perna ou ainda nao alinhou totalmente o novo rumo. Quando a sessao da rampa traz um catalogo autoritativo de termicas, esse modulo substitui totalmente o layout local por essas colunas persistidas no back-end. Cada coluna autoritativa guarda um ponto-fonte fixo e aplica o `driftFactor` recebido; ao derivar a distancia `sourceRegenerationDistanceMeters` (3 km por padrao), dispara uma unica sucessora na origem. A geracao anterior continua ate encerrar o ciclo e entao e removida, controlando o acumulo de geracoes por fonte. Em rotas longas, fisica, deriva e ciclos continuam ativos para todo o catalogo, mas grupos visuais, sombras, particulas e passaros so ficam visiveis e atualizam dentro de 12 km do jogador, evitando custo por frame proporcional a rota inteira. Cada coluna proxima recalcula sua altura visual a partir do terreno local ate o teto absoluto configurado; o visual inclina levemente na direcao do vento para comunicar a deriva, com coluna e anel sutis, particulas de poeira subindo pelo eixo inclinado, passaros circulando dentro da coluna como marcador natural de termica, uma nuvem billboard no topo (via `src/clouds.js`) e um rotulo na base mostrando a sustentacao maxima em m/s. A sustentacao enfraquece gradualmente nos ultimos 650 m antes do teto (ate 2 m/s no centro do topo) e para acima dele. Deve separar dados de gameplay da representacao visual.

### `src/player.js`
Representa o parapente do jogador, controles, estado de voo, posicao, direcao, altitude, cor principal da vela e pouso. A direcao muda por uma taxa de curva suavizada, evitando giro instantaneo quando o jogador pressiona ou solta o comando. O estado de input aceita teclado e joystick touch analogico por arrasto, convertendo o pad circular mobile em intensidades `0..1` para curva e eixo vertical com leitura visual e rotulos contextuais por veiculo (`Acelera/Freia` no parapente, `Sobe/Desce` no drone), alem de `boost` separado para o drone; como o eixo Y do ponteiro no DOM cresce para baixo, a leitura touch inverte esse sinal internamente para manter `arrastar para cima` alinhado ao rotulo mostrado. A posicao inicial do jogador fica em `x=0`, `z=0`, que corresponde ao local selecionado na tela inicial pela configuracao central do terreno, e a altura inicial sobre o solo pode vir da configuracao desse local. No perfil `drone`, o spawn agora acontece com velocidade inicial `0 km/h` e o alvo de velocidade tambem fica em zero sem `boost`, permitindo hover parado no ar ate o jogador acelerar. O jogador local mantem o nome associado a identidade da sessao, mas nao mostra esse rotulo acima da propria vela em nenhum modo de camera.

### `src/playerNameTag.js`
Componente visual reutilizavel para nomes de pilotos. Desenha um sprite em canvas com fundo translucido e texto centralizado, usado tanto pelo jogador local quanto pelos pilotos remotos para identificacao na cena online.

### `src/bot.js`
Representa bots simples que escolhem a termica mais proxima e voam em sua direcao usando taxa de curva suavizada. O conjunto inicial inclui quatro parapentes coloridos para manter trafego visual durante a rodada.

### `src/scoring.js`
Mantem a gamificacao de cross-country: pontuacao por distancia voada, bonus por velocidade, bonus de subida em termicas com multiplicador de risco, combo de altitude por encadear termicas sem pousar e uma rota autoritativa aleatoria de 4 a 8 TPs mais `GOL`, alinhada ao semiplano favoravel do vento, com marcadores 3D. Quando a sessao online da rampa traz uma rota autoritativa, o modulo usa exatamente esses waypoints e os respectivos raios de validacao; sem bundle autoritativo, continua sorteando a rota localmente e, em cenarios costeiros, valida cada waypoint contra `terrain.isSeaAt()` em varios pontos do cilindro antes de aceitar a perna, evitando TPs sobre o mar. O modulo inicializa os campos de pontuacao de jogador e bots, agrupa pontos continuos em eventos de feedback e atualiza todos no loop principal.

### `src/paragliderModel.js`
Cria o modelo visual compartilhado de parapente, incluindo vela, linhas de suspensao, piloto e poses de voo/pouso. O piloto tem casulo (pod harness), tronco, capacete e bracos erguidos aos tirantes em voo; vela e piloto projetam sombras. Jogador e bots carregam a vela OBJ `image/nova-vortex.obj` via `OBJLoader`, usando a mesma escala e configuracao visual, com cores diferentes por participante. O modulo remapeia os eixos do OBJ para o padrao da cena, centraliza, escala e aplica material proprio. O carregamento do OBJ usa cache por URL para evitar requisicoes duplicadas entre jogador e bots, e pula a tentativa quando o navegador esta offline. Quando ha asset configurado, a vela procedural e as linhas ficam ocultas durante o carregamento para evitar troca visual de parapente; ao concluir, o OBJ aparece ja com as ancoragens recalculadas a partir dos vertices transformados da area inferior da vela. As linhas de comando dos batoques ancoram no bordo de fuga com o ponto deslocado 50% em direcao a ponta da vela para ficarem visualmente mais proximas das estabilizadoras. Se o asset falhar ou o navegador estiver offline, o modelo revela a vela procedural como fallback. Na pose de pouso, `player.js` e `bot.js` passam a altura visual do relevo (`terrain.getRenderedHeightAt`, com fallback para `getHeightAt`) para o modelo, que achata a vela e a posiciona ligeiramente dentro do solo renderizado para evitar flutuacao em encostas.

### `src/firstPersonRig.js`
Monta o rig exclusivo da visao do piloto, com frente da selete, cockpit, tirantes, bracos com IK de dois ossos, luvas e batoques. O rig fica oculto fora da primeira pessoa; enquanto ativo, `player.js` oculta o piloto externo para evitar sobreposicao. Os GLBs `image/pilot-arms.glb` e `image/pilot-hands.glb` substituem o fallback procedural quando carregam, mantendo um conector no punho para fechar a emenda entre manga e mao em posicoes horizontais de freio.

### `src/vegetation.js`
Espalha arvores low-poly (tronco + copa em duas `InstancedMesh` com matrizes compartilhadas) ao redor do jogador, com posicionamento deterministico por celula de grade, plantio restrito a cotas de floresta sobre chunks de terreno carregados, variacao de escala/cor por instancia e reconstrucao conforme o jogador avanca. O plantio ignora pixels identificados como mar pelo terreno. Ao trocar o local de voo antes da rodada, `reset()` limpa imediatamente instancias antigas para evitar arvores do local anterior durante a camera de pre-voo. Mantem uma lista leve de volumes de colisao das arvores instanciadas, usada pela fisica para derrubar o parapente quando ele encosta na vegetacao.

### `src/clouds.js`
Cria nuvens billboard compartilhadas por `main.js` (horizonte) e `thermal.js` (cumulus no topo das termicas). Cada nuvem combina tres sprites com texturas de nuvem desenhadas em canvas (gradientes radiais com base achatada e sombreamento inferior), cacheadas por variante e marcadas como compartilhadas para nao serem descartadas junto com nuvens individuais. Tambem exporta `createCloudShadow`, a mancha translucida usada por `thermal.js` para projetar a sombra da cumulus no terreno ao longo da direcao do sol.

### `src/audio.js`
Controla feedback sonoro local com Web Audio API. O variometro sonoro, a fanfarra de pontuacao e a musica usam um `AudioContext` compartilhado, destravado explicitamente no gesto de iniciar voo e preparado com um pulso curto para melhorar compatibilidade mobile. O variometro emite bips apenas quando o jogador esta com velocidade vertical positiva suficiente, aumentando frequencia, ritmo, intensidade e sustentacao conforme a subida fica mais forte. A fanfarra de pontuacao toca uma frase curta quando o jogador recebe um novo evento de pontos. Tambem gera uma trilha procedural de aventura mais animada durante a rodada, e agora pode trocar para uma trilha externa em MP3, OGG ou WAV quando `trackUrl` e informado. Quando a URL contem `audioDebug=1`, registra eventos em `window.__audioDebug` e mostra um overlay com suporte, estado do contexto, unlock, musica e bips do variometro.

### `src/radioState.js`
Centraliza o contrato funcional do radio por voz half-duplex em uma maquina de estados pura, sem dependencias de DOM, audio ou WebRTC. Define os estados canonicos do canal (`idle`, `requesting`, `granted`, `broadcasting`, `releasing`, `occupied`, `error`), os estados do cliente (`disconnected`, `connected`, `mic_blocked`, `ready`, `transmitting`, `listening`) e as transicoes basicas disparadas por sessao, permissao de microfone, push-to-talk e eventos do servidor. Esse modulo serve de base para as futuras integracoes de protocolo realtime, UI do HUD e transporte WebRTC.

### `src/radioVoiceClient.js`
Cliente WebRTC do radio por voz. Captura o microfone sob demanda via `getUserMedia`, cria `RTCPeerConnection` com ICE servers configuraveis por `window.__GAME_WEBRTC_ICE_SERVERS`, publica `offer/answer/candidates` pelo canal realtime existente e reproduz streams remotos em elementos `audio` ocultos. Mantem o transporte de voz isolado da logica de HUD e do estado funcional do radio.

### `src/camera.js`
Controla camera em terceira pessoa com suavizacao. Mantem a camera acima do terreno consultando `terrain.getHeightAt()` para evitar que o relevo oclua mapa e termicas, especialmente em telas estreitas e regioes montanhosas. Tambem posiciona a camera de pre-voo sobre o terreno real carregado. Na primeira pessoa, aplica a orientacao do veiculo e soma um `head look` local limitado a `±180 graus` no yaw e `±90 graus` no pitch, sem alterar a direcao de voo; no desktop esse olhar recebe delta de mouse e no mobile recebe um joystick touch proprio que volta ao centro ao soltar. Apos pouso do jogador, os mesmos comandos de direcao passam a orbitar e aproximar/afastar a camera ao redor do local de pouso.

### `src/celebration.js`
Comemoracao de GOL para redes sociais. Exporta o rastreador de recordes do voo (`createFlightStats`/`updateFlightStats`, com altitude maxima, subida maxima e velocidade maxima sobre o solo, atualizado por frame no loop principal) e `createCelebration`, que monta um overlay com animacao de confete em canvas e um card com os principais dados do voo. O card e renderizado tambem em um canvas 1080x1350 (4:5) para compartilhar via Web Share API com arquivo ou baixar como PNG; sem suporte a share de arquivos, o compartilhar cai para download. `main.js` dispara a comemoracao uma unica vez por rodada quando `player.routeFinished` fica verdadeiro, sem pausar o jogo; o modulo nao altera fisica nem pontuacao.

### `src/hud.js`
Atualiza elementos 2D de interface: altura sobre o solo, altitude em relacao ao nivel do mar, variometro, velocidade real sobre o solo, distancia radial desde a decolagem, pontuacao, combo, proximo waypoint, contador global de partidas iniciadas, card temporario de pontos, cronometro sem limite, vento, estado de rodada, radio por voz e ranking por pontos. Quando a sessao online da rampa fornece ranking realtime, o cartao inferior troca o ranking local de bots pelo ranking recebido da API de jogo. O HUD inclui um card de radio com estado do canal, nome do locutor e botao `Segure para falar` para desktop, mantendo `pointer-events` apenas nessa area. A marcacao do HUD separa metricas principais e secundarias para permitir layout compacto em telas de celular, com faixa unica no topo para os dados essenciais, um card proprio para o assistente termico quando ativo e menor competicao visual com os controles touch; no mobile, o card de radio fica oculto porque a transmissao usa um controle touch dedicado fora do HUD em formato de switch liga/desliga.

## Loop principal
1. Ler input do jogador.
2. Atualizar vento e termicas.
3. Atualizar jogador.
4. Atualizar bots.
5. Checar colisao com terreno.
6. Atualizar pontuacao e waypoints.
7. Atualizar audio do variometro.
8. Atualizar camera.
9. Atualizar HUD.
10. Renderizar cena.

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
- `score`: pontuacao total atual usada pelo ranking.
- `thermalCombo`: multiplicador atual por encadear termicas sem pousar.
- `nextWaypointIndex`: indice do proximo checkpoint da rota.
- `entangled`: se esta enroscado com outro parapente apos colisao.
- `landed`: se ja pousou.
