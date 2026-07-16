# Design do Jogo

## Fantasia de jogo
O jogador pilota um parapente em terreno montanhoso, buscando colunas de ar quente para ganhar altitude e permanecer voando mais tempo que os competidores.

## Objetivo da rodada
Ganhar altitude e afastar-se do ponto de decolagem. A rodada nao tem limite de tempo; ao final, o ranking compara jogador e bots por desempenho.

## Contador de partidas
- O prototipo mantem um contador global de partidas iniciadas com sucesso.
- Uma partida conta apenas quando a rodada realmente nasce apos o clique em iniciar, e nao no clique isolado do botao.
- O total global deve aparecer no menu inicial e no HUD como informacao social/operacional, sem interferir na pontuacao da rodada.
- A integracao com persistencia deve ficar desacoplada do loop principal por um client dedicado no front e por rotas proprias de jogo no back-end, facilitando extracao futura para uma API exclusiva.

## Presenca por rampa
- O prototipo passa a consultar o catalogo de rampas e o resumo da sessao da rampa pela API de jogo, em vez de depender apenas da lista local embutida.
- O painel inicial deve mostrar quantos pilotos estao presentes na rampa atualmente e o status resumido da sessao selecionada.
- Antes de iniciar o voo, o jogador deve informar obrigatoriamente o nome do piloto; esse nome identifica a identidade guest emitida pela API para a sessao.
- Ao iniciar o voo, o cliente entra na sessao da rampa com uma identidade guest emitida pela API.
- Enquanto voa, o cliente publica snapshots resumidos do proprio jogador e recebe snapshots dos outros pilotos presentes na mesma rampa.
- Os outros jogadores devem aparecer voando na cena como participantes remotos visuais; eles nao substituem ainda a fisica local, os bots ou a simulacao autoritativa.
- O nome do piloto deve aparecer acima da vela apenas para os demais participantes, e nao para o proprio piloto local.
- Quando houver ranking realtime na sessao da rampa, o cartao de ranking do HUD deve priorizar esse ranking online.
- Quando a sessao da rampa trouxer mundo autoritativo, todos os clientes dessa rampa devem usar a mesma rota, o mesmo conjunto de termicas e os mesmos parametros-base de vento.

## Controles iniciais
Antes da rodada, o jogador informa o nome do piloto, escolhe o local de voo, escolhe entre `Parapente` e `Drone FPV`, define a cor principal do veiculo em uma paleta ampliada e inicia o voo por um botao de tela. No layout mobile da tela inicial, o painel continua exibindo o campo de nome, a escolha de rampa/local, a escolha entre `Parapente` e `Drone FPV`, a paleta de cor e o botao de iniciar, com layout mais compacto e rolavel. Locais iniciais disponiveis:
- Atibaia / Pedra Grande, Atibaia - SP.
- Praia de Sao Vicente, Itarare, Sao Vicente - SP (`-23.964517, -46.363531`), com decolagem inicial mais alta, parapente apontado para o mar e vento vindo do mar.
- Ao selecionar Sao Vicente na tela inicial, a camera de pre-voo tambem deve olhar de frente para o mar.

