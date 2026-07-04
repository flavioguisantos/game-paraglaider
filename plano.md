# Plano de Protótipo 3D — Jogo Multiplayer de Parapente (estilo .io)

## 1. Objetivo do protótipo
Validar a mecânica central (voo + térmicas + competição por altitude/distância) já em 3D, com câmera em terceira pessoa seguindo o parapente sobre um terreno. Roda localmente no navegador, sem backend de multiplayer ainda.

## 2. Por que 3D muda o jogo (avisos importantes)
- **Custo de desenvolvimento maior**: terreno, câmera, iluminação, colisão e "sensação de voo" em 3D exigem bem mais iteração que em 2D
- **Performance**: WebGL é mais pesado; terreno precisa ser otimizado (baixo poly, LOD) para rodar bem em navegador, especialmente mobile
- **Assets**: mesmo em estilo low-poly, você vai precisar de pelo menos um modelo simples de parapente/piloto e um terreno com variação de altura — pode usar geometria procedural no início (sem modelos externos) para não travar o protótipo em arte
- Recomendo fortemente: comece com **terreno procedural simples (heightmap gerado por ruído Perlin) e formas geométricas básicas** para o parapente, só depois troque por modelos e texturas reais

## 3. Escopo do MVP 3D (o que ENTRA)
- Terreno 3D com variação de altura (colinas), gerado proceduralmente
- Um parapente controlado pelo jogador (câmera em terceira pessoa, atrás e acima)
- Física simplificada: sustentação dentro de zonas de térmica (representadas como colunas de ar visíveis, ex: partículas subindo), sink fora delas
- Vento com direção/intensidade que desloca térmicas e afeta a trajetória
- 2 bots simples voando em direção à térmica mais próxima
- HUD: altímetro, variômetro, timer de 3 minutos, ranking final

## 4. O que FICA FORA do protótipo (fase 2)
- Multiplayer real (WebSockets/Socket.io)
- Modelos 3D detalhados, texturas finais, sombras/iluminação avançada
- Backend permanente (entra só se houver multiplayer real, contas ou APIs)

## 5. Stack técnica sugerida
- **Three.js** para renderização 3D no navegador (leve, documentação madura, boa para protótipos rápidos)
- **cannon-es** ou física simplificada feita à mão (recomendo física à mão no início — mais controle sobre a "sensação" de voo do que um motor de física genérico)
- Node apenas para scripts locais de build/conversao; o jogo final do MVP e publicado como site estatico
- Terreno via `SimplexNoise` (geração procedural de heightmap)

## 6. Estrutura de pastas sugerida
```
paraglider-3d-prototype/
├── index.html
├── package.json
├── src/
│   ├── main.js            # loop principal, câmera, renderer
│   ├── terrain.js          # geração procedural do terreno (heightmap)
│   ├── physics.js           # sustentação, sink, vento
│   ├── thermal.js            # posição e visual das térmicas (partículas)
│   ├── player.js               # controle e modelo do parapente do jogador
│   ├── bot.js                    # comportamento simples dos bots
│   ├── camera.js                   # câmera terceira pessoa seguindo o jogador
│   └── hud.js                       # altímetro, variômetro, timer (overlay 2D sobre o canvas 3D)
└── assets/
    └── (modelos low-poly, se/quando forem adicionados)
```

## 7. Mecânica central (física simplificada em 3D)
- **Eixos**: X/Z = posição horizontal no terreno, Y = altitude
- **Térmica**: cilindro invisível (raio R, sem limite de altura) que sobe taxa +V m/s; força maior perto do centro do cilindro; representada visualmente por partículas subindo (ex: pontos ou sprites transparentes)
- **Fora da térmica**: sink constante -S m/s
- **Colisão com terreno**: se Y do jogador ≤ altura do terreno naquele X/Z, ele "pousa" (fim de participação na rodada)
- **Vento**: vetor 2D (X/Z) que desloca térmicas lentamente e empurra o parapente, mudando a cada X segundos
- **Câmera**: terceira pessoa, posicionada atrás e levemente acima do parapente, com leve delay/suavização para dar sensação de peso

## 8. Passo a passo para executar no Claude Code (VS Code)
Copie e cole este prompt inicial no Claude Code dentro do VS Code:

> "Crie um protótipo de jogo 3D em JavaScript usando Three.js, preparado para build estatico e deploy como Static Site. O jogo é sobre pilotar um parapente sobre um terreno 3D gerado proceduralmente (heightmap com ruído Perlin/Simplex). O jogador controla direção e inclinação com as setas/WASD, ganha altitude dentro de zonas de térmica (cilindros invisíveis representados visualmente por partículas subindo, que se movem lentamente com o vento) e perde altitude constantemente fora delas (sink). A câmera é em terceira pessoa, seguindo atrás e acima do parapente com suavização. Adicione bots que voam em direção à térmica mais próxima. Mostre um HUD 2D sobreposto ao canvas com altímetro, variômetro e timer de 3 minutos. Se o jogador ou bot colidir com o terreno, ele 'pousa' e sai da rodada. Ao final, mostre ranking por altitude/distância. Use geometria simples (cones/cápsulas) para representar o parapente inicialmente, sem modelos externos. Siga esta estrutura de pastas: [colar a estrutura da seção 6]. Comece pelo package.json, index.html e main.js com cena/câmera/renderer básicos do Three.js, depois terrain.js, depois physics.js e thermal.js, e por último player.js, bot.js e hud.js."

Trabalhe iterativamente depois disso:
1. Rode `npm install && npm run build` e valide o build estatico
2. Ajuste a câmera e os controles até o voo parecer fluido (esse é o ponto mais crítico em 3D)
3. Ajuste força de térmica e sink até ficar "gostoso" de jogar
4. Só depois adicione os bots e o ranking final

## 9. Critério de validação do protótipo
Pergunta-chave: **"a sensação de voar em 3D é boa, e eu jogaria de novo por 5 minutos?"**
Em 3D, preste atenção especial à câmera — é o maior risco de o jogo "não parecer bom" mesmo com a mecânica certa.

## 10. Próxima fase (só depois do MVP validado)
- Trocar bots por jogadores reais via WebSockets (Socket.io) — sincronizar posição/rotação a cada tick
- Otimizar terreno (LOD, chunking) para suportar mais jogadores/área maior
- Manter deploy como Static Site no Render enquanto nao houver multiplayer/backend real
- Adicionar salas de partida (matchmaking simples por código de sala)
- Modelos 3D low-poly reais e texturas, substituindo as formas geométricas provisórias
- Sistema básico de conta/skin como próximo passo de monetização
