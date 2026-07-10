# Jogo Parapente 3D

Prototipo 3D local de um jogo de parapente no navegador, em estilo `.io`.

O foco atual e validar a sensacao de voo com terreno 3D, camera em terceira pessoa, vento, termicas, HUD, bots simples e ranking local. Multiplayer ao vivo esta planejado como trilha pos-MVP, depois da validacao do voo.

## Status

- MVP jogavel localmente.
- Build estatico preparado.
- Sem multiplayer real no MVP atual.

## Stack

- JavaScript no navegador.
- Three.js para renderizacao 3D.
- Node.js apenas para scripts locais de build/conversao.
- Fisica manual simplificada.
- Terreno procedural e mapas processados.

## Rodando localmente

```bash
npm install
npm run build
npm run preview
```

Depois abra a URL indicada pelo comando `preview`.

O build copia as dependencias necessarias para `dist/vendor`, por isso o fluxo recomendado e servir a pasta `dist`.

## Como contribuir

1. Leia `docs/context-index.md` para saber quais documentos abrir antes de mexer.
2. Escolha uma issue pequena, de preferencia com `good first issue` ou `help wanted`.
3. Comente na issue antes de comecar.
4. Crie uma branch a partir de `main`.
5. Faca uma mudanca focada.
6. Atualize a documentacao pertinente quando houver mudanca funcional, visual ou estrutural.
7. Abra um Pull Request.

Veja [CONTRIBUTING.md](CONTRIBUTING.md) para o fluxo completo.

## GitHub

A configuracao recomendada de labels, Pull Requests e protecao da branch `main` esta em `docs/github-setup.md`.

## Tarefas boas para contribuidores

Consulte `docs/contribution-tasks.md`.

As primeiras contribuicoes devem priorizar:

- ajustes de camera e controles;
- legibilidade do HUD;
- melhorias visuais leves;
- bots e ranking local;
- documentacao;
- investigacao tecnica para multiplayer ao vivo pos-MVP.

## Escopo atual

O MVP nao deve adicionar backend permanente, login, contas, salas, loja, skins ou multiplayer real. Esses itens podem aparecer em issues de pesquisa ou planejamento para fases futuras, mas PRs de implementacao devem preservar o prototipo local ate a validacao do voo.
