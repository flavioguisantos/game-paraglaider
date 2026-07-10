# Lista de Tarefas Para Colaboradores

Use esta lista para criar issues pequenas e revisaveis. Cada tarefa deve apontar para uma area clara do projeto e, quando possivel, caber em um PR curto.

## Labels sugeridas

- `good first issue`
- `help wanted`
- `bug`
- `docs`
- `visual`
- `camera`
- `physics`
- `hud`
- `bots`
- `performance`
- `multiplayer`
- `research`
- `post-mvp`

## Boas primeiras issues

- Documentar controles atuais no README ou em `docs/game-design.md`.
- Adicionar checklist manual de validacao de voo.
- Melhorar texto de uma issue template.
- Revisar nomes e descricoes de constantes de camera ou voo sem alterar comportamento.
- Criar uma issue de referencia com prints do HUD atual.

## Camera e voo

- Ajustar suavizacao da camera em terceira pessoa.
- Reduzir tremor da camera em curvas fortes.
- Revisar parametros de sink e sustentacao para melhorar a sensacao de planeio.
- Criar presets de tuning para teste manual.
- Documentar como validar alteracoes de fisica sem quebrar o MVP.

## Terreno e visual

- Melhorar variacao de cor do terreno por altitude.
- Ajustar legibilidade de termicas em diferentes horarios/ceus.
- Otimizar materiais ou geometrias sem alterar regras de jogo.
- Investigar gargalos visuais em desktop e mobile.

## HUD e rodada

- Melhorar contraste do altimetro e variometro.
- Revisar estados de fim de rodada.
- Adicionar indicador claro de pouso ou colisao.
- Melhorar ranking final local.

## Bots e competicao local

- Ajustar comportamento dos bots perto de termicas.
- Evitar que bots fiquem presos em trajetorias repetitivas.
- Melhorar criterios do ranking local.
- Documentar limitacoes dos bots atuais.

## Multiplayer ao vivo pos-MVP

Estas tarefas devem ser tratadas como pesquisa, arquitetura ou prototipos isolados ate a sensacao de voo ser validada.

- Pesquisar opcoes para multiplayer ao vivo no navegador: WebSocket nativo, Socket.io ou servidor WebRTC/sinalizacao.
- Propor arquitetura cliente-servidor autoritativa para sincronizar posicao, rotacao, velocidade e estado de rodada.
- Definir taxa de update inicial para jogadores remotos e estrategia de interpolacao.
- Criar documento de protocolo de mensagens para entrada do jogador, snapshots de estado, eventos de pouso e ranking.
- Prototipar servidor minimo fora do loop principal do MVP, sem exigir login ou contas.
- Criar simulador local de latencia/perda de pacote para validar interpolacao.
- Planejar salas simples por codigo, sem matchmaking complexo.
- Avaliar custo de hospedagem e impacto no deploy atual como Static Site.
- Definir criterios para quando multiplayer ao vivo pode sair de `post-mvp` e entrar no produto principal.

## Fora de boas primeiras issues

- Reescrever a fisica inteira.
- Introduzir framework frontend pesado.
- Adicionar backend obrigatorio ao MVP.
- Implementar login, contas, loja ou skins.
- Substituir o jogo local por uma arquitetura online antes da validacao do voo.
