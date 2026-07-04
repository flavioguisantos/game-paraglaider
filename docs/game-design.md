# Design do Jogo

## Fantasia de jogo
O jogador pilota um parapente em terreno montanhoso, buscando colunas de ar quente para ganhar altitude e permanecer voando mais tempo que os competidores.

## Objetivo da rodada
Durante 3 minutos, ganhar altitude e percorrer distancia. Ao final, o ranking compara jogador e bots por desempenho.

## Controles iniciais
Antes da rodada, o jogador escolhe a cor principal do parapente em uma paleta ampliada e inicia o voo por um botao de tela.

- `W` ou seta para cima: acelerar o parapente ate 20% acima da velocidade padrao enquanto o comando estiver pressionado.
- `S` ou seta para baixo: frear o parapente ate 20% abaixo da velocidade padrao enquanto o comando estiver pressionado.
- `A` ou seta para esquerda: virar para esquerda.
- `D` ou seta para direita: virar para direita.
- Em telas touch, botoes sobrepostos no canto inferior replicam os mesmos comandos de acelerar, frear e virar para esquerda/direita.

Os controles podem mudar durante a iteracao se a sensacao de voo pedir outro modelo.

## Controles apos pouso
Quando o jogador pousa, o parapente deixa de voar, mas os comandos continuam ativos para observacao:
- `A`/`D` ou setas esquerda/direita: orbitam a camera ao redor do local de pouso.
- `W`/`S` ou setas cima/baixo: aproximam ou afastam a camera.

## Movimento
- X/Z representam deslocamento horizontal.
- X/Z/Y passam a representar metros no mundo do jogo.
- A velocidade padrao do parapente e 40 km/h, convertida internamente para 11,11 m/s ao aplicar deslocamento no mapa.
- O jogador pode variar a velocidade entre 32 km/h e 48 km/h enquanto mantem o comando pressionado; ao soltar, o parapente retorna suavemente para 40 km/h.
- A distancia acumulada no ranking e HUD e medida em metros reais de deslocamento horizontal.
- Y representa altitude absoluta em metros em relacao ao nivel do mar.
- A altura exibida como valor principal do parapente e a distancia vertical ate o terreno exatamente abaixo da posicao X/Z atual: `position.y - terrain.getHeightAt(position.x, position.z)`.
- O HUD tambem exibe a altitude absoluta em relacao ao nivel do mar para diferenciar as duas medidas.
- Fora de sustentacao, a taxa base de descida do parapente e 2 m/s.
- O parapente deve sempre ter algum movimento para frente.
- Curvas devem ser suaves, progressivas e sem giro instantaneo ao pressionar ou soltar comando.
- A taxa de curva deve ser mais proxima de um parapente real, priorizando leitura e controle fino em vez de rotacao rapida estilo arcade.
- A curva ainda deve ser fechada o suficiente para permitir permanecer dentro de uma termica media.
- A camera deve ajudar a leitura de direcao e altitude.

## Termicas
Termicas sao colunas verticais invisiveis para a fisica, mas visiveis para o jogador por particulas, pontos subindo ou cilindros transparentes.

Regras iniciais:
- Quanto mais perto do centro da termica, maior a sustentacao.
- Cada rodada sorteia variacao de forca entre as termicas, com uma coluna podendo ficar mais forte que as demais.
- A sustentacao deve ser claramente mais alta no centro e cair em direcao as extremidades da coluna.
- Fora da termica, o parapente perde altitude constantemente.
- Dentro da termica, o parapente deve subir visualmente em relacao ao solo quando a sustentacao superar o sink.
- Termicas se deslocam lentamente com o vento.
- As termicas iniciais usam diametros menores para ficarem mais proporcionais ao mapa real e ao voo em 40 km/h.
- Conforme o piloto avanca, o jogo mantem novas termicas surgindo no corredor a frente da direcao de voo, com variacao de raio, forca e afastamento lateral.
- Termicas que ficam muito para tras podem ser removidas para manter o custo da cena controlado.
- Termicas nao precisam ter limite vertical no MVP.

## Variometro
O variometro aparece no HUD em m/s e tambem emite bips quando o jogador esta subindo em uma termica. O som so toca depois do primeiro gesto do usuario, por restricao normal dos navegadores, e fica mais agudo, frequente, intenso e sustentado conforme a taxa de subida aumenta.

## HUD mobile
Em telas estreitas, os dados de voo sao priorizados em formato compacto: tempo, altura sobre o solo, variometro e velocidade aparecem como metricas principais; altitude em relacao ao nivel do mar, distancia e status ficam como metricas secundarias. O ranking fica oculto durante o voo no mobile e reaparece quando a rodada termina para nao competir com a cena 3D e os controles touch.

## Musica
Ao iniciar a rodada, uma trilha procedural de aventura mais animada toca em volume baixo durante o voo e para quando a rodada termina.