- `W` ou seta para cima: acionar a barra de velocidade, acelerando do trim (38 km/h) ate ~55 km/h; voar acelerado aumenta o afundamento pela curva polar.
- `S` ou seta para baixo: frear do trim ate ~26 km/h; segurar o freio perto do chao executa o flare, amortecendo o pouso (reserva unica por voo).
- `A` ou seta para esquerda: virar para esquerda.
- `D` ou seta para direita: virar para direita.
- No `Drone FPV`, `seta para cima` desce, `seta para baixo` sobe, `Espaco` aciona o boost de velocidade, `A`/`D` comandam yaw rapido e `W`/`S` controlam pitch para mergulho, subida forte e loop.
- No `Drone FPV`, a camera em primeira pessoa acompanha imediatamente a inclinacao vertical do drone: ao descer olha para baixo; ao subir olha para cima.
- No `Drone FPV`, os comandos de subir/descer tambem empurram o pitch no mesmo sentido visual: segurar `subir` aponta o nariz para cima e permite continuar o giro ate fechar um loop vertical.
- No `Drone FPV`, ao virar para a direita/esquerda a camera deve inclinar para o mesmo lado da curva, sem herdar a leitura visual do parapente.
- Em telas touch, os comandos principais usam um joystick circular por arrasto no canto inferior: esquerda/direita controlam curva e os rotulos do eixo vertical acompanham o veiculo. No parapente, `cima = acelera` e `baixo = freia`; no drone, `cima = sobe` e `baixo = desce`. Diagonais combinam os dois eixos no mesmo gesto.
- No `Drone FPV`, o mesmo joystick circular continua ativo com a mesma leitura visual (`cima = subir`, `baixo = descer`), enquanto o `boost` permanece em um botao separado ao lado.
- `C` ou o botao de camera (📷) alterna entre a camera externa (terceira pessoa) e a visao do piloto (primeira pessoa). Na visao do piloto, a camera fica presa ao capacete sem atraso de posicao, herda a orientacao do modelo (inclina com a asa na curva e no pendulo) com leve olhar para baixo, e o near plane cai para 0.06 m para nao cortar as maos/batoques quando o freio e puxado perto do corpo (restaurado no modo externo). Apos o pouso, a camera orbital de pouso vale para os dois modos.
- No desktop, enquanto a visao do piloto estiver ativa, mover o mouse deve simular o piloto olhando com a cabeca. Esse olhar extra nao altera o rumo do voo e fica limitado a `180 graus` para cada lado no eixo horizontal e `90 graus` para cima/baixo no eixo vertical.
- No mobile, o joystick principal de voo deve usar uma versao reduzida em cerca de `50%` do tamanho anterior. Quando a camera estiver em primeira pessoa, um segundo joystick do mesmo tamanho aparece no canto inferior direito para controlar apenas o olhar da camera; ao soltar, a visao volta ao centro.
- No `Drone FPV`, a camera fica sempre em primeira pessoa e o toggle/botao de camera nao deve aparecer na interface.
- No mobile, quando `Parapente` estiver selecionado, o botao de camera deve subir e ficar acima dos controles touch para nao conflitar com os botoes de voo.
- No mobile, o radio deve sair do card do HUD e virar um controle touch proprio no canto inferior direito, menor que o joystick principal, no formato liga/desliga. Um toque liga a transmissao e outro toque desliga.
- A interface touch deve bloquear selecao de texto e callout nativo enquanto o jogador arrasta o joystick ou segura os comandos.
- O botao discreto de reinicio (`↻`) aparece durante a rodada e recarrega o prototipo para iniciar uma nova tentativa. Em telas touch, fica no canto superior para nao cobrir os comandos de virar, acelerar ou frear.

Os controles podem mudar durante a iteracao se a sensacao de voo pedir outro modelo.

## Controles apos pouso
Quando o jogador pousa, o parapente deixa de voar, mas os comandos continuam ativos para observacao:
- `A`/`D` ou setas esquerda/direita: orbitam a camera ao redor do local de pouso.
- `W`/`S` ou setas cima/baixo: aproximam ou afastam a camera.

