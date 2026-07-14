# Plano Completo - Radio por Voz por Rampa

## Objetivo
Adicionar comunicacao por voz estilo radio ao jogo, limitada a uma rampa por vez, com transmissao `push-to-talk` e somente um locutor ativo por canal.

## Regras de produto
- Cada rampa tem um canal de radio proprio.
- Apenas jogadores presentes e voando naquela rampa podem ouvir o canal.
- O jogador segura um botao para falar e solta para encerrar.
- Apenas um jogador por vez pode ocupar o canal.
- Se o canal estiver ocupado, os demais veem o estado `Radio ocupado`.
- A transmissao termina ao soltar o botao, ao perder conexao, ao sair da sessao ou ao atingir timeout.
- O MVP do radio nao inclui gravacao, fila de espera, audio espacial nem canais privados.

## Estrategia tecnica recomendada
- Usar `WebSocket` apenas para controle e sinalizacao.
- Usar `WebRTC` para carregar o audio do microfone.
- Centralizar no servidor a autoridade sobre `quem esta com o canal`.
- Inicialmente suportar um transmissor e varios ouvintes por rampa.
- Tratar `TURN` como dependencia obrigatoria da fase de implantacao real, mesmo que o prototipo local rode sem ele em algumas redes.

## Definicao de concluido
Cada etapa abaixo deve ter o campo `Status` alterado de `pendente` para `concluido` quando terminar.

Exemplo:
- `Status: pendente`
- `Status: concluido`

---

## Etapa 0 - Planejamento consolidado
Status: concluido

### Entregas
- Documento de arquitetura e execucao do radio por voz.
- Lista de etapas com dependencias e criterio de aceite.
- Escopo inicial reduzido para half-duplex por rampa.

### Criterio de aceite
- Equipe consegue saber o que falta no back-end, no front-end e na implantacao.

---

## Etapa 1 - Contrato funcional e estados do radio
Status: concluido

### Objetivo
Fechar o comportamento oficial do radio antes de escrever codigo.

### Entregas
- Maquina de estados do canal:
  - `idle`
  - `requesting`
  - `granted`
  - `broadcasting`
  - `releasing`
  - `occupied`
  - `error`
- Maquina de estados do cliente:
  - `disconnected`
  - `connected`
  - `mic_blocked`
  - `ready`
  - `transmitting`
  - `listening`
- Politicas de produto:
  - timeout maximo por transmissao
  - comportamento ao desconectar
  - comportamento ao pousar ou encerrar rodada
  - comportamento em mobile

### Decisoes recomendadas
- Timeout de transmissao: `30s`.
- Sem fila na primeira versao.
- Jogador pousado continua ouvindo somente se continuar presente na sessao.
- Push-to-talk com suporte a mouse, touch e teclado.

### Transicoes fechadas do canal
- `idle -> requesting`: jogador apto pressiona o botao de falar.
- `requesting -> granted`: servidor concede o canal ao jogador solicitante.
- `granted -> broadcasting`: cliente local com concessao ativa publica o audio.
- `broadcasting -> releasing`: jogador solta o botao ou o cliente inicia cleanup.
- `releasing -> idle`: servidor confirma liberacao ou a sessao volta a livre.
- `idle -> occupied`: outro jogador recebe a concessao.
- `occupied -> idle`: locutor libera, desconecta ou sofre timeout.
- `qualquer estado -> error`: permissao negada, microfone indisponivel ou sinalizacao invalida.

### Transicoes fechadas do cliente
- `disconnected -> connected`: WebSocket da sessao ficou disponivel.
- `connected -> ready`: microfone autorizado e sessao pronta para transmitir.
- `connected -> mic_blocked`: navegador negou ou perdeu permissao.
- `ready -> transmitting`: servidor concede o canal ao proprio jogador.
- `ready -> listening`: outro jogador ocupa o canal da rampa.
- `listening -> ready`: canal volta a ficar livre.
- `transmitting -> ready`: transmissao termina com sucesso.
- `transmitting -> mic_blocked`: microfone falha durante a transmissao.

