<#
.SYNOPSIS
  Build and deploy a Cloudflare PREVIEW Worker (demo or staging; never a production domain)
  through the account guard. Default is a dry run; pass -Deploy to actually upload.

.DESCRIPTION
  -Target demo    -> badminton-drop-in-preview (Demo fake backend; -EnvFile .\scripts\cloudflare\demo-preview.env)
  -Target staging -> badminton-drop-in-staging (Staging Supabase; -EnvFile ..\..\secrets\staging.env)
  The script builds first and verifies the artefact (worker name, Supabase URL, no production ref)
  before the guarded upload (vinext deploy --skip-build).

  Refuses to run when:
    - the account guard fails (wrong / unverified Cloudflare account),
    - cloudflare.config.ts worker name is not the preview name, or it declares
      routes / custom domains (preview must stay on *.workers.dev),
    - the current git branch is main/master,
    - the build would inline the PRODUCTION Supabase URL (never allowed for preview Workers),

  -EnvFile loads build-time variables (NEXT_PUBLIC_*) into this process only;
  they take precedence over web/.env.local and web/.env.production.

.EXAMPLE
  ./scripts/cloudflare/cf-deploy-preview.ps1 -Target demo -IgnoreEnvToken -EnvFile .\scripts\cloudflare\demo-preview.env -Deploy
  ./scripts/cloudflare/cf-deploy-preview.ps1 -Target staging -IgnoreEnvToken -EnvFile ..\..\secrets\staging.env          # dry run
  ./scripts/cloudflare/cf-deploy-preview.ps1 -Target staging -IgnoreEnvToken -EnvFile ..\..\secrets\staging.env -Deploy
#>
[CmdletBinding()]
param(
  [ValidateSet('demo', 'staging', 'readonly')]
  [string]$Target = 'demo',
  [switch]$Deploy,
  [switch]$IgnoreEnvToken,
  [string]$EnvFile
)

