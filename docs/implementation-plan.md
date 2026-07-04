# Plano de Implementacao

## Status atual
- Fase 1: concluida.
- Fase 2: concluida.
- Fase 3: concluida.
- Fase 4: concluida.
- Fase 5: concluida.
- Fase 6: concluida.
- Fase 7: concluida.
- Proxima fase sugerida: validar jogabilidade e decidir a proxima fase do produto.

## Fase 1: Base tecnica - concluida
- [x] Criar `package.json`.
- [x] Criar build estatico sem backend permanente.
- [x] Criar `index.html`.
- [x] Criar `src/main.js` com cena Three.js, renderer, luz, camera temporaria e loop.
- [x] Validar que a cena abre localmente.

## Fase 2: Terreno - concluida
- [x] Criar `src/terrain.js`.
- [x] Gerar malha procedural com ruido.
- [x] Adicionar material simples e iluminacao basica.
- [x] Expor `getHeightAt(x, z)`.
- [x] Posicionar jogador acima do terreno.

## Fase 3: Jogador e camera - concluida
- [x] Criar `src/player.js`.
- [x] Criar modelo temporario de parapente com geometria simples.
- [x] Implementar controles.
- [x] Criar `src/camera.js` com terceira pessoa suavizada.
- [x] Iterar ate a camera e controles ficarem confortaveis.

## Fase 4: Fisica, termicas e vento - concluida
- [x] Criar `src/physics.js`.
- [x] Implementar sink constante.
- [x] Criar `src/thermal.js`.
- [x] Implementar sustentacao por distancia ao centro da termica.
- [x] Adicionar visualizacao de termicas.
- [x] Implementar vento e deslocamento das termicas.

## Fase 5: HUD e rodada - concluida
- [x] Criar `src/hud.js`.
- [x] Exibir altitude, variometro e timer.
- [x] Encerrar participacao ao tocar o terreno.
- [x] Encerrar rodada aos 3 minutos.

## Fase 6: Bots e ranking - concluida
- [x] Criar `src/bot.js`.
- [x] Adicionar 2 bots usando fisica semelhante ao jogador.
- [x] Implementar busca da termica mais proxima.
- [x] Exibir ranking final.

## Fase 7: Polimento do prototipo - concluida
- [x] Ajustar camera.
- [x] Ajustar velocidade, curva, sink e forca das termicas.
- [x] Melhorar legibilidade visual das termicas.
- [x] Fazer verificacao em desktop e mobile, se possivel.

## Deploy Render - preparado
- [x] Remover backend Express nao utilizado.
- [x] Criar `scripts/build-static.js`.
- [x] Criar `render.yaml` para Static Site.
- [x] Publicar `dist/` como saida de build.

## Ordem de prioridade
1. Cena 3D renderizando.
2. Terreno legivel.
3. Voo controlavel.
4. Camera agradavel.
5. Termicas funcionando.
6. HUD util.
7. Bots.
8. Ranking.