### Artefato de codigo desta etapa
- Modulo puro `src/radioState.js` com estados canonicos e redutor de transicoes para ser reutilizado nas etapas de protocolo, UI e WebRTC.

### Criterio de aceite
- Estados e transicoes documentados e sem ambiguidade.

---

## Etapa 2 - Arquitetura de rede e topologia
Status: pendente

### Objetivo
Definir a topologia final do audio e da sinalizacao.

### Abordagem recomendada
- Servidor atual continua sendo autoridade de sessao e presenca.
- Mesmo backend realtime passa a arbitrar o canal do radio por rampa.
- `WebRTC` transporta o audio.
- `STUN/TURN` fornece conectividade entre navegadores.

### Topologia inicial recomendada
- Um transmissor ativo.
- N ouvintes na mesma rampa.
- Sinalizacao passando pelo WebSocket existente ou por extensao dele.

### Decisoes de implementacao
- Modelo inicial: transmissor cria uma `RTCPeerConnection` por ouvinte.
- Limite operacional inicial: testar bem ate `8` ouvintes simultaneos por rampa.
- Se a escala real exceder esse ponto, reavaliar `SFU` no futuro.

### Criterio de aceite
- Equipe concorda com P2P com locutor unico para a primeira versao.

---

## Etapa 3 - Protocolo de mensagens realtime
Status: concluido

### Objetivo
Definir todas as mensagens entre cliente e servidor para controle do radio.

### Mensagens cliente -> servidor
- `radio_request_talk`
  - `launchId`
  - `playerId`
  - `requestedAt`
- `radio_release_talk`
  - `launchId`
  - `playerId`
  - `reason`
- `radio_offer`
  - `launchId`
  - `targetPlayerId`
  - `sdp`
- `radio_answer`
  - `launchId`
  - `targetPlayerId`
  - `sdp`
- `radio_ice_candidate`
  - `launchId`
  - `targetPlayerId`
  - `candidate`
- `radio_ping`
  - monitoracao opcional do canal de voz

### Mensagens servidor -> cliente
- `radio_talk_granted`
  - `launchId`
  - `speakerPlayerId`
  - `grantedAt`
  - `expiresAt`
- `radio_talk_denied`
  - `launchId`
  - `speakerPlayerId`
  - `reason`
- `radio_talk_released`
  - `launchId`
  - `speakerPlayerId`
  - `reason`
- `radio_state`
  - `launchId`
  - `status`
  - `speakerPlayerId`
  - `expiresAt`
- `radio_offer`
- `radio_answer`
- `radio_ice_candidate`
- `radio_force_stop`
  - usado em timeout, desconexao ou inconsistencia

### Regras do protocolo
- Apenas o servidor pode marcar o canal como `ocupado`.
- Apenas o jogador com concessao ativa pode enviar `offer`.
- Ouvintes ignoram sinalizacao de locutor nao autorizado.
- Toda mudanca de estado deve refletir no snapshot de sessao.

### Criterio de aceite
- Mensagens cobrem fluxo feliz, erro, timeout e desconexao.

### Implementacao realizada
- Mensagens `radio_request_talk`, `radio_release_talk`, `radio_offer`, `radio_answer` e `radio_ice_candidate` implementadas no gateway realtime.
- Mensagens `radio_talk_granted`, `radio_talk_denied`, `radio_talk_released` e `radio_force_stop` implementadas no broadcast do servidor.
- Cliente realtime do front atualizado para encaminhar todas as mensagens `radio_*`.

---

## Etapa 4 - Modelo de dados e estado de sessao no back-end
Status: concluido

### Objetivo
Adicionar o estado do radio na sessao da rampa.