## Movimento
- X/Z representam deslocamento horizontal.
- X/Z/Y passam a representar metros no mundo do jogo.
- A velocidade de trim do parapente e 38 km/h; o jogador varia entre ~26 km/h (freios) e ~55 km/h (barra) e, ao soltar, retorna suavemente ao trim. Na decolagem, a velocidade acelera do passo de rampa (~8 km/h) ate o trim.
- O drone usa um perfil separado de alto desempenho: nasce parado no ar (`0 km/h`), permanece em hover quando o jogador nao aciona `boost`, pode acelerar ate ~700 km/h com resposta de yaw bem mais agressiva, pitch continuo sem auto-level e subida/descida diretas nas setas verticais invertidas.
- A distancia no ranking e HUD e medida em linha reta entre o ponto de decolagem de cada participante e sua posicao atual, nao pelo caminho efetivamente percorrido.
- Y representa altitude absoluta em metros em relacao ao nivel do mar.
- A altura exibida como valor principal do parapente e a distancia vertical ate o terreno exatamente abaixo da posicao X/Z atual: `position.y - terrain.getHeightAt(position.x, position.z)`.
- O HUD tambem exibe a altitude absoluta em relacao ao nivel do mar para diferenciar as duas medidas.
- O afundamento segue uma curva polar de asa EN-B: ~1,45 m/s a 25 km/h, ~1,05 m/s no trim (planeio ~10:1) e ~2,3 m/s com barra cheia.
- Curvar custa altitude: a inclinacao (bank) derivada da taxa de curva e da velocidade aumenta o afundamento pelo fator de carga, calibrado para uma vela EN-B hot sem punir demais a subida em giro moderado dentro da termica. A inclinacao visual do parapente segue o bank real.
- O parapente deve sempre ter algum movimento para frente.
- O drone tambem mantem avanco continuo, mas a pilotagem deve ficar seca e direta, sem balanco/pendulo visual do parapente.
- Curvas devem ser suaves, progressivas e sem giro instantaneo ao pressionar ou soltar comando.
- A taxa de curva deve ser mais proxima de um parapente real, priorizando leitura e controle fino em vez de rotacao rapida estilo arcade.
- A curva ainda deve ser fechada o suficiente para permitir permanecer dentro de uma termica media.
- A camera deve ajudar a leitura de direcao e altitude.
- Em telas estreitas, a camera deve preservar um campo horizontal de visao suficiente para manter mapa e termicas legiveis em relacao ao desktop, sem alterar as regras de voo.
- A camera deve manter folga minima acima do terreno, inclusive no pre-voo e apos pouso, para evitar enquadramentos dentro da malha do relevo em montanhas altas.

## Termicas
Termicas sao colunas verticais invisiveis para a fisica, mas visiveis para o jogador por particulas, pontos subindo ou cilindros transparentes.

Quando a sessao online da rampa trouxer um catalogo autoritativo de termicas, o cliente deve usar exatamente essas colunas em vez de gerar novas termicas localmente para a rodada.

Regras iniciais:
- Quanto mais perto do centro da termica, maior a sustentacao. O perfil radial e gaussiano (forte no nucleo, ~6% na borda do raio) e existe um anel de descendencia entre 1,0 e ~1,65 raios, onde o ar desce (~30% da forca da termica).
- A forca cresce com a altura nos primeiros ~150 m acima do solo (termica desorganizada perto do chao) e enfraquece na faixa final antes do teto.
- Cada termica tem ciclo de vida (4 a 9 minutos): nasce fraca, atinge o auge e decai ate morrer; os visuais (coluna, particulas, nuvem) esmaecem junto. Termicas mortas sao substituidas por novas no corredor a frente do jogador.
- As forcas medias ficam entre ~1,8 e 3,2 m/s, com termicas "quentes" ocasionais podendo disparar bem acima da media e atingir ate 10 m/s no pico do nucleo.
- Cada rodada sorteia variacao de forca entre as termicas, com uma coluna podendo ficar mais forte que as demais.
- A sustentacao deve ser claramente mais alta no centro e cair em direcao as extremidades da coluna.
- Fora da termica, o parapente perde altitude constantemente.
- Dentro da termica, o parapente deve subir visualmente em relacao ao solo quando a sustentacao superar o sink.
- Locais podem desativar termicas. Em Sao Vicente/Itarare nao ha termicas no MVP; a sustentacao vem do vento na montanha.
- Termicas derivam junto com o vento na mesma escala horizontal aplicada ao parapente, representando a massa de ar em movimento.
- A representacao visual da coluna inclina levemente na direcao do vento para comunicar a deriva da massa de ar em relacao ao solo.
- As termicas usam diametros moderados para permitir permanecer enroscado mesmo com vento e taxa de curva realista.
- Conforme o piloto avanca, o jogo mantem novas termicas surgindo no corredor a frente da direcao de voo, com variacao de raio, forca e afastamento lateral.
- Quando existir rota com waypoints, esse corredor passa a seguir a perna ativa e as pernas seguintes do percurso, mantendo termicas tambem entre os TPs e ate o GOL.
- Termicas que ficam muito para tras podem ser removidas para manter o custo da cena controlado.
- O topo das termicas (base de nuvem) e configuravel por local de voo (`cloudBaseMeters`, padrao 2200 m acima do nivel do mar). Nos ultimos 650 m antes do teto, a sustentacao enfraquece gradualmente ate 2 m/s no centro do topo; acima do teto nao ha sustentacao.
- Cada termica exibe uma nuvem presa ao topo absoluto da coluna, ajudando o jogador a ler visualmente o limite de subida. A nuvem tem diametro aproximado de duas vezes o diametro da termica e usa volumes arredondados irregulares para ficar menos geometrica.
- A base de cada termica exibe a sustentacao maxima da coluna em m/s, para indicar ao jogador a velocidade de subida esperada no centro.

