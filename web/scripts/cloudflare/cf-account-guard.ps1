<#
.SYNOPSIS
  Cloudflare account lock for badminton-drop-in. Verifies the EFFECTIVE
  Cloudflare identity before any cf command runs, and fails closed.

.DESCRIPTION
  cf credential order : CLOUDFLARE_API_TOKEN (env or .env file) > --profile >
                        directory-bound profile > default OAuth login.
  cf account order    : CLOUDFLARE_ACCOUNT_ID env > accountId in cloudflare.config.ts >
                        saved account > the only account.
  So a token/account inherited from the Windows user environment silently wins.

  This script:
    1. Requires cloudflare.config.ts accountId == $AllowedAccountId.
    2. Refuses Cloudflare credentials inside web/.env* or web/.dev.vars* files
       (cf loads them and they cannot be safely overridden).
    3. Inherited CLOUDFLARE_* / CF_* variables:
         default          -> any account ID != allowed, or a token whose accounts do
                             not include the allowed one, is a FAIL.
         -IgnoreEnvToken  -> removes them from THIS PowerShell process only, so cf
                             falls back to its OAuth login. User/Machine-level
                             variables are never modified.
    4. Forces CLOUDFLARE_ACCOUNT_ID = allowed for this process.
    5. Asks `cf auth whoami` which identity is actually in effect and requires the
       allowed account to be in its account list. Denylisted accounts always FAIL.
    6. Optionally runs -CfArgs or -Run under the verified environment, then restores
       the original process environment.

  Never prints token values. Exit code 0 = PASS, 2 = FAIL.

.EXAMPLE
  ./scripts/cloudflare/cf-account-guard.ps1                      # verify only
  ./scripts/cloudflare/cf-account-guard.ps1 -IgnoreEnvToken      # verify using cf OAuth login
  ./scripts/cloudflare/cf-account-guard.ps1 -IgnoreEnvToken -CfArgs workers,secrets,update,--help
#>
[CmdletBinding()]
param(
  [switch]$IgnoreEnvToken,
  [string[]]$CfArgs,
  [scriptblock]$Run
)

$ErrorActionPreference = 'Stop'

# The only account this project may deploy to (senyingtang2025@gmail.com).
$AllowedAccountId = 'feb96af4be0e308c286c3fd8d50e1941'
# Accounts that must never receive a deploy from this repo (e.g. Ryan's account).
$DeniedAccountIds = @('e3193fd95e1cbec497aed80bcc07b191')

$WebRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$CfBin = Join-Path $WebRoot 'node_modules\cf\bin\cf'
$CredVarNames = @('CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL')
$AccountVarNames = @('CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID')

function Write-Guard([string]$Message, [string]$Color = 'Gray') {
  Write-Host "[cf-guard] $Message" -ForegroundColor $Color
}

# Snapshot the process environment so it can be restored no matter what.
$saved = @{}
foreach ($n in $CredVarNames + $AccountVarNames) {
  $saved[$n] = [Environment]::GetEnvironmentVariable($n, 'Process')
}
function Restore-Env {
  foreach ($n in $saved.Keys) {
    [Environment]::SetEnvironmentVariable($n, $saved[$n], 'Process')
  }
}

$script:failed = $false
function Fail([string]$Message) {
  Write-Guard "FAIL: $Message" 'Red'
  Restore-Env
  $script:failed = $true
  exit 2
}

if (-not (Test-Path $CfBin)) { Fail "cf CLI not found at $CfBin. Run 'npm install' in web/." }

# --- 1. cloudflare.config.ts ------------------------------------------------
$configPath = Join-Path $WebRoot 'cloudflare.config.ts'
$configText = Get-Content -Raw -Encoding UTF8 $configPath
$m = [regex]::Match($configText, '(?m)^\s*const\s+ALLOWED_ACCOUNT_ID\s*=\s*"([0-9a-f]{32})"')
if (-not $m.Success) { Fail 'cloudflare.config.ts: ALLOWED_ACCOUNT_ID not found.' }
if ($m.Groups[1].Value -ne $AllowedAccountId) {
  Fail "cloudflare.config.ts accountId ($($m.Groups[1].Value)) != guard allowed id ($AllowedAccountId)."
}
if ($configText -notmatch '(?m)^\s*accountId:\s*ALLOWED_ACCOUNT_ID\s*,') {
  Fail 'cloudflare.config.ts: defineConfig({ accountId: ALLOWED_ACCOUNT_ID }) missing.'
}
Write-Guard "config accountId = $AllowedAccountId"