### Estrutura sugerida
```js
radio: {
  status: 'idle' | 'occupied',
  speakerPlayerId: string | null,
  grantedAt: string | null,
  expiresAt: string | null,
  listenersCount: number,
  generation: number
}
```

### Regras
- `generation` incrementa a cada nova ocupacao do canal.
- `expiresAt` impede canal preso.
- Ao sair da sessao, se `speakerPlayerId` for o locutor atual, o canal e liberado.
- Em reconexao, o cliente confia no `radio_state` do servidor.

### Criterio de aceite
- O estado do radio existe no bundle da sessao e no realtime.

### Implementacao realizada
- Campo `radio` adicionado ao schema da sessao.
- Normalizacao, serializacao e persistencia do estado `radio` implementadas em `gameService`.

---

## Etapa 5 - Infraestrutura e backend base
Status: concluido

### Objetivo
Preparar o servidor para arbitrar o canal de radio.

### Back-end
- Estender o servidor realtime para:
  - validar `radio_request_talk`
  - conceder ou negar posse do canal
  - replicar `radio_state`
  - liberar canal em timeout
  - liberar canal em `leave`, `disconnect` e erro
- Garantir que so participantes da mesma rampa troquem sinalizacao de radio.
- Adicionar logs estruturados para eventos:
  - request
  - grant
  - deny
  - release
  - timeout
  - force_stop

### Seguranca
- Validar `playerId` contra o token da sessao.
- Recusar mensagens para `launchId` divergente.
- Limitar spam de `radio_request_talk`.

### Criterio de aceite
- Servidor consegue arbitrar corretamente um unico locutor por rampa.

### Implementacao realizada
- `GameRealtimeGateway` passou a arbitrar um unico locutor por rampa.
- Liberacao automatica em `leave`, `disconnect` e `timeout` implementada.
- Testes automatizados do gateway cobrindo concessao, negacao e liberacao do canal adicionados no backend.

---

## Etapa 6 - Infraestrutura WebRTC
Status: pendente

### Objetivo
Adicionar a base de audio em tempo real entre navegadores.

### Back-end
- Configurar servidores `STUN`.
- Configurar `TURN` com credenciais rotativas ou temporarias.
- Expor configuracao ICE ao cliente via endpoint seguro ou bundle de runtime.

### Front-end
- Criar modulo `src/radioVoiceClient.js`.
- Criar fabrica de `RTCPeerConnection`.
- Implementar fluxo de:
  - capturar microfone
  - criar track de audio
  - gerar `offer`
  - receber `answer`
  - trocar `ICE candidates`
- Encerrar todas as conexoes e tracks ao soltar o botao.

### Criterio de aceite
- Dois navegadores conseguem estabelecer audio 1:1 via sinalizacao do jogo.

---

## Etapa 7 - Captura de microfone e permissao
Status: concluido

### Objetivo
Controlar acesso ao microfone de forma segura e previsivel.

### Front-end
- Pedir permissao so na primeira tentativa de falar.
- Mostrar estados:
  - `Microfone pronto`
  - `Permissao negada`
  - `Microfone indisponivel`
  - `Radio ocupado`
  - `Transmitindo`
  - `Ouvindo <nome>`
- Permitir retry de permissao.
- Interromper captura quando a transmissao terminar.

### Detalhes tecnicos
- Comecar com `audio: true`, sem video.
- Avaliar constraints simples:
  - `echoCancellation: true`
  - `noiseSuppression: true`
  - `autoGainControl: true`

### Criterio de aceite
- Fluxo de permissao funciona em desktop e mobile suportados.

### Implementacao realizada
- Cliente `radioVoiceClient` pede microfone sob demanda.
- Estados `mic_ready` e `mic_denied` conectados a `radioState`.
- O fluxo de retry de permissao fica disponivel pelo proprio botao do radio.

---

## Etapa 8 - Interface de radio no front-end
Status: concluido

### Objetivo
Adicionar a interface visivel e os controles do radio.

