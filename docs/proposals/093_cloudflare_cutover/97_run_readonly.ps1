<#
  093 / 97 runner (read-only). Runs 97_patch_state_readonly.sql against a Supabase project in three parts
  (`supabase db query` only returns the LAST result set of a multi-statement file) and checks the results.
  Every part runs with --read-only (a read-only transaction), so this script can never change the database.

  Windows PowerShell 5.1 safe:
    - CLI output is redirected by cmd.exe into a file and read back as UTF-8 bytes, so the console code page
      (e.g. 950 / Big5) can never corrupt the JSON or the Chinese patch names.
    - Patches are matched by their leading code (01d, 10, ...), not by the Chinese text.
  Exit code: 0 = PASS, 1 = FAIL (any failed check, CLI error, or unparsable output).

  Usage (from D:\project\badminton\web):
    ..\docs\proposals\093_cloudflare_cutover\97_run_readonly.ps1                                   # production, expects 10 + 01d
    ..\docs\proposals\093_cloudflare_cutover\97_run_readonly.ps1 -ExpectApplied 10,01d -SaveSnapshot D:\project\secrets\97-after-01d.json
    ..\docs\proposals\093_cloudflare_cutover\97_run_readonly.ps1 -Baseline D:\project\secrets\97-after-01d.json
    ..\docs\proposals\093_cloudflare_cutover\97_run_readonly.ps1 -Ref cwvhxkujxsurvrmjexvm -ExpectApplied 01d,01,10,01b,01c,01e,094   # staging

  -ExpectApplied : patch codes that must be applied (true). Every other patch must be false (05 is allowed either way).
  -Baseline      : a JSON file written by -SaveSnapshot. Row counts must not go down; a wallet balance change
                   without new wallet transactions is a FAIL (with new transactions it is a WARN to review).
#>
param(
  [string]$Ref = 'ngudidpitcfyzmbphlgt',
  [string[]]$ExpectApplied = @('10', '01d'),
  [string]$Baseline,
  [string]$SaveSnapshot
)

$ErrorActionPreference = 'Stop'
$script:fails = New-Object System.Collections.Generic.List[string]
$script:warns = New-Object System.Collections.Generic.List[string]
function Pass([string]$m) { Write-Host "  PASS  $m" -ForegroundColor Green }
function Fail([string]$m) { $script:fails.Add($m); Write-Host "  FAIL  $m" -ForegroundColor Red }
function Warn([string]$m) { $script:warns.Add($m); Write-Host "  WARN  $m" -ForegroundColor Yellow }
$utf8 = New-Object Text.UTF8Encoding($false)

$webRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\web')).Path
$src = Join-Path $PSScriptRoot '97_patch_state_readonly.sql'
$f = [IO.File]::ReadAllText($src, $utf8)
$a = $f.IndexOf('-- 1)'); $b = $f.IndexOf('-- 2)'); $c = $f.IndexOf('-- 3)')
if ($a -lt 0 -or $b -lt 0 -or $c -lt 0) { Write-Host 'FAIL: 97_patch_state_readonly.sql section markers not found' -ForegroundColor Red; exit 1 }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('97-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null

function Invoke-ReadOnly([string]$name, [string]$sql, [int]$n) {
  $in = Join-Path $tmp "part$n.sql"; $out = Join-Path $tmp "part$n.out"; $err = Join-Path $tmp "part$n.err"
  [IO.File]::WriteAllText($in, $sql, $utf8)
  # cmd.exe redirects raw bytes to files: no PowerShell / console decoding involved.
  $cmdLine = "npx --yes supabase db query --remote=$Ref --read-only --output-format json -f `"$in`" > `"$out`" 2> `"$err`""
  Push-Location $webRoot
  try { & cmd.exe /d /c $cmdLine; $code = $LASTEXITCODE } finally { Pop-Location }
  $text = if (Test-Path $out) { [IO.File]::ReadAllText($out, $utf8) } else { '' }
  $errText = if (Test-Path $err) { [IO.File]::ReadAllText($err, $utf8) } else { '' }
  if ($errText -notmatch [regex]::Escape($Ref)) { Fail "$name : CLI did not confirm target $Ref"; return $null }
  $start = $text.IndexOf('{')
  if ($code -ne 0 -or $start -lt 0) { Fail "$name : CLI exit $code`n$errText`n$text"; return $null }
  try { $obj = $text.Substring($start) | ConvertFrom-Json } catch { Fail "$name : JSON parse error: $($_.Exception.Message)"; return $null }
  if ($obj.PSObject.Properties.Name -contains 'error') { Fail "$name : $($obj.error.message)"; return $null }
  if ($null -eq $obj.rows) { Fail "$name : no rows in output"; return $null }
  return @($obj.rows)
}

try {
  Write-Host "===== 97 read-only check: $Ref =====" -ForegroundColor Cyan

  # ---- 1) patch state ----
  Write-Host '--- 1) patch state'
  $p1 = Invoke-ReadOnly '1) patch state' $f.Substring($a, $b - $a) 1
  $patches = [ordered]@{}
  if ($p1) {
    foreach ($r in $p1) {
      $code = ($r.patch.Trim() -split '\s+')[0]
      $patches[$code] = [bool]$r.applied
      Write-Host ("        {0,-4} applied={1}" -f $code, $r.applied)
    }
    foreach ($e in $ExpectApplied) {
      if (-not $patches.Contains($e)) { Fail "patch '$e' not found in 97 output" }
      elseif ($patches[$e]) { Pass "$e applied" } else { Fail "$e expected applied=true, got false" }
    }
    foreach ($k in $patches.Keys) {
      if ($ExpectApplied -contains $k -or $k -eq '05') { continue }
      if ($patches[$k]) { Fail "$k is applied but was not expected (-ExpectApplied)" } else { Pass "$k not applied (as expected)" }
    }
  }

  # ---- 2) row counts ----
  Write-Host '--- 2) row counts'
  $p2 = Invoke-ReadOnly '2) row counts' $f.Substring($b, $c - $b) 2
  $counts = [ordered]@{}
  if ($p2) {
    foreach ($prop in $p2[0].PSObject.Properties) { $counts[$prop.Name] = [decimal]$prop.Value; Write-Host ("        {0,-26} {1}" -f $prop.Name, $prop.Value) }
    if ($counts['infinity_bans_must_be_0'] -eq 0) { Pass 'infinity_bans = 0' } else { Fail "infinity_bans = $($counts['infinity_bans_must_be_0'])" }
  }

  # ---- 3) LINE mapping ----
  Write-Host '--- 3) LINE mapping'
  $p3 = Invoke-ReadOnly '3) LINE mapping' $f.Substring($c) 3
  if ($p3) {
    foreach ($prop in $p3[0].PSObject.Properties) { $counts[$prop.Name] = [decimal]$prop.Value; Write-Host ("        {0,-34} {1}" -f $prop.Name, $prop.Value) }
    if ($counts['duplicate_line_bindings_must_be_0'] -eq 0) { Pass 'duplicate LINE bindings = 0' } else { Fail "duplicate LINE bindings = $($counts['duplicate_line_bindings_must_be_0'])" }
  }

  # ---- baseline comparison ----
  if ($Baseline) {
    Write-Host "--- baseline: $Baseline"
    if (-not (Test-Path $Baseline)) { Fail "baseline file not found: $Baseline" }
    else {
      $base = [IO.File]::ReadAllText($Baseline, $utf8) | ConvertFrom-Json
      foreach ($prop in $base.counts.PSObject.Properties) {
        $k = $prop.Name; $old = [decimal]$prop.Value
        if (-not $counts.Contains($k)) { Fail "$k missing in current run"; continue }
        $new = $counts[$k]
        if ($k -in @('open_sessions', 'waitlist', 'line_meta_unbound')) { if ($new -ne $old) { Warn "$k $old -> $new (operational, review)" }; continue }
        if ($k -like '*must_be_0') { continue }
        if ($k -eq 'wallet_balance_cents_sum') {
          if ($new -eq $old) { Pass 'wallet balance sum unchanged' }
          elseif ($counts['wallet_txns'] -gt [decimal]$base.counts.wallet_txns) { Warn "wallet balance sum $old -> $new with new wallet transactions (review them)" }
          else { Fail "wallet balance sum $old -> $new WITHOUT new wallet transactions" }
          continue
        }
        if ($new -lt $old) { Fail "$k decreased $old -> $new" } elseif ($new -gt $old) { Warn "$k increased $old -> $new (normal operations?)" } else { Pass "$k unchanged ($new)" }
      }
    }
  }

  if ($SaveSnapshot -and $script:fails.Count -eq 0) {
    $snap = [ordered]@{ ref = $Ref; taken_at = (Get-Date).ToUniversalTime().ToString('o'); patches = $patches; counts = $counts }
    [IO.File]::WriteAllText($SaveSnapshot, ($snap | ConvertTo-Json -Depth 4), $utf8)
    Write-Host "snapshot saved: $SaveSnapshot"
  }
} catch {
  Fail "unexpected error: $($_.Exception.Message)"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

Write-Host ''
if ($script:fails.Count -eq 0) {
  Write-Host ("97 READONLY PASS ({0} warning(s))" -f $script:warns.Count) -ForegroundColor Green
  exit 0
} else {
  Write-Host ("97 READONLY FAIL ({0} failure(s))" -f $script:fails.Count) -ForegroundColor Red
  $script:fails | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}
