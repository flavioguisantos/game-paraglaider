# Contribuindo

Obrigado pelo interesse em colaborar com o Jogo Parapente 3D.

Este projeto aceita contribuicoes por Pull Request. A prioridade e manter mudancas pequenas, revisaveis e alinhadas com o MVP.

## Antes de comecar

1. Leia `docs/context-index.md`.
2. Abra somente os documentos relevantes para a tarefa.
3. Verifique se a tarefa esta dentro do escopo atual ou marcada como pesquisa/pos-MVP.

## Fluxo de trabalho

1. Escolha uma issue.
2. Comente na issue dizendo que quer trabalhar nela.
3. Crie uma branch:

```bash
git checkout -b feature/nome-curto-da-tarefa
```

4. Instale e rode o projeto:

```bash
npm install
npm run build
npm run preview
```

5. Faca uma alteracao pequena e focada.
6. Atualize a documentacao pertinente.
7. Rode pelo menos:

```bash
npm run build
```

8. Abra um Pull Request para `main`.

## Regras para PRs

- Um PR deve resolver uma issue ou uma melhoria bem definida.
- Evite misturar mudancas nao relacionadas.
- Mudancas visuais devem incluir print, video curto ou descricao clara do que validar.
- Mudancas de voo/camera/fisica devem explicar como foram testadas.
- Mudancas funcionais, visuais ou estruturais devem atualizar a documentacao pertinente.
- Multiplayer ao vivo deve entrar primeiro como pesquisa, arquitetura ou prototipo isolado, nao como dependencia obrigatoria do MVP local.

## Escopo do MVP

Permitido no MVP:

- melhorias na sensacao de voo;
- terreno, camera, vento e termicas;
- HUD, bots e ranking local;
- polimento visual e performance;
- documentacao e organizacao de issues.

Fora do MVP de implementacao:

- multiplayer real;
- WebSockets/Socket.io integrados ao jogo principal;
- login, contas, salas, matchmaking, loja ou skins;
- backend permanente obrigatorio.

## Checklist local

Antes de abrir PR, confirme:

- [ ] `npm run build` executa sem erro.
- [ ] O jogo abre via `npm run preview`.
- [ ] A cena 3D renderiza.
- [ ] Nao ha erro novo no console do navegador.
- [ ] A documentacao relevante foi atualizada.