## Variometro
O variometro aparece no HUD em m/s e tambem emite bips quando o jogador esta subindo em uma termica. O som e destravado no primeiro gesto do usuario, incluindo o toque em iniciar voo no mobile, por restricao normal dos navegadores, e fica mais agudo, frequente, intenso e sustentado conforme a taxa de subida aumenta.

## Pontuacao e gamificacao
O MVP passa a usar uma pontuacao estilo cross-country simplificada:
- Pontos crescem com a distancia horizontal efetivamente voada e recebem bonus continuo pela velocidade sobre o solo acima do voo lento, recompensando quem avanca rapido sem transformar a fisica em arcade.
- A rota tem waypoints visiveis no mapa (`TP1`, `TP2` e `GOL`). Ao cruzar o raio do checkpoint em ordem, o participante recebe bonus fixo mais bonus de tempo; completar a rota sinaliza `GOL` no HUD.
- Quando a sessao online da rampa trouxer rota autoritativa, o cliente deve usar exatamente esses waypoints e os raios definidos pelo back-end.
- Em locais costeiros, a geracao da rota deve rejeitar waypoints cujo centro ou area util do cilindro caiam sobre o mar aberto; o sorteio tenta novos pontos em terra antes de aceitar a perna.
- Termicas fortes ou "quentes" pagam multiplicador de risco maior. Termicas normais pagam 1x, fortes pagam 1,5x e termicas raras/quentes pagam 2x nos pontos de subida.
- Entrar em uma nova termica valida sem pousar aumenta o combo de altitude (`2x`, `3x`, ate `5x`). O combo multiplica distancia, subida e waypoints, e zera para `1x` ao pousar ou colidir.
- O HUD mostra pontos, combo atual, proximo waypoint e o ultimo evento de pontuacao relevante.
- Ao ganhar um pacote relevante de pontos, o jogador recebe um card temporario com o valor ganho e uma fanfarra curta sintetizada ("tarantaran tara"). Pontos continuos de voo sao agrupados em blocos de 1000 pontos para evitar spam visual/sonoro; waypoints disparam feedback imediato.
- Ao cruzar o GOL, uma comemoracao abre uma unica vez por rodada: overlay com chuva de confete e um card com os principais dados do voo (local, pontuacao, tempo, distancia, altitude maxima, subida maxima, velocidade maxima sobre o solo, combo maximo e waypoints). O card pode ser compartilhado via Web Share API ou baixado como imagem PNG 1080x1350 (formato 4:5 para redes sociais); em navegadores sem compartilhamento de arquivos, o botao de compartilhar baixa a imagem. O jogo continua rodando atras do overlay e o botao "Continuar voando" fecha a comemoracao.