### Front-end
- Inserir botao `Segure para falar` no HUD.
- Adicionar fallback por teclado, por exemplo tecla `R`.
- Exibir indicador de ocupacao do canal.
- Exibir nome do locutor atual.
- Exibir cronometro regressivo da transmissao atual.
- Exibir estados de erro sem bloquear o resto do jogo.

### UX recomendada
- Botao grande no mobile.
- Estado pressionado muito evidente.
- Feedback sonoro curto opcional ao ganhar ou perder o canal.
- Impedir toggle; deve ser press-and-hold real.

### Criterio de aceite
- Usuario consegue entender se vai falar, se o radio esta ocupado e quem esta transmitindo.

### Implementacao realizada
- HUD agora mostra card de radio, nome do locutor e botao `Segure para falar`.
- Push-to-talk por mouse, touch e tecla `R` implementado no cliente.
- Estados de `radio livre`, `solicitando`, `transmitindo`, `ocupado` e `microfone bloqueado` ligados ao HUD.

---

## Etapa 9 - Integracao com audio local do jogo
Status: pendente

### Objetivo
Fazer o radio coexistir com musica, fanfarra e variometro.

### Front-end
- Criar mixagem simples entre:
  - audio do radio
  - variometro
  - musica
  - fanfarra
- Reduzir musica enquanto houver transmissao de radio.
- Manter o variometro audivel, mas menos agressivo, durante escuta.
- Garantir cleanup completo de nodes e tracks.

### Observacao
- O jogo ja possui infraestrutura local em `src/audio.js`; a integracao deve preservar o comportamento atual quando nao houver radio.

### Criterio de aceite
- O radio permanece inteligivel sem destruir o feedback sonoro do jogo.

---

## Etapa 10 - Regras de ciclo de vida do radio
Status: pendente

### Objetivo
Tratar todos os eventos que podem prender ou quebrar o canal.

### Regras
- Soltou o botao: encerra transmissao.
- Timeout: servidor envia `radio_force_stop`.
- Mudou de rampa: encerra transmissao e limpa peers.
- Perdeu WebSocket: encerra transmissao localmente.
- Fechou aba: servidor libera canal por desconexao.
- Perdeu permissao do microfone: encerra transmissao e mostra erro.
- Rodada encerrada: decidir se o radio segue pela sessao ou para com a rodada.

### Recomendacao inicial
- O radio segue vinculado a presenca na rampa, nao ao estado da rodada.

### Criterio de aceite
- Nao existe cenario conhecido em que o canal fique preso indefinidamente.

---

## Etapa 11 - Observabilidade e ferramentas operacionais
Status: pendente

### Objetivo
Ter visibilidade de erros de voz em ambiente real.

### Back-end
- Logar:
  - requests de fala
  - grants
  - denies
  - duracao da fala
  - desconexoes
  - timeout
- Expor metricas basicas:
  - quantidade de sessoes com radio
  - tentativas de falar
  - tempo medio de ocupacao
  - falhas de sinalizacao

### Front-end
- Criar debug opcional semelhante ao `audioDebug`.
- Exibir:
  - estado do microfone
  - estado do canal
  - quantidade de peers
  - ultimo erro WebRTC

### Criterio de aceite
- Equipe consegue diagnosticar problemas sem inspecao cega.

---

## Etapa 12 - Testes manuais e automatizados
Status: pendente

### Objetivo
Validar a funcionalidade ponta a ponta.

### Testes manuais minimos
- Dois jogadores na mesma rampa, um fala e outro ouve.
- Soltar o botao encerra em menos de 1 segundo.
- Jogador B nao consegue falar enquanto A transmite.
- Desconectar o locutor libera o canal.
- Negar permissao de microfone nao quebra a sessao.
- Mudar de rampa limpa estado do radio.
- Mobile touch press-and-hold funciona.

