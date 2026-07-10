# Diretrizes Para IA

## Como trabalhar neste projeto
- Antes de implementar, ler `plano.md` e os arquivos em `docs/`.
- Preservar o escopo do MVP, evitando adicionar multiplayer, contas, skins ou backend complexo antes da validacao do voo.
- Para colaboracao open source, seguir `CONTRIBUTING.md` e consultar `docs/contribution-tasks.md`.
- Tratar multiplayer ao vivo como trilha pos-MVP ate existir decisao explicita para integrar backend ao produto principal.
- Priorizar pequenas entregas verificaveis.
- Manter a estrutura modular descrita em `docs/architecture.md`.
- Nao introduzir assets externos obrigatorios sem necessidade.
- Nao substituir a fisica manual por motor de fisica sem justificativa forte.
- Registrar toda alteracao funcional, visual ou estrutural na documentacao pertinente do projeto.

## Criterios de qualidade
- O jogo deve abrir localmente no navegador.
- O loop principal deve permanecer simples de entender.
- Cada modulo deve ter responsabilidade clara.
- Controles e camera devem ser ajustaveis por constantes.
- O terreno precisa ter consulta de altura confiavel para colisao.
- O HUD deve refletir o estado real da rodada.

## Quando tomar decisoes
- Se houver duvida entre realismo e diversao, escolher diversao para o MVP.
- Se houver duvida entre visual elaborado e desempenho, escolher desempenho.
- Se houver duvida entre arquitetura complexa e codigo direto, escolher codigo direto ate o prototipo provar a mecanica.

## Proibido nesta fase
- Implementar multiplayer real.
- Criar sistema de login.
- Criar economia, loja ou skins.
- Depender de modelos 3D externos para o jogo rodar.
- Adicionar framework frontend pesado sem necessidade.

## Permitido como preparacao pos-MVP
- Criar issues de pesquisa sobre multiplayer ao vivo.
- Documentar arquitetura, protocolo e riscos de sincronizacao.
- Criar prototipos isolados que nao sejam dependencia obrigatoria do MVP local.
- Discutir WebSockets/Socket.io sem integrar backend permanente ao loop principal.

## Verificacao recomendada apos alteracoes
- Rodar instalacao e servidor local.
- Abrir o jogo no navegador.
- Confirmar que a cena renderiza.
- Confirmar ausencia de erros no console.
- Confirmar que o jogador se move e nao atravessa o terreno sem tratamento.
- Confirmar que camera, HUD, termicas e bots continuam funcionando apos mudancas.

## Documentacao apos alteracoes
- Mudancas de regra, controle, camera ou comportamento devem atualizar `docs/game-design.md`.
- Mudancas de modulo, arquivo ou responsabilidade devem atualizar `docs/architecture.md`.
- Mudancas de processo ou regra de colaboracao com IA devem atualizar `AGENTS.md` ou este arquivo.
