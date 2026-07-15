# Runbook - Execucao das Pendencias do Radio por Voz

## Como usar
- Cada item deve ser marcado manualmente de `pendente` para `concluido`.
- Quando um item depender de evidencia, registre o resultado no campo `Evidencia`.
- Nao marque como `concluido` sem validar o comportamento real.

## Legenda de status
- `Status: pendente`
- `Status: concluido`

---

## Bloco 1 - Infraestrutura publicada

### Item 1.1 - Backend publicado com HTTPS/WSS
Status: pendente

Objetivo:
- Garantir que a API do jogo e o gateway realtime estejam acessiveis externamente.

Validar:
- `https://.../api/health`
- `https://.../api/game/runtime-config`
- `wss://.../api/game/realtime`

Evidencia:
- URL do ambiente
- print ou resposta dos endpoints

### Item 1.2 - Runtime config do radio respondendo
Status: pendente

Objetivo:
- Confirmar que o front recebe a configuracao do ambiente sem hardcode.

Validar:
- `GET /api/game/runtime-config` retorna:
  - `radioEnabled`
  - `iceServers`

Evidencia:
- payload JSON real retornado pelo ambiente

### Item 1.3 - Feature flag do radio ativada no ambiente de teste
Status: pendente

Objetivo:
- Liberar o radio apenas no ambiente de homologacao.

Validar:
- `GAME_RADIO_ENABLED=true`
- front exibe radio habilitado

Evidencia:
- valor configurado no ambiente
- confirmacao visual no cliente

### Item 1.4 - ICE servers configurados
Status: pendente

Objetivo:
- Garantir conectividade WebRTC em redes reais.

Validar:
- `GAME_WEBRTC_ICE_SERVERS` contem ao menos:
  - `STUN`
  - `TURN`

Evidencia:
- payload JSON configurado
- teste real passando com redes diferentes

---

## Bloco 2 - Teste tecnico ponta a ponta

### Item 2.1 - Dois jogadores na mesma rampa
Status: pendente

Objetivo:
- Confirmar presenca online e sessao compartilhada.

Validar:
- dois clientes aparecem na mesma rampa
- ambos veem a mesma sessao

Evidencia:
- nomes dos jogadores usados
- rampa usada

### Item 2.2 - Push-to-talk funcionando
Status: pendente

Objetivo:
- Confirmar transmissao half-duplex real.

Validar:
- jogador A segura o botao
- jogador B ouve
- ao soltar, o audio encerra rapidamente

Evidencia:
- navegador A
- navegador B
- resultado observado

### Item 2.3 - Exclusao de canal
Status: pendente

Objetivo:
- Confirmar que apenas um fala por vez.

Validar:
- A ocupando o canal
- B tentando falar
- B recebe `Radio ocupado`

Evidencia:
- comportamento observado

### Item 2.4 - Musica pausa durante transmissao
Status: pendente

Objetivo:
- Garantir intelligibilidade da voz.

Validar:
- musica para quando o canal fica ocupado
- musica volta quando o canal e liberado

Evidencia:
- resultado observado

---

## Bloco 3 - Casos de falha e cleanup

### Item 3.1 - Permissao de microfone negada
Status: pendente

Objetivo:
- Garantir que o jogo nao quebre sem microfone.

Validar:
- negar permissao
- HUD mostra estado de erro
- sessao continua viva

Evidencia:
- navegador usado
- mensagem mostrada

### Item 3.2 - Fechar aba do locutor
Status: pendente

Objetivo:
- Confirmar liberacao automatica do canal.

Validar:
- locutor fecha a aba
- outro jogador ve o canal liberado

Evidencia:
- tempo observado para liberar

### Item 3.3 - Perda de rede do locutor
Status: pendente

Objetivo:
- Confirmar cleanup por desconexao.

Validar:
- cortar rede do locutor
- canal volta a livre

Evidencia:
- comportamento observado

### Item 3.4 - Timeout de transmissao
Status: pendente

Objetivo:
- Confirmar `force stop`.

