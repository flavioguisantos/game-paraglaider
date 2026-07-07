# Plano de Realismo Visual

Plano em 6 fases para elevar o realismo do jogo sem alterar gameplay ou fisica. A documentacao pertinente (`docs/architecture.md`) deve ser atualizada ao final de cada fase, e o status da fase deve ser marcado aqui.

## Fase 1 — Pipeline de renderizacao [CONCLUIDA]
- `ACESFilmicToneMapping` + exposicao 1.12 e `outputColorSpace` SRGB no renderer.
- Sombras habilitadas (`PCFSoftShadowMap`): a `DirectionalLight` do sol projeta sombras com frustum ortografico de raio 950 m que acompanha o jogador a cada frame (`updateSunLight`).
- Terreno recebe e projeta sombras (auto-sombreamento do relevo); vela, piloto e vela OBJ projetam sombras (`enableShadowCasting` em `paragliderModel.js`).
- Intensidades de luz recalibradas para o tone mapping (hemisferica 1.6, sol 3.1).

## Fase 2 — Ceu atmosferico e nevoa aerea [CONCLUIDA]
- Background solido substituido pelo addon `Sky` (espalhamento atmosferico), com sol alinhado a `SUN_DIRECTION` e cupula de 80000 (dentro do far plane) que acompanha o jogador em X/Z.
- Environment map gerado do proprio ceu via `PMREMGenerator` (`applySkyEnvironment`), com `environmentIntensity` 0.45; luz hemisferica reduzida para 1.15 para compensar.
- Nevoa linear com tinte atmosferico azulado (`0xc3d9e8`, 3500-26000 m) simulando perspectiva aerea.

## Fase 3 — Nuvens por sprites/billboards [CONCLUIDA]
- Novo modulo `src/clouds.js`: `createCloudBillboard()` monta cada nuvem com 3 sprites sobrepostos usando texturas de canvas (puffs em gradiente radial, base achatada com sombreamento sutil), com 4 variantes cacheadas e compartilhadas (`texture.userData.shared`).
- Nuvens de horizonte (`main.js`) e cumulus do topo das termicas (`thermal.js`) passaram a usar os billboards no lugar dos grupos de esferas achatadas.
- `disposeMaterialTextures` em `thermal.js` preserva texturas compartilhadas ao remover termicas.

## Fase 4 — Detalhe do terreno [CONCLUIDA]
- Ruido de valor em duas escalas (manchas largas de clareira/pasto + granulacao fina) aplicado as cores por vertice usando coordenadas de mundo, quebrando as faixas uniformes de altitude de forma continua entre chunks.
- Textura de detalhe tileavel (ruido de trelica com lattice modular, canvas 256x256) aplicada como `map` do material compartilhado dos chunks com repeticao inteira (64x) para nao criar emendas.
- Material do terreno passou a ser compartilhado entre chunks (`getTerrainMaterial`); `unloadChunk` nao descarta mais o material.
- Overlays vetoriais recoloridos para tons realistas vistos do ar: estradas em asfalto/terra, agua em azul profundo, areas urbanas em cinza quente.

## Fase 5 — Visual realista de termicas e vento [CONCLUIDA]
- Coluna da termica quase invisivel (opacidade 0.055, tom quente neutro) e anel da base mais fino e sutil (0.24); particulas menores e translucidas, cor de poeira.
- Passaros circulando dentro de cada termica (3-5 por coluna) como marcador natural: asas em triangulos, orbita com raio/altura/velocidade aleatorios, seguem a inclinacao da coluna pelo vento e alternam planeio com batidas de asa ocasionais (`createThermalBirds`/`animateBirds`).
- Rotulo de sustentacao mantido para legibilidade de gameplay.
- Marcadores 3D de vento mais discretos: opacidade 0.68 -> 0.32 e escala 1.15 -> 0.85.

