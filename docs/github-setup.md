# Configuracao do GitHub

Este projeto usa Pull Requests para receber contribuicoes.

## O que configurar

- Labels principais:
  - `good first issue`
  - `help wanted`
  - `multiplayer`
  - `post-mvp`
  - `research`
- Protecao da branch `main`:
  - exigir Pull Request antes de merge;
  - exigir 1 aprovacao;
  - descartar aprovacao antiga quando novos commits forem enviados;
  - exigir conversas resolvidas;
  - bloquear force push;
  - bloquear exclusao da branch;
  - aplicar tambem para administradores.
- GitHub Actions:
  - workflow `Build` roda em Pull Requests e pushes na `main`.

## Configuracao automatica

Crie um token do GitHub com permissoes administrativas no repositorio e rode:

```powershell
$env:GITHUB_TOKEN = "seu-token"
.\scripts\configure-github.ps1
```

Tambem e possivel usar `GH_TOKEN`.

Por padrao, o script configura:

```powershell
.\scripts\configure-github.ps1 -Repository "flavioguisantos/game-paraglaider" -Branch "main"
```

## Permissoes do token

Use um fine-grained personal access token com acesso ao repositorio e permissoes:

- Administration: read/write
- Metadata: read

Para criar/atualizar labels, o token tambem precisa permissao de escrita em issues ou administracao suficiente no repositorio.

## Observacao sobre status checks

O script nao torna o workflow `Build` obrigatorio inicialmente. Primeiro faca push do workflow, espere o GitHub Actions rodar ao menos uma vez, e entao adicione o status check obrigatorio manualmente se quiser:

- Repository Settings
- Branches
- Branch protection rules
- `main`
- Require status checks to pass before merging
- Selecionar `Build static site`

## Repositorio privado

Se o repositorio estiver privado em uma conta sem GitHub Pro/Team, a API pode recusar a protecao da branch com a mensagem:

```text
Upgrade to GitHub Pro or make this repository public to enable this feature.
```

Nesse caso, as opcoes sao:

- tornar o repositorio publico;
- assinar um plano que habilite branch protection em repositorios privados;
- manter o repositorio privado sem protecao automatica de `main` por enquanto.

## Estado atual

O repositorio `flavioguisantos/game-paraglaider` foi tornado publico para habilitar protecao da branch `main`.

A branch `main` esta configurada com:

- Pull Request obrigatorio antes de merge;
- 1 aprovacao obrigatoria;
- aprovacoes antigas descartadas quando novos commits sao enviados;
- conversas resolvidas obrigatorias;
- force push bloqueado;
- exclusao da branch bloqueada;
- regra aplicada tambem para administradores.
