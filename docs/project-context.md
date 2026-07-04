# Contexto do Projeto

## Nome de trabalho
Jogo Parapente 3D

## Objetivo
Criar um prototipo 3D local, rodando no navegador, para validar a sensacao central de voo de parapente com termicas, vento, terreno procedural, competicao por altitude/distancia e bots simples.

## Pergunta de validacao
A sensacao de voar em 3D e boa o suficiente para jogar novamente por pelo menos 5 minutos?

## Escopo do MVP
- Terreno 3D procedural com colinas.
- Um parapente controlado pelo jogador.
- Camera em terceira pessoa, atras e acima do parapente, com suavizacao.
- Fisica simplificada feita a mao.
- Termicas como cilindros invisiveis que geram sustentacao, com representacao visual por particulas ou marcadores verticais.
- Vento com direcao e intensidade, afetando parapente e deslocando termicas.
- Dois bots que voam em direcao a termica mais proxima.
- HUD com altimetro, variometro, timer de 3 minutos e ranking final.
- Colisao simples com terreno: ao tocar o solo, o participante pousa e sai da rodada.

## Fora do MVP
- Multiplayer real.
- WebSockets ou Socket.io.
- Contas, salas, matchmaking, skins ou monetizacao.
- Modelos 3D finais, texturas finais e iluminacao avancada.
- Terreno com LOD, chunking ou otimizacoes complexas.

## Stack inicial
- JavaScript no navegador.
- Three.js para renderizacao 3D.
- Node.js apenas para scripts de build/conversao.
- Build estatico publicado como Static Site no Render.
- Fisica manual em vez de motor de fisica generico.
- Geracao procedural de terreno com Simplex/Perlin noise.

## Principios de implementacao
- Comecar simples, com geometria basica e sem assets externos obrigatorios.
- Priorizar sensacao de voo, camera e controles antes de expandir funcionalidades.
- Manter modulos pequenos e com responsabilidades claras.
- Evitar sistemas complexos ate o loop principal estar divertido.
- Toda nova feature deve preservar desempenho em navegador.

## Riscos principais
- Camera ruim pode fazer o jogo parecer ruim mesmo com mecanica correta.
- Fisica realista demais pode atrapalhar a diversao; o prototipo deve priorizar controle e leitura visual.
- Terreno pesado pode prejudicar desempenho.
- Bots nao precisam ser inteligentes no MVP, apenas suficientes para dar contexto competitivo.