## HUD de instrumento
O HUD imita um instrumento de voo real (vario/GPS de parapente) com fundo escuro fosco e digitos monoespacados tabulares:
- Variometro em destaque com barra vertical colorida (verde subindo, vermelho em sink forte; afundamento normal de planeio fica neutro).
- Altitude sobre o nivel do mar e altura sobre o solo lado a lado.
- Velocidade sobre o solo, razao de planeio instantanea (velocidade horizontal / descida; "∞" quando subindo) e vento com seta relativa ao rumo (para cima = vento de cauda), usando o angulo relativo calculado pela fisica.
- Fita de bussola com marcas a cada 15 graus e pontos cardeais, deslizando conforme o rumo (marcador central amarelo).
- O assistente termico, quando ativo, deve aparecer em um card separado logo abaixo do instrumento principal para nao embaralhar altitude, vario e navegacao.
- Distancia da decolagem, pontuacao, combo, proximo waypoint e status/tempo em linhas discretas. O ranking fica em um cartao separado abaixo do instrumento.

## HUD mobile
Em telas estreitas o instrumento vira uma faixa unica e compacta no topo: vario, altura sobre o solo, velocidade, pontuacao, combo e proximo waypoint com a distancia ate ele aparecem em uma unica linha, enquanto status/tempo ficam sobrepostos em escala menor. A altitude sobre o nivel do mar, o vento, a fita de bussola, o planeio e a distancia desde a decolagem ficam ocultos. O assistente termico dedicado fica escondido fora da termica e reaparece em um card proprio logo abaixo da faixa apenas durante leitura ativa, sem reservar espaco fixo. O card de radio do HUD fica oculto no mobile porque a transmissao passa para um controle touch proprio no canto inferior direito em formato de toggle liga/desliga. Quando a visao do piloto estiver ativa no mobile, um joystick de camera do mesmo tamanho do joystick principal aparece abaixo do radio no lado direito e retorna a visao ao centro ao soltar. O ranking fica oculto durante o voo no mobile e reaparece quando a rodada termina para nao competir com a cena 3D e os controles touch. O painel inicial fica no canto superior da tela no mobile, afastado dos controles touch inferiores.

## Musica
Ao iniciar a rodada, uma trilha procedural de aventura mais animada toca em volume baixo durante o voo e para quando a rodada termina.

## Colisao entre parapentes
Quando dois parapentes colidem em voo, ambos entram em estado enroscado. Nesse estado, controles, termicas e trajetoria normal deixam de atuar; os dois giram próximos um do outro e descem juntos a 4 m/s ate tocar o terreno. Ao chegar ao solo, ambos pousam e saem da rodada.

## Vento
O vento e um vetor horizontal em X/Z.

Regras iniciais:
- Varia dinamicamente entre 8 km/h e 28 km/h por soma de ondas aperiodicas (massa de ar lenta + rajadas curtas), sem padrao repetitivo perceptivel.
- Gradiente de vento: junto ao solo o vento vale ~50% do vento de altitude, atingindo forca total ~220 m acima do relevo (perfil suave em raiz quadrada).
- Afeta a trajetoria do parapente pela soma vetorial continua entre velocidade propria no ar e vento (sem discretizacao em passos de angulo). Com vento de cauda, a velocidade sobre o solo aumenta; com vento de frente, diminui; em angulos intermediarios ha deriva lateral.
- O local escolhido pode definir a direcao base do vento. Em Sao Vicente, o vento inicial vem do quadrante sudeste/mar para o interior, com variacao menor que a configuracao padrao.
- O parapente deriva com o vento como parte da massa de ar, inclusive com componente lateral quando o vento nao esta alinhado ao rumo.
- Em Sao Vicente, o vento do mar gera lift orografico quando encontra terreno ascendente. A faixa util considera a encosta ate cerca de 50 m a frente no sentido do vento e enfraquece ate zerar por volta de 300 m acima da crista local.
- O lift orografico deve ser marcado visualmente de forma parecida com as termicas em legibilidade, mas como faixa de corrente ascendente, nao como cilindro. A faixa usa uma base alongada, uma parede translucida de ar subindo e rotulo de m/s nos pontos fortes da encosta.
- Move termicas ao longo do tempo.
- Pode mudar de direcao/intensidade em intervalos definidos.
- A interface exibe velocidade e direcao do vento no HUD, e a cena mostra marcadores 3D de direcao de vento proximos ao voo.
- Quando a sessao online da rampa trouxer configuracao autoritativa de vento, o cliente deve usar pelo menos a mesma direcao base, a mesma janela de variacao e a mesma fase-base da rodada para reduzir divergencia entre instancias.