## Colisao entre parapentes
Quando dois parapentes colidem em voo, ambos entram em estado enroscado. Nesse estado, controles, termicas e trajetoria normal deixam de atuar; os dois giram próximos um do outro e descem juntos a 4 m/s ate tocar o terreno. Ao chegar ao solo, ambos pousam e saem da rodada.

## Vento
O vento e um vetor horizontal em X/Z.

Regras iniciais:
- Afeta levemente a trajetoria do parapente.
- Move termicas ao longo do tempo.
- Pode mudar de direcao/intensidade em intervalos definidos.
- A interface pode exibir uma pequena bussola ou texto de direcao depois do HUD basico.

## Terreno
O terreno deve ser baixo custo, procedural e legivel.

Regras iniciais:
- Usar heightmap gerado por ruido.
- Para teste offline/local, o arquivo `mapas/BRA_SUDESTE_HighRes.xcm` pode ser processado por `npm run process:xcm`. A saida em `mapas/processed/BRA_SUDESTE_HighRes/` contem tiles de relevo locais para carregamento progressivo em chunks, cobrindo todo o Sudeste do Brasil em vez de apenas Pedra Grande.
- O jogo usa o manifesto local processado como fonte ativa de terreno. A camada base e o relevo XCM em mesh propria, com camadas vetoriais locais renderizadas por cima para estradas, ferrovias, rios, areas de agua, areas urbanas e pontos de cidades/vilas.
- A pasta `mapas/` deve manter apenas o XCM original usado como entrada de conversao e a saida consumida pelo jogo: `manifest.json`, `terrain-rgb/` e `vectors/`. Extracoes, RAW intermediario e pastas de inspecao sao regeneraveis e nao devem permanecer.
- A origem do mundo (`x=0`, `z=0`) e o ponto inicial do jogador ficam sobre a Pedra Grande em Atibaia.
- A escala horizontal do terreno e calculada a partir do world file do XCM e da latitude central. Na regiao de Atibaia, cada pixel do relevo representa cerca de 85 m em longitude por 92 m em latitude, mantendo o deslocamento proporcional ao mapa real.
- A camada de relevo usa uma paleta naturalista por altitude e inclinação: verdes de vegetação nas áreas suaves, tons oliva/terra nas áreas altas e cinza/bege nas encostas mais íngremes para sugerir solo ou rocha exposta.
- O carregamento online OpenStreetMap/Mapzen usado anteriormente esta desativado para nao misturar duas fontes de relevo.
- Evitar malha densa demais.
- Garantir que o jogador comece acima do terreno.
- Colisao e baseada em consulta de altura do terreno na posicao X/Z.

## Pouso
Ao tocar o terreno, o participante pousa e sai da rodada. Visualmente, o parapente deve aparecer no chao, com a vela achatada e deitada sobre o terreno, e o piloto deve ficar de pe ao lado da vela.

## Referencia visual do parapente
Jogador e bots usam somente o asset 3D `image/nova-vortex.obj`, baixado do configurador publico da NOVA VORTEX para avaliacao local de teste. Ele nao deve ser tratado como asset licenciado para distribuicao ou publicacao sem autorizacao da NOVA. O OBJ atual nao referencia material externo, entao o prototipo aplica material proprio via Three.js. Cada participante usa a mesma escala e configuracao visual, mudando apenas a cor principal da vela. Se o OBJ nao carregar, a vela procedural continua como fallback.

Em dispositivos offline ou com falha de rede apos a pagina abrir, o jogo nao deve tentar baixar repetidamente o OBJ. Nessa situacao, todos os parapentes permanecem jogaveis com a vela procedural e o console registra no maximo um aviso por URL de asset.

As linhas de suspensao sao procedurais e usam estacoes espelhadas a partir do centro da vela, alinhadas ao span e offset do OBJ atual. Todas as linhas conectam diretamente a vela aos pontos de harness do piloto. Quando o OBJ da NOVA termina de carregar, o prototipo mapeia os vertices transformados da vela e reposiciona cada ancoragem para a area inferior real mais proxima da malha, deixando as linhas conectadas ao parapente e com comprimentos diferentes entre centro e pontas.

A pasta `image/` deve manter apenas assets carregados pelo sistema em runtime.

## Bots
Bots sao competidores simples, nao adversarios inteligentes.

Comportamento inicial:
- Encontrar termica mais proxima.
- Virar gradualmente na direcao dela.
- Usar a mesma fisica geral do jogador.
- Ao colidir com o terreno, pousar e sair da rodada.
- Manter alguns parapentes visiveis voando durante a cena; os bots continuam voando como trafego visual quando o jogador pousa, desde que o tempo da rodada nao tenha encerrado.

## Ranking
O ranking final deve ser simples e legivel.

Ordem inicial sugerida:
1. Participantes ainda voando ficam acima dos pousados.
2. Maior altura sobre o terreno exatamente abaixo do participante.
3. Maior distancia percorrida.

Essa regra pode ser ajustada depois que o loop estiver jogavel.