## Ajustes pos-fases (feedback de teste)
- Setas de vento acompanham a altitude do jogador (`max(terreno + 60, altitude do jogador + 20)`), permanecendo visiveis ao subir na termica.
- Arvores ganharam tronco: `vegetation.js` usa duas `InstancedMesh` (tronco marrom + copa com cor por instancia) compartilhando as mesmas matrizes, expostas em `vegetation.group`.
- Sombra de nuvem no terreno: `createCloudShadow` em `clouds.js` (mancha radial escura translucida); cada termica projeta a sombra da sua cumulus ao longo da direcao real do sol (`SUN_DIRECTION` passada a `createThermalField`), amostrando a altura do terreno no ponto projetado. Sprites nao projetam sombra real no shadow map, por isso a projecao e calculada manualmente.
- Arvores apoiadas no relevo visivel: novo `terrain.getRenderedHeightAt(x, z)` interpola a altura no lattice de vertices da malha do chunk (a malha renderizada diverge varios metros de `getHeightAt` em encostas, o que deixava copas flutuando). O plantio usa essa altura e o tronco (cilindro de 14 m) ainda desce ~8 m abaixo do solo como garantia em encostas ingremes.
- Colisao com arvores: `vegetation.js` guarda volumes simples para cada arvore instanciada, e `physics.detectVegetationCollisions()` marca jogador/bots como `crashed` quando o parapente toca esses volumes.
- Pouso apoiado no relevo visivel: jogador e bots usam a mesma referencia das arvores (`terrain.getRenderedHeightAt`, com fallback para `getHeightAt`) antes de aplicar `setParagliderLandedPose`; a pose pousada baixa levemente o modelo no solo renderizado para a vela ficar rente ao relevo em vez de flutuar.
- Setas de vento reposicionadas abaixo da linha do olhar (`max(terreno + 60, jogador - 45)`) para contrastar com o terreno em vez do ceu, com opacidade 0.55.
- Camadas vetoriais realistas: estradas (asfalto 12 m / 8 m e terra 5 m), ferrovias (3.4 m) e rios (9 m) viram fitas de geometria drapejadas sobre o relevo visivel com juntas cobertas por extensao das pontas; lagos/represas sao reconstruidos encadeando os segmentos de contorno em aneis e preenchidos com superficie d'agua plana (altura minima da margem, roughness baixa para reflexo do ceu); areas urbanas preenchidas em cinza translucido; esferas amarelas dos pontos de cidade removidas (so rotulos). Validado contra os 545 tiles com agua do mapa: 2219 aneis triangulados, zero falhas.
- Painel "Camadas" na tela (canto superior direito): liga/desliga cada camada vetorial (rodovias, estradas, ferrovias, rios, lagos, areas urbanas, nomes de cidades) via `terrain.setLayerVisibility`, para diagnostico e preferencia do jogador. Em telas ate 640 px, o painel fica oculto para preservar espaco de HUD e controles por toque.
- Ajustes finais de composicao visual: montanhas distantes com silhueta suave no horizonte, cielo mais azul e atmosferico, nuvens maiores e vegetacao mais densa/verde para aproximar a experiencia do print de referencia.
- Contraste aereo das camadas: cores recalibradas para leitura em altitude de voo (asfalto claro 0xb0b0b6, terra batida clara 0xc0a577, agua azul 0x3a76ad, area urbana bege 0.45 de opacidade) e larguras de corredor visivel (rodovia 26 m, media 16 m, terra 9 m, ferrovia 6 m, rios 14 m) — fitas de 5-12 m em cores apagadas somem a 2 km de altitude com nevoa.
- Correcao de soterramento das camadas: `getRenderedHeightAt` passou a interpolar pelos triangulos exatos da PlaneGeometry (diagonal b-d por quad) em vez de bilinear — a diferenca chegava a varios metros por quad; e cada segmento de fita e subdividido em passos de meio quad da malha para acompanhar o relevo em vez de atravessar elevacoes (segmentos de estrada podem ter mais de 1 km). Offsets por camada entre 1.0 e 1.8 m.
- Detalhe urbano procedural: novo `src/urbanScenery.js` usa `city_area` para criar ruas locais estreitas e casas low-poly instanciadas sobre o relevo, e usa `roadbig_line` e `roadmedium_line` para posicionar veiculos em movimento nas vias principais. A camada acompanha o ciclo de carregamento/descarregamento dos chunks do terreno e nao interfere na fisica do voo. Ajustes posteriores aumentaram a densidade de casas e trocaram blocos simples por trafego mais denso com carros, vans/pickups, onibus e caminhoes procedurais, com rodas, cabine, para-brisa e farois para melhorar leitura durante sobrevoo.
- Rig de primeira pessoa: `firstPersonRig.js` aprofunda a mao GLB no eixo do punho e adiciona um conector escuro preso ao osso do punho, fechando a emenda entre manga e luva quando o piloto segura os batoques em posicao horizontal. A mao recebeu pitch menos negativo para ficar levemente inclinada para cima, deixando a pegada mais natural. Os bracos foram encurtados no IK e no GLB skinned, com compensacao de escala na mao para preservar o tamanho da luva. O alvo de freio agora recua em direcao ao piloto com pouca queda vertical, dando efeito de puxada do batoque em vez de braco descendo.
- Clipping da visao do piloto: `camera.js` usa near plane de 0.06 m somente na primeira pessoa, evitando que as maos fiquem cortadas/transparentes quando o freio e puxado para perto do corpo; o modo externo continua restaurando near plane maior.
- Carregamento da vela do parapente: quando `nova-vortex.obj` esta configurado, `paragliderModel.js` mantem a vela procedural e as linhas ocultas durante o carregamento normal, evitando que o jogador veja um parapente ser trocado por outro; quando o OBJ termina, ele aparece ja com as linhas recalculadas na malha final. A vela procedural continua existindo como fallback visivel somente em falha/offline.

## Fase 6 — Vegetacao e piloto [CONCLUIDA]
- Novo modulo `src/vegetation.js`: copas de arvore low-poly via `InstancedMesh` (ate 2200 instancias) espalhadas deterministicamente por celula de grade num raio de 1500 m do jogador, plantadas apenas em cotas de floresta (< 1480 m) sobre chunks carregados, com variacao de escala/cor por instancia e sombras. O conjunto replanta quando o jogador se desloca 220 m ou enquanto os chunks iniciais carregam.
- Piloto remodelado em `paragliderModel.js`: casulo (pod harness) deitado em voo, tronco reclinado emergindo do casulo, capacete, bracos erguidos em direcao aos tirantes e cinta de harness. Na pose de pouso o casulo e recolhido e o piloto fica em pe com bracos abaixados.
