param(
  [string]$Repository = "flavioguisantos/game-paraglaider",
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

$token = $env:GITHUB_TOKEN
if (-not $token) {
  $token = $env:GH_TOKEN
}

if (-not $token) {
  throw "Defina GITHUB_TOKEN ou GH_TOKEN com permissoes de administracao do repositorio antes de rodar este script."
}

$apiBase = "https://api.github.com"
$headers = @{
  "Accept" = "application/vnd.github+json"
  "Authorization" = "Bearer $token"
  "X-GitHub-Api-Version" = "2022-11-28"
}

function Invoke-GitHubApi {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [object]$Body = $null
  )

  $uri = "$apiBase$Path"
  $params = @{
    Method = $Method
    Uri = $uri
    Headers = $headers
  }

  if ($null -ne $Body) {
    $params.ContentType = "application/json"
    $params.Body = ($Body | ConvertTo-Json -Depth 20)
  }

  Invoke-RestMethod @params
}

function Test-GitHubLabelExists {
  param([Parameter(Mandatory = $true)][string]$Name)

  $encodedName = [System.Uri]::EscapeDataString($Name)
  try {
    Invoke-GitHubApi -Method "GET" -Path "/repos/$Repository/labels/$encodedName" | Out-Null
    return $true
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 404) {
      return $false
    }

    throw
  }
}

$labels = @(
  @{
    name = "good first issue"
    color = "7057ff"
    description = "Boa tarefa inicial para novos colaboradores"
  },
  @{
    name = "help wanted"
    color = "008672"
    description = "Ajuda externa bem-vinda"
  },
  @{
    name = "multiplayer"
    color = "1d76db"
    description = "Relacionado a multiplayer ao vivo"
  },
  @{
    name = "post-mvp"
    color = "5319e7"
    description = "Planejado para depois da validacao do MVP"
  },
  @{
    name = "research"
    color = "fbca04"
    description = "Pesquisa tecnica ou investigacao antes de implementar"
  }
)

foreach ($label in $labels) {
  $exists = Test-GitHubLabelExists -Name $label.name
  if ($exists) {
    $encodedName = [System.Uri]::EscapeDataString($label.name)
    Invoke-GitHubApi -Method "PATCH" -Path "/repos/$Repository/labels/$encodedName" -Body $label | Out-Null
    Write-Host "Label atualizada: $($label.name)"
  } else {
    Invoke-GitHubApi -Method "POST" -Path "/repos/$Repository/labels" -Body $label | Out-Null
    Write-Host "Label criada: $($label.name)"
  }
}

$branchProtection = @{
  required_status_checks = $null
  enforce_admins = $false
  required_pull_request_reviews = @{
    required_approving_review_count = 1
    dismiss_stale_reviews = $true
    require_code_owner_reviews = $false
    require_last_push_approval = $false
  }
  restrictions = $null
  required_linear_history = $false
  allow_force_pushes = $false
  allow_deletions = $false
  block_creations = $false
  required_conversation_resolution = $true
  lock_branch = $false
  allow_fork_syncing = $true
}

Invoke-GitHubApi -Method "PUT" -Path "/repos/$Repository/branches/$Branch/protection" -Body $branchProtection | Out-Null
Write-Host "Protecao configurada em $Repository/$Branch"