# --- 2. credential files ----------------------------------------------------
$credFiles = Get-ChildItem -Path $WebRoot -Force -File |
  Where-Object { ($_.Name -like '.env*' -or $_.Name -like '.dev.vars*') -and $_.Name -notlike '*.example' }
foreach ($f in $credFiles) {
  $hit = Select-String -Path $f.FullName -Pattern '^\s*(export\s+)?(CLOUDFLARE_[A-Z_]+|CF_API_TOKEN|CF_ACCOUNT_ID)\s*=' -ErrorAction SilentlyContinue
  if ($hit) {
    Fail "$($f.Name) defines $($hit[0].Matches[0].Groups[2].Value). Remove Cloudflare credentials from project env files."
  }
}

# --- 3. inherited environment ----------------------------------------------
foreach ($n in $AccountVarNames) {
  $v = [Environment]::GetEnvironmentVariable($n, 'Process')
  if ($v -and $v -ne $AllowedAccountId) {
    if ($IgnoreEnvToken) {
      Write-Guard "ignoring inherited $n=$v (process only)" 'Yellow'
      [Environment]::SetEnvironmentVariable($n, $null, 'Process')
    } else {
      Fail "$n=$v overrides the allowed account. Re-run with -IgnoreEnvToken to use the cf OAuth login instead."
    }
  }
}
foreach ($n in $CredVarNames) {
  if ([Environment]::GetEnvironmentVariable($n, 'Process')) {
    if ($IgnoreEnvToken) {
      Write-Guard "ignoring inherited $n (process only; value not shown)" 'Yellow'
      [Environment]::SetEnvironmentVariable($n, $null, 'Process')
    } else {
      Write-Guard "$n is set; it takes priority over OAuth. Verifying which accounts it reaches..." 'Yellow'
    }
  }
}

# --- 4. force the account for this process ---------------------------------
[Environment]::SetEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID', $AllowedAccountId, 'Process')
[Environment]::SetEnvironmentVariable('CF_ACCOUNT_ID', $null, 'Process')

# --- 5. effective identity --------------------------------------------------
Push-Location $WebRoot
try {
  # PowerShell 5.1 turns native stderr into terminating errors under 'Stop'.
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $raw = (& node $CfBin auth whoami 2>&1 | ForEach-Object { "$_" } | Out-String)
} finally {
  $ErrorActionPreference = $prevEap
  Pop-Location
}
$jsonText = [regex]::Match($raw, '(?s)^\s*\{.*?^\}', 'Multiline').Value
if (-not $jsonText) { Fail "could not parse 'cf auth whoami' output." }
try { $who = $jsonText | ConvertFrom-Json } catch { Fail "could not parse 'cf auth whoami' JSON." }

if (-not $who.authenticated) {
  Fail "cf is not authenticated ($($who.error)). Run: npx cf auth login   (in web/, as senyingtang2025@gmail.com)"
}
$ids = @($who.accounts | ForEach-Object { $_.id })
foreach ($d in $DeniedAccountIds) {
  if ($ids -contains $d -and $ids.Count -eq 1) {
    $name = ($who.accounts | Where-Object { $_.id -eq $d }).name
    Fail "effective credential ($($who.authSource)) belongs to DENIED account '$name' ($d)."
  }
}
if ($ids -notcontains $AllowedAccountId) {
  $names = ($who.accounts | ForEach-Object { "$($_.name) ($($_.id))" }) -join ', '
  Fail "effective credential ($($who.authSource)) cannot access $AllowedAccountId. It reaches: $names"
}
$allowedName = ($who.accounts | Where-Object { $_.id -eq $AllowedAccountId }).name
Write-Guard "PASS: authSource='$($who.authSource)' account='$allowedName' ($AllowedAccountId)" 'Green'

# --- 6. optional command ------------------------------------------------------
$exitCode = 0
$ErrorActionPreference = 'Continue'
try {
  if ($CfArgs) {
    Push-Location $WebRoot
    try { & node $CfBin @CfArgs; $exitCode = $LASTEXITCODE } finally { Pop-Location }
  } elseif ($Run) {
    Push-Location $WebRoot
    try { & $Run; $exitCode = $LASTEXITCODE } finally { Pop-Location }
  }
} finally {
  Restore-Env
}
if ($null -eq $exitCode) { $exitCode = 0 }
exit $exitCode
