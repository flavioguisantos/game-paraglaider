# Design do Jogo

## Fantasia de jogo
O jogador pilota um parapente em terreno montanhoso, buscando colunas de ar quente para ganhar altitude e permanecer voando mais tempo que os competidores.

## Objetivo da rodada
Durante 3 minutos, ganhar altitude e percorrer distancia. Ao final, o ranking compara jogador e bots por desempenho.

## Controles iniciais
- `W` ou seta para cima: aumentar velocidade/inclinacao de avancar.
- `S` ou seta para baixo: reduzir velocidade/inclinacao.
- `A` ou seta para esquerda: virar para esquerda.
- `D` ou seta para direita: virar para direita.

Os controles podem mudar durante a iteracao se a sensacao de voo pedir outro modelo.

## Controles apos pouso
Quando o jogador pousa, o parapente deixa de voar, mas os comandos continuam ativos para observacao:
- `A`/`D` ou setas esquerda/direita: orbitam a camera ao redor do local de pouso.
- `W`/`S` ou setas cima/baixo: aproximam ou afastam a camera.

## Movimento
- X/Z representam deslocamento horizontal.
- Y representa altitude.
- O parapente deve sempre ter algum movimento para frente.
- Curvas devem ser suaves, nao instantaneas.
- A curva deve ser fechada o suficiente para permitir permanecer dentro de uma termica media.
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
- Termicas nao precisam ter limite vertical no MVP.

## Variometro
O variometro aparece no HUD em m/s e tambem emite bips quando o jogador esta subindo em uma termica. O som so toca depois do primeiro gesto do usuario, por restricao normal dos navegadores, e fica mais agudo e frequente conforme a taxa de subida aumenta.

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
- Evitar malha densa demais.
- Garantir que o jogador comece acima do terreno.
- Colisao e baseada em consulta de altura do terreno na posicao X/Z.

## Pouso
Ao tocar o terreno, o participante pousa e sai da rodada. Visualmente, o parapente deve aparecer no chao, com a vela achatada e deitada sobre o terreno, e o piloto deve ficar de pe ao lado da vela.

## Referencia visual do parapente
As imagens em `image/` sao referencias visuais. A referencia principal atual e `image/paraglidershots0006.jpg`, por mostrar melhor celulas infladas, arco da vela, borda de ataque, faixas e linhas. `image/stemcell_blender_cycles_render.jpg` e referencia secundaria para proporcao geral.

Jogador e bots usam o asset 3D `image/nova-vortex.obj`, baixado do configurador publico da NOVA VORTEX para avaliacao local de teste. Ele nao deve ser tratado como asset licenciado para distribuicao ou publicacao sem autorizacao da NOVA. O OBJ atual nao referencia material externo, entao o prototipo aplica material proprio via Three.js. Cada participante usa a mesma escala e configuracao visual, mudando apenas a cor principal da vela. Se o OBJ nao carregar, a vela procedural continua como fallback.

As linhas de suspensao do jogador sao procedurais e usam estacoes espelhadas a partir do centro da vela, alinhadas ao span e offset do OBJ atual. A vela fica mais afastada do piloto que no primeiro modelo, com separacao visual aumentada em aproximadamente 30% apos o ajuste inicial. Todas as linhas conectam diretamente a vela aos pontos de harness do piloto. Quando o OBJ da NOVA termina de carregar, o prototipo mapeia os vertices transformados da vela e reposiciona cada ancoragem para a area inferior real mais proxima da malha, deixando as linhas conectadas ao parapente e com comprimentos diferentes entre centro e pontas.

`image/nova-vortex.stl` e uma conversao binaria local do OBJ da NOVA para testes de compatibilidade. A conversao triangula as faces do OBJ e remove triangulos degenerados, mas nao preserva materiais ou UVs porque o formato STL armazena apenas geometria.

`image/nova-vortex-completo-piloto.stl` e uma exportacao local da configuracao visual completa para ajuste externo em ferramenta/IA 3D. O arquivo combina a vela NOVA, o piloto/harness procedural e as linhas de suspensao convertidas para tubos finos, ja que STL nao suporta linhas, materiais ou texturas.

Os arquivos STL em `image/` ficam como referencias e alternativas locais, mas nao sao mais o asset principal do jogador.

O diretorio `image/supair-savage2/` contem assets baixados do iframe publico `https://savage2.vercel.app/`, incorporado na pagina do produto SUPAIR SAVAGE 2. O arquivo original `supair-savage2.glb` veio criptografado, como no app publico; `supair-savage2-decrypted.glb` e a copia de teste local decriptada a partir da rotina executada pelo proprio cliente. As texturas do configurador tambem foram salvas na mesma pasta. Esses arquivos sao apenas para avaliacao local e nao devem ser distribuidos ou publicados sem autorizacao da SUPAIR.

## Bots
Bots sao competidores simples, nao adversarios inteligentes.

Comportamento inicial:
- Encontrar termica mais proxima.
- Virar gradualmente na direcao dela.
- Usar a mesma fisica geral do jogador.
- Ao colidir com o terreno, pousar e sair da rodada.

## Ranking
O ranking final deve ser simples e legivel.

Ordem inicial sugerida:
1. Participantes ainda voando ficam acima dos pousados.
2. Maior altitude.
3. Maior distancia percorrida.

Essa regra pode ser ajustada depois que o loop estiver jogavel.
