<#
.SYNOPSIS
  Build and deploy the Cloudflare PREVIEW Worker (badminton-drop-in-preview) through
  the account guard. Default is a dry run; pass -Deploy to actually upload.

.DESCRIPTION
  Refuses to run when:
    - the account guard fails (wrong / unverified Cloudflare account),
    - cloudflare.config.ts worker name is not the preview name, or it declares
      routes / custom domains (preview must stay on *.workers.dev),
    - the current git branch is main/master,
    - the build would inline the PRODUCTION Supabase URL, unless
      -AllowProductionSupabase is given (read-only smoke tests only: do NOT also set
      SUPABASE_SERVICE_ROLE_KEY on the preview Worker in that case).

  -EnvFile loads build-time variables (NEXT_PUBLIC_*) into this process only;
  they take precedence over web/.env.local and web/.env.production.

.EXAMPLE
  ./scripts/cloudflare/cf-deploy-preview.ps1 -IgnoreEnvToken -EnvFile ..\..\secrets\preview.env
  ./scripts/cloudflare/cf-deploy-preview.ps1 -IgnoreEnvToken -EnvFile ..\..\secrets\preview.env -Deploy
#>
[CmdletBinding()]
param(
  [switch]$Deploy,
  [switch]$IgnoreEnvToken,
  [string]$EnvFile,
  [switch]$AllowProductionSupabase
)

$ErrorActionPreference = 'Stop'
$PreviewWorkerName = 'badminton-drop-in-preview'
$ProductionSupabaseRef = 'ngudidpitcfyzmbphlgt'

$WebRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Guard = Join-Path $PSScriptRoot 'cf-account-guard.ps1'

function Write-Deploy([string]$Message, [string]$Color = 'Gray') {
  Write-Host "[cf-deploy-preview] $Message" -ForegroundColor $Color
}
function Stop-Deploy([string]$Message) {
  Write-Deploy "FAIL: $Message" 'Red'
  exit 2
}

# --- branch -------------------------------------------------------------------
$branch = (& git -C $WebRoot rev-parse --abbrev-ref HEAD 2>$null)
if (-not $branch) { Stop-Deploy 'not a git checkout.' }
if ($branch -in @('main', 'master')) { Stop-Deploy "refusing to deploy from '$branch'. Use a feature branch." }
Write-Deploy "branch = $branch"

# --- worker config ---------------------------------------------------------------
$configText = Get-Content -Raw -Encoding UTF8 (Join-Path $WebRoot 'cloudflare.config.ts')
$nameMatch = [regex]::Match($configText, '(?m)^\s*name:\s*"([^"]+)"')
if (-not $nameMatch.Success -or $nameMatch.Groups[1].Value -ne $PreviewWorkerName) {
  Stop-Deploy "cloudflare.config.ts worker name must be '$PreviewWorkerName' (found '$($nameMatch.Groups[1].Value)')."
}
if ($configText -match '(?im)^\s*(routes|route|customDomains?|domains?|zone)\s*:') {
  Stop-Deploy 'cloudflare.config.ts declares routes/domains. Preview must stay on workers.dev.'
}

# --- build-time env -----------------------------------------------------------
$savedEnv = @{}
function Set-ProcessEnv([string]$Name, [string]$Value) {
  if (-not $savedEnv.ContainsKey($Name)) {
    $savedEnv[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
  }
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}
function Restore-ProcessEnv {
  foreach ($k in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($k, $savedEnv[$k], 'Process') }
}

function Read-DotEnv([string]$Path) {
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  foreach ($line in Get-Content -Encoding UTF8 $Path) {
    $mm = [regex]::Match($line, '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$')
    if (-not $mm.Success) { continue }
    $v = $mm.Groups[2].Value.Trim()
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    $map[$mm.Groups[1].Value] = $v
  }
  return $map
}

try {
  if ($EnvFile) {
    $envPath = (Resolve-Path $EnvFile).Path
    $vars = Read-DotEnv $envPath
    foreach ($k in $vars.Keys) {
      if ($k -like 'CLOUDFLARE_*' -or $k -like 'CF_*') { Stop-Deploy "-EnvFile must not contain Cloudflare credentials ($k)." }
      if ($k -eq 'SUPABASE_SERVICE_ROLE_KEY') { Stop-Deploy '-EnvFile must not contain SUPABASE_SERVICE_ROLE_KEY. Set it as a Worker secret instead.' }
      Set-ProcessEnv $k $vars[$k]
    }
    Write-Deploy "loaded $($vars.Count) build variables from $envPath (process only)"
  }

  # Effective NEXT_PUBLIC_SUPABASE_URL as Vite resolves it in production mode:
  # process env > .env.production.local > .env.local > .env.production > .env
  $sbUrl = [Environment]::GetEnvironmentVariable('NEXT_PUBLIC_SUPABASE_URL', 'Process')
  $sbSource = 'process env'
  if (-not $sbUrl) {
    foreach ($f in @('.env.production.local', '.env.local', '.env.production', '.env')) {
      $vv = (Read-DotEnv (Join-Path $WebRoot $f))['NEXT_PUBLIC_SUPABASE_URL']
      if ($vv) { $sbUrl = $vv; $sbSource = $f; break }
    }
  }
  if (-not $sbUrl) { Stop-Deploy 'NEXT_PUBLIC_SUPABASE_URL is not set for the build.' }
  Write-Deploy "build Supabase = $sbUrl (from $sbSource)"
  if ($sbUrl -match $ProductionSupabaseRef) {
    if (-not $AllowProductionSupabase) {
      Stop-Deploy 'build would point the preview at the PRODUCTION Supabase. Use -EnvFile with a staging project, or -AllowProductionSupabase for read-only smoke tests (never with a service role secret).'
    }
    Write-Deploy 'WARNING: preview uses PRODUCTION Supabase. Do not set SUPABASE_SERVICE_ROLE_KEY on this Worker.' 'Yellow'
  }

  # --- guarded deploy ---------------------------------------------------------
  $deployArgs = @('deploy')
  if (-not $Deploy) { $deployArgs += '--dry-run'; Write-Deploy 'DRY RUN (pass -Deploy to upload)' 'Yellow' }
  $vinextCli = Join-Path $WebRoot 'node_modules\@vinext\cloudflare\dist\cli.js'

  & $Guard -IgnoreEnvToken:$IgnoreEnvToken -Run { & node $vinextCli @deployArgs }
  $code = $LASTEXITCODE
  if ($code -ne 0) { Stop-Deploy "guard or deploy exited with $code" }
  Write-Deploy 'done' 'Green'
} finally {
  Restore-ProcessEnv
}
