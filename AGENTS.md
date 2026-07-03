# AI Context - Minimal

## Projeto
Prototipo 3D local de jogo de parapente no navegador, estilo `.io`, sem multiplayer real no MVP.

## Objetivo do MVP
Validar a sensacao de voo em 3D com terreno procedural, termicas, vento, HUD, bots simples e ranking.

## Stack
- JavaScript, Three.js, Node.js, Express.
- Fisica manual simplificada.
- Terreno procedural com ruido Simplex/Perlin.

## Fora de escopo no MVP
- Multiplayer, WebSockets, login, contas, salas, skins, loja, deploy e modelos 3D obrigatorios.

## Regra de contexto
Nao carregue todos os documentos por padrao. Use `docs/context-index.md` para decidir quais arquivos abrir conforme a tarefa.

## Regra de documentacao
Toda alteracao funcional, visual ou estrutural deve ser registrada na documentacao pertinente do projeto.

## Prioridade
Cena 3D -> terreno -> voo -> camera -> termicas/vento -> HUD -> bots -> ranking.