## Terreno
O terreno deve ser baixo custo, procedural e legivel.

Regras iniciais:
- Usar heightmap gerado por ruido.
- Para teste offline/local, o arquivo `mapas/BRA_SUDESTE_HighRes.xcm` pode ser processado por `npm run process:xcm`. A saida em `mapas/processed/BRA_SUDESTE_HighRes/` contem tiles de relevo locais para carregamento progressivo em chunks, cobrindo todo o Sudeste do Brasil em vez de apenas Pedra Grande.
- O jogo usa o manifesto local processado como fonte ativa de terreno. A camada base e o relevo XCM em mesh propria, com camadas vetoriais locais renderizadas por cima para estradas, ferrovias, rios, areas de agua, areas urbanas e pontos de cidades/vilas.
- Os tiles `terrain-rgb` codificam altitude diretamente nos canais RGB; a leitura no navegador deve preservar os bytes originais para evitar alturas incorretas, paredes artificiais no relevo e decolagem em altitude errada.
- Em regioes costeiras, pixels NoData do DEM representam mar aberto; o jogo deve normalizar esses valores para nivel do mar e renderiza-los como agua, evitando buracos ou paredes verticais na costa.
- Em Sao Vicente, a terra baixa junto ao mar deve formar uma faixa de areia clara; entre a rodovia e o mar nao devem ser plantadas arvores ou vegetacao.
- A pasta `mapas/` deve manter apenas o XCM original usado como entrada de conversao e a saida consumida pelo jogo: `manifest.json`, `terrain-rgb/` e `vectors/`. Extracoes, RAW intermediario e pastas de inspecao sao regeneraveis e nao devem permanecer.
- A origem do mundo (`x=0`, `z=0`) e o ponto inicial do jogador ficam sobre o local de voo escolhido na tela inicial. Atibaia / Pedra Grande e o padrao.
- A escala horizontal do terreno e calculada a partir do world file do XCM e da latitude central do local escolhido, mantendo o deslocamento proporcional ao mapa real.
- Cada local pode ajustar a altura inicial do jogador sobre o terreno. Sao Vicente usa 180 m sobre o solo para compensar a largada costeira baixa no relevo.
- A camada de relevo usa uma paleta naturalista por altitude e inclinação: verdes de vegetação nas áreas suaves, tons oliva/terra nas áreas altas e cinza/bege nas encostas mais íngremes para sugerir solo ou rocha exposta.
- Sombreamento por curvatura (oclusão ambiente barata): fundos de vale ficam mais escuros e puxam para verde úmido de mata ciliar; cristas ficam levemente mais claras.
- O material do relevo tem normal map tileável de micro-relevo (copas/ondulação do solo) que reage à luz do sol, visível em voo baixo.
- Em locais costeiros (`hasSea`), o mar aberto é uma lâmina d'água reflexiva (reflexo do céu via envMap, roughness baixa) com normal map de ondulação animado; o plano acompanha o jogador com as ondas fixas no mundo, mais uma deriva lenta de correnteza. Lagos/represas (`water_area`) também usam material reflexivo.
- Estradas e ferrovias têm textura procedural mapeada ao longo da fita (UV em metros): rodovias com asfalto, bordas brancas e eixo amarelo tracejado; estradas médias com asfalto e eixo discreto; estradas de terra com barro e trilhas de rodagem; ferrovias com brita, dormentes e dois trilhos.
- Rótulos de cidades/vilas usam estilo overlay de GPS: texto branco com halo escuro, sem caixa de fundo.
- O carregamento online OpenStreetMap/Mapzen usado anteriormente esta desativado para nao misturar duas fontes de relevo.
- Nuvens de horizonte ficam distribuidas longe da origem e acima do relevo para reforcar a impressao de voo durante o enquadramento da camera.
- Evitar malha densa demais.
- Garantir que o jogador comece acima do terreno.
- Colisao e baseada em consulta de altura do terreno na posicao X/Z.