$ErrorActionPreference = 'Stop'
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
# demo    -> badminton-drop-in-preview  (Demo fake backend only)
# staging -> badminton-drop-in-staging  (Staging Supabase only)
# readonly -> badminton-drop-in-readonly (PRODUCTION Supabase, read-only gate, password, no service_role)
$WorkerNames = @{ demo = 'badminton-drop-in-preview'; staging = 'badminton-drop-in-staging'; readonly = 'badminton-drop-in-readonly' }
$PreviewWorkerName = $WorkerNames[$Target]
$configText = Get-Content -Raw -Encoding UTF8 (Join-Path $WebRoot 'cloudflare.config.ts')
foreach ($k in $WorkerNames.Keys) {
  if ($configText -notmatch ('(?m)^\s*' + $k + ':\s*"' + [regex]::Escape($WorkerNames[$k]) + '"')) {
    Stop-Deploy "cloudflare.config.ts must map $k -> '$($WorkerNames[$k])'."
  }
}
if ($configText -notmatch '(?m)^\s*name:\s*WORKER_NAMES\[target\],') {
  Stop-Deploy 'cloudflare.config.ts worker name must be WORKER_NAMES[target].'
}
if ($configText -match '(?im)^\s*(routes|route|customDomains?|domains?|zone)\s*:') {
  Stop-Deploy 'cloudflare.config.ts declares routes/domains. Preview must stay on workers.dev.'
}
Write-Deploy "target = $Target -> worker $PreviewWorkerName"

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
  if ($sbUrl -match $ProductionSupabaseRef -and $Target -ne 'readonly') {
    Stop-Deploy 'build would point a preview Worker at the PRODUCTION Supabase. Only the read-only target may do that.'
  }

  # --- per-target isolation --------------------------------------------------------
  $demoFlag = [Environment]::GetEnvironmentVariable('NEXT_PUBLIC_DEMO_PREVIEW', 'Process')
  if ($Target -eq 'demo') {
    if ($demoFlag -ne '1' -or $sbUrl -ne 'https://demo-preview.invalid') {
      Stop-Deploy "target 'demo' requires NEXT_PUBLIC_DEMO_PREVIEW=1 and NEXT_PUBLIC_SUPABASE_URL=https://demo-preview.invalid (use -EnvFile .\scripts\cloudflare\demo-preview.env)."
    }
    Write-Deploy 'DEMO PREVIEW build: Supabase is answered by the in-app read-only fake backend.' 'Yellow'
  } elseif ($Target -eq 'readonly') {
    $roFlag = [Environment]::GetEnvironmentVariable('NEXT_PUBLIC_READONLY_PREVIEW', 'Process')
    if ($roFlag -ne '1') { Stop-Deploy "target 'readonly' requires NEXT_PUBLIC_READONLY_PREVIEW=1 (use -EnvFile .\scripts\cloudflare
eadonly-preview.env)." }
    if ($demoFlag -eq '1') { Stop-Deploy "target 'readonly' must not enable the Demo backend." }
    if ($sbUrl -notmatch $ProductionSupabaseRef) { Stop-Deploy "target 'readonly' is only for the production Supabase ($ProductionSupabaseRef)." }
    Write-Deploy 'READ-ONLY build against PRODUCTION Supabase: writes blocked at the Worker gate, password required, no service_role.' 'Yellow'
  } else {
    if ($demoFlag -eq '1' -or $sbUrl -match 'demo-preview\.invalid') { Stop-Deploy "target 'staging' must not use the Demo backend." }
    if ($sbUrl -match $ProductionSupabaseRef) { Stop-Deploy "target 'staging' must never use the PRODUCTION Supabase." }
    if ($sbUrl -notmatch '^https://[a-z0-9]{20}\.supabase\.co/?$') { Stop-Deploy "target 'staging' needs a Supabase project URL (https://<ref>.supabase.co), got '$sbUrl'." }
    if (-not $EnvFile) { Stop-Deploy "target 'staging' requires -EnvFile with the Staging project's NEXT_PUBLIC_* values." }
  }
  [Environment]::SetEnvironmentVariable('BADMINTON_CF_TARGET', $Target, 'Process')
  $savedEnv['BADMINTON_CF_TARGET'] = $null

  # --- build, then verify the artefact before anything is uploaded ------------------
  Push-Location $WebRoot
  try {
    $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & npx vite build 2>&1 | ForEach-Object { "$_" } | Select-Object -Last 3 | ForEach-Object { Write-Deploy $_ }
    $buildCode = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
  } finally { Pop-Location }
  if ($buildCode -ne 0) { Stop-Deploy "vite build exited with $buildCode" }
  $out = Join-Path $WebRoot '.cloudflare\output\v0'
  $builtName = (Get-Content -Raw (Join-Path $out 'workers\default\worker.config.json') | ConvertFrom-Json).name
  if ($builtName -ne $PreviewWorkerName) { Stop-Deploy "built worker name '$builtName' != expected '$PreviewWorkerName'." }
  $prodHits = @(Get-ChildItem $out -Recurse -File | Select-String -SimpleMatch $ProductionSupabaseRef -List)
  if ($Target -ne 'readonly' -and $prodHits.Count -gt 0) { Stop-Deploy "build output references the PRODUCTION Supabase ($($prodHits.Count) files)." }
  if ($Target -eq 'readonly') {
    $gateHits = @(Get-ChildItem (Join-Path $out 'workers\default\bundle') -Recurse -File -Include *.js | Select-String -SimpleMatch 'READ_ONLY_PREVIEW' -List)
    if ($gateHits.Count -eq 0) { Stop-Deploy 'read-only gate not found in the Worker bundle.' }
  }
  $urlHits = @(Get-ChildItem $out -Recurse -File -Include *.js | Select-String -SimpleMatch $sbUrl.TrimEnd('/') -List)
  if ($urlHits.Count -eq 0) { Stop-Deploy "build output does not contain the expected Supabase URL ($sbUrl)." }
  Write-Deploy "verified build: worker=$builtName, Supabase=$sbUrl, production ref $(if ($Target -eq 'readonly') { 'expected (read-only gate present)' } else { 'absent' })" 'Green'

  # --- guarded deploy ---------------------------------------------------------
  $deployArgs = @('deploy', '--skip-build')
  if (-not $Deploy) { $deployArgs += '--dry-run'; Write-Deploy 'DRY RUN (pass -Deploy to upload)' 'Yellow' }
  $vinextCli = Join-Path $WebRoot 'node_modules\@vinext\cloudflare\dist\cli.js'

  & $Guard -IgnoreEnvToken:$IgnoreEnvToken -Run { & node $vinextCli @deployArgs }
  $code = $LASTEXITCODE
  if ($code -ne 0) { Stop-Deploy "guard or deploy exited with $code" }
  if ($Deploy -and $Target -ne 'demo') {
    $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $secretList = (& $Guard -IgnoreEnvToken:$IgnoreEnvToken -CfArgs @('workers', 'secrets', 'list', '--worker', $PreviewWorkerName) 2>&1 | ForEach-Object { "$_" }) -join "`n"
    $ErrorActionPreference = $prevEap
    if ($Target -eq 'readonly' -and $secretList -match 'SUPABASE_SERVICE_ROLE_KEY') {
      Stop-Deploy "SUPABASE_SERVICE_ROLE_KEY is bound to $PreviewWorkerName. Delete it now: cf workers secrets delete SUPABASE_SERVICE_ROLE_KEY --worker $PreviewWorkerName"
    }
    if ($Target -eq 'readonly' -and $secretList -notmatch 'PREVIEW_ACCESS_PASSWORD') {
      Write-Deploy 'PREVIEW_ACCESS_PASSWORD is not set: the site answers 503 (locked) until it is.' 'Yellow'
    }
  }
  Write-Deploy 'done' 'Green'
} finally {
  Restore-ProcessEnv
}