Validar:
- manter botao pressionado ate o timeout
- transmissao e encerrada
- canal libera

Evidencia:
- tempo real medido

### Item 3.5 - Troca de rampa
Status: pendente

Objetivo:
- Confirmar cleanup de peers e estado do radio.

Validar:
- mudar de rampa
- radio nao fica preso
- estado e peers antigos somem

Evidencia:
- comportamento observado

### Item 3.6 - Background/mobile
Status: pendente

Objetivo:
- Confirmar comportamento ao esconder a aba.

Validar:
- colocar app em background
- transmissao encerra

Evidencia:
- dispositivo usado
- resultado observado

---

## Bloco 4 - Observabilidade

### Item 4.1 - Debug do front
Status: pendente

Objetivo:
- Confirmar que o overlay ajuda a diagnosticar problemas.

Validar:
- abrir com `?radioDebug=1`
- conferir estados e erros do radio
- confirmar que o texto do overlay pode ser selecionado e copiado
- conferir o evento `broadcast_targets_resolved` para saber quantos ouvintes foram resolvidos antes de criar as ofertas WebRTC
- se houver `radio_offer` ou `radio_answer` sem audio, verificar no console se apareceu erro de `setRemoteDescription` ou `Invalid SDP line`
- se o canal for concedido mas nao houver `offer_created`, conferir no overlay os blocos `sessionPlayers`, `remotePlayers`, `remoteRanking` e o evento `broadcast_targets_retry`
- no fluxo atual, quem cria a oferta WebRTC e o ouvinte. Se houver grant remoto sem audio, conferir a sequencia `listen_remote_speaker_requested`, `listen_speaker_begin`, `listen_offer_creating`, `listen_offer_sent`, `offer_received`, `broadcast_track_added`, `answer_created`, `answer_received`, `remote_track` e `remote_audio_attached`
- se parar no lado do ouvinte, conferir `listen_offer_timeout`, `listen_local_description_timeout`, `listen_speaker_failed` e `listen_speaker_retry` com `signalingState`, `connectionState` e `iceConnectionState`
- se parar no lado do locutor, conferir `offer_received`, `broadcast_track_added` e `answer_created`; se esses eventos existirem mas nao houver audio, verificar ICE (`ice_sent` e `ice_received`) e a presenca de `remote_track`

Evidencia:
- captura do overlay

### Item 4.2 - Logs do backend
Status: pendente

Objetivo:
- Confirmar rastreabilidade dos eventos.

Validar:
- grants
- denies
- releases
- timeouts

Evidencia:
- linhas de log coletadas

### Item 4.3 - Registro de falhas reais
Status: pendente

Objetivo:
- Organizar a investigacao de problemas externos.

Registrar para cada falha:
- data
- navegador
- dispositivo
- tipo de rede
- sintoma
- log do backend
- estado do `radioDebug`

Evidencia:
- tabela ou issue consolidada

---

## Bloco 5 - Beta fechado

### Item 5.1 - Chrome desktop
Status: pendente

### Item 5.2 - Android Chrome
Status: pendente

### Item 5.3 - Safari iPhone
Status: pendente

### Item 5.4 - Teste em redes diferentes
Status: pendente

### Item 5.5 - Ajustes pos-beta
Status: pendente

Objetivo:
- Aplicar ajustes de UX, timeout e compatibilidade antes de liberar amplamente.

Evidencia:
- lista curta de problemas encontrados e resolvidos

---

## Bloco 6 - Liberacao controlada

### Item 6.1 - Habilitar por feature flag em homologacao
Status: pendente

### Item 6.2 - Habilitar para grupo pequeno
Status: pendente

### Item 6.3 - Validar estabilidade inicial
Status: pendente

### Item 6.4 - Liberacao ampla
Status: pendente

---

## Resultado final esperado
- Backend publicado e acessivel por HTTPS/WSS
- Runtime config respondendo corretamente
- STUN/TURN funcionando
- Dois jogadores em redes diferentes conseguem usar o radio
- Cleanup validado
- Beta fechado executado
- Liberacao controlada concluida