## Pouso
Ao tocar o terreno, o participante pousa e sai da rodada. Visualmente, o parapente deve aparecer no chao, com a vela achatada e deitada sobre o terreno, e o piloto deve ficar de pe ao lado da vela.

Quando o jogador escolhe `Drone FPV`, o contato com terreno, arvores e outros participantes continua encerrando a rodada pelas mesmas regras de colisao.

Regras de qualidade do pouso:
- Tocar o solo descendo a 3 m/s ou mais rapido, ou voando a 48 km/h ou mais, conta como colisao ("Colidiu" no HUD e ranking).
- Segurar o freio (`S`) a menos de ~7 m do solo executa o flare: uma reserva unica de energia amortece o afundamento por ~1,4 s, permitindo pouso suave.
- Cair enroscado apos colisao em voo tambem conta como colisao.
- Encostar em uma arvore em voo conta como colisao: o participante cai, marca `crashed` e sai da rodada.

## Modo realista
No painel de camadas ha o toggle "Modo realista (sem ajudas)": esconde colunas, aneis, particulas e rotulos de m/s das termicas, os marcadores de lift orografico e as setas 3D de vento. Ficam apenas os sinais reais de um voo: nuvens cumulus no topo das termicas, sombras de nuvem, passaros circulando e o variometro. A fisica nao muda.

## Referencia visual do parapente
Jogador e bots usam somente o asset 3D `image/nova-vortex.obj`, baixado do configurador publico da NOVA VORTEX para avaliacao local de teste. Ele nao deve ser tratado como asset licenciado para distribuicao ou publicacao sem autorizacao da NOVA. O OBJ atual nao referencia material externo, entao o prototipo aplica material proprio via Three.js. Cada participante usa a mesma escala e configuracao visual, mudando apenas a cor principal da vela. Se o OBJ nao carregar, a vela procedural continua como fallback.

Em dispositivos offline ou com falha de rede apos a pagina abrir, o jogo nao deve tentar baixar repetidamente o OBJ. Nessa situacao, todos os parapentes permanecem jogaveis com a vela procedural e o console registra no maximo um aviso por URL de asset.

As linhas de suspensao sao procedurais e usam estacoes espelhadas a partir do centro da vela, alinhadas ao span e offset do OBJ atual. Todas as linhas conectam diretamente a vela aos pontos de harness do piloto. Quando o OBJ da NOVA termina de carregar, o prototipo mapeia os vertices transformados da vela e reposiciona cada ancoragem para a area inferior real mais proxima da malha, deixando as linhas conectadas ao parapente e com comprimentos diferentes entre centro e pontas.

A pasta `image/` deve manter apenas assets carregados pelo sistema em runtime.

## Bots
Bots sao competidores simples, nao adversarios inteligentes.

Comportamento (maquina de estados):
- **Transicao**: escolher a termica utilizavel mais proxima (viva e abaixo do teto) e voar ate ela a ~42 km/h.
- **Subida**: dentro do raio, circular em orbita (~45% do raio do nucleo, sentido sorteado por bot) a ~34 km/h ate ~120 m abaixo do teto.
- **Saida**: perto do teto ou quando a termica esta morrendo, escolher a proxima termica e voltar a transicao.
- Usar a mesma fisica geral do jogador (polar, sink em curva, gradiente de vento).
- Ao colidir com o terreno, pousar e sair da rodada.
- Manter alguns parapentes visiveis voando durante a cena; os bots continuam voando como trafego visual quando o jogador pousa, desde que o tempo da rodada nao tenha encerrado.

## Ranking
O ranking final deve ser simples e legivel.

Ordem atual:
1. Maior pontuacao total.
2. Participantes ainda voando ficam acima dos pousados em caso de empate.
3. Maior altura sobre o terreno exatamente abaixo do participante.
4. Maior distancia percorrida.

Essa regra pode ser ajustada depois que o loop estiver jogavel.