### Testes de regressao
- HUD continua funcional.
- WebSocket de snapshots continua funcional.
- Jogadores remotos continuam sendo exibidos.
- Audio do jogo continua funcionando sem radio.

### Automatizacao recomendada
- Testes unitarios de maquina de estados.
- Testes de integracao do protocolo realtime.
- Harness manual com duas abas e latencia simulada.

### Criterio de aceite
- Casos principais passam de forma consistente.

---

## Etapa 13 - Implantacao de ambiente de teste
Status: pendente

### Objetivo
Subir um ambiente real para validar conectividade.

### Back-end
- Publicar servidor realtime com suporte a sinalizacao do radio.
- Publicar configuracao ICE do ambiente.
- Garantir HTTPS e WSS.

### Infra
- Provisionar `TURN`.
- Definir segredos e rotacao.
- Definir limites iniciais de uso.

### Front-end
- Consumir configuracao do ambiente sem hardcode sensivel.

### Criterio de aceite
- Dois usuarios em redes diferentes conseguem testar o radio.

### Implementacao parcial ja pronta
- O backend ja expoe `GET /api/game/runtime-config` com `radioEnabled` e `iceServers`.
- O front ja consome essa configuracao em runtime e aplica `window.__GAME_WEBRTC_ICE_SERVERS`.

---

## Etapa 14 - Beta fechado e ajustes
Status: pendente

### Objetivo
Testar com usuarios reais antes de abrir amplamente.

### Checklist
- Testar desktop Chrome.
- Testar Android Chrome.
- Testar iPhone Safari.
- Medir:
  - tempo de concessao do canal
  - tempo de inicio do audio
  - falhas de permissao
  - falhas ICE
- Ajustar timeout, textos e posicionamento do botao.

### Criterio de aceite
- Fluxo basico funciona para a maioria dos testers sem suporte manual.

---

## Etapa 15 - Liberacao controlada
Status: pendente

### Objetivo
Liberar a feature com baixo risco.

### Estrategia recomendada
- Feature flag por ambiente.
- Feature flag por rampa ou por percentual de sessoes.
- Rollback simples: desligar o radio mantendo resto do realtime ativo.

### Criterio de aceite
- Feature pode ser ativada e desativada sem afetar voo, HUD e presenca.

### Implementacao parcial ja pronta
- Feature flag de runtime `radioEnabled` ja integrada ao cliente.
- Variavel de ambiente `GAME_RADIO_ENABLED` ja integrada ao backend.

---

## Backlog futuro apos a primeira versao
- Fila de espera para falar.
- Som de entrada e saida de transmissao.
- Indicador visual de nivel de audio.
- Moderacao e bloqueio de abuso.
- Canais por equipe ou grupo.
- Audio espacial opcional.
- Migracao para `SFU` se a quantidade de ouvintes por rampa crescer.

## Dependencias externas
- Backend realtime editavel.
- Provedor STUN/TURN.
- Ambiente HTTPS/WSS.
- Navegadores com suporte a WebRTC.

## Ordem recomendada de implementacao
1. Etapa 1 - Contrato funcional e estados do radio.
2. Etapa 2 - Arquitetura de rede e topologia.
3. Etapa 3 - Protocolo de mensagens realtime.
4. Etapa 4 - Modelo de dados e estado de sessao no back-end.
5. Etapa 5 - Infraestrutura e backend base.
6. Etapa 6 - Infraestrutura WebRTC.
7. Etapa 7 - Captura de microfone e permissao.
8. Etapa 8 - Interface de radio no front-end.
9. Etapa 9 - Integracao com audio local do jogo.
10. Etapa 10 - Regras de ciclo de vida do radio.
11. Etapa 11 - Observabilidade e ferramentas operacionais.
12. Etapa 12 - Testes manuais e automatizados.
13. Etapa 13 - Implantacao de ambiente de teste.
14. Etapa 14 - Beta fechado e ajustes.
15. Etapa 15 - Liberacao controlada.
