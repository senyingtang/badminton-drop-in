<#
  093 / 97 runner (read-only). Runs 97_patch_state_readonly.sql against a Supabase project in three parts
  (`supabase db query` only returns the LAST result set of a multi-statement file) and checks the results.
  Every part runs with --read-only (a read-only transaction), so this script can never change the database.

  Output formats handled (supabase CLI `db query --output-format json`):
    - human terminal (agent mode off, the default in a normal PowerShell window): a bare JSON array  [ {row}, ... ]
    - agent mode (CLI auto-detects AI agents, e.g. Claude Code):   { "boundary": ..., "rows": [ ... ], "warning": ... }
    - error:                                                        { "_tag": "Error", "error": { "message": ... } }
  stdout must be exactly ONE valid JSON document; anything else is a FAIL (no substring guessing).

  Windows PowerShell 5.1 / Big5 console safe: cmd.exe redirects the CLI's raw bytes to files that are read back
  as UTF-8, so the console code page never touches the JSON. Patches are matched by their leading code (01d, 10...).

  Exit code 0 = PASS, 1 = FAIL. -SaveSnapshot is written ONLY when every check passed (temp file -> verify -> move);
  on FAIL no new snapshot is written and an existing file at that path is left untouched.

  Usage (from D:\project\badminton or D:\project\badminton\web):
    .\docs\proposals\093_cloudflare_cutover\97_run_readonly.ps1 -ExpectApplied '01d','10' -SaveSnapshot 'D:\project\secrets\97-after-01d.json'
    .\docs\proposals\093_cloudflare_cutover\97_run_readonly.ps1 -Baseline 'D:\project\secrets\97-after-01d.json'
    .\docs\proposals\093_cloudflare_cutover\97_run_readonly.ps1 -Ref cwvhxkujxsurvrmjexvm -ExpectApplied 01d,01,10,01b,01c,01e,094   # staging

  -ExpectApplied : patch codes that must be applied (true). Every other patch must be false (05 may be either).
  -Baseline      : a snapshot written earlier. Counts must not go down; a wallet balance change without new
                   wallet transactions is a FAIL (with new transactions it is a WARN to review).
  -FixtureDir    : TEST ONLY. Read part1..3 .out/.err/.code from this folder instead of calling the CLI
                   (see 97_run_readonly.test.ps1). Never touches any database.
#>
param(
  [string]$Ref = 'ngudidpitcfyzmbphlgt',
  [string[]]$ExpectApplied = @('10', '01d'),
  [string]$Baseline,
  [string]$SaveSnapshot,
  [string]$FixtureDir
)

$ErrorActionPreference = 'Stop'
$script:fails = New-Object System.Collections.Generic.List[string]
$script:warns = New-Object System.Collections.Generic.List[string]
function Pass([string]$m) { Write-Host "  PASS  $m" -ForegroundColor Green }
function Fail([string]$m) { $script:fails.Add($m); Write-Host "  FAIL  $m" -ForegroundColor Red }
function Warn([string]$m) { $script:warns.Add($m); Write-Host "  WARN  $m" -ForegroundColor Yellow }
$utf8 = New-Object Text.UTF8Encoding($false)

# PowerShell 5.1: ConvertFrom-Json on a top-level array may emit it as ONE pipeline object; flatten explicitly.
function ConvertTo-RowArray($parsed) {
  $list = New-Object System.Collections.Generic.List[object]
  foreach ($item in @($parsed)) {
    if ($item -is [System.Array]) { foreach ($x in $item) { $list.Add($x) } } else { $list.Add($item) }
  }
  return ,$list.ToArray()
}

# Parse CLI stdout. Returns @{ ok; rows; error }.
function Read-CliJson([string]$text) {
  $t = $text.Trim([char]0xFEFF, ' ', "`r", "`n", "`t")
  if (-not $t) { return @{ ok = $false; error = 'empty stdout' } }
  $first = $t[0]; $last = $t[$t.Length - 1]
  if (-not (($first -eq '[' -and $last -eq ']') -or ($first -eq '{' -and $last -eq '}'))) {
    return @{ ok = $false; error = "stdout is not a single JSON document (starts with '$first', ends with '$last')" }
  }
  try { $parsed = ConvertFrom-Json -InputObject $t } catch { return @{ ok = $false; error = "JSON parse error: $($_.Exception.Message)" } }
  if ($first -eq '[') { return @{ ok = $true; rows = (ConvertTo-RowArray $parsed) } }
  $names = @($parsed.PSObject.Properties.Name)
  if ($names -contains 'error' -or $parsed._tag -eq 'Error') {
    $msg = if ($parsed.error.message) { $parsed.error.message } else { ($parsed | ConvertTo-Json -Depth 5 -Compress) }
    return @{ ok = $false; error = "CLI error: $msg" }
  }
  if ($names -contains 'rows') { return @{ ok = $true; rows = (ConvertTo-RowArray $parsed.rows) } }
  return @{ ok = $false; error = "unexpected JSON object (keys: $($names -join ', '))" }
}

$webRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\web')).Path
$src = Join-Path $PSScriptRoot '97_patch_state_readonly.sql'
$f = [IO.File]::ReadAllText($src, $utf8)
$a = $f.IndexOf('-- 1)'); $b = $f.IndexOf('-- 2)'); $c = $f.IndexOf('-- 3)')
if ($a -lt 0 -or $b -lt 0 -or $c -lt 0) { Write-Host 'FAIL: 97_patch_state_readonly.sql section markers not found' -ForegroundColor Red; exit 1 }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('97-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null

function Invoke-ReadOnly([string]$name, [string]$sql, [int]$n) {
  if ($FixtureDir) {
    $out = Join-Path $FixtureDir "part$n.out"; $err = Join-Path $FixtureDir "part$n.err"
    $codeFile = Join-Path $FixtureDir "part$n.code"
    $code = if (Test-Path $codeFile) { [int]([IO.File]::ReadAllText($codeFile).Trim()) } else { 0 }
  } else {
    $in = Join-Path $tmp "part$n.sql"; $out = Join-Path $tmp "part$n.out"; $err = Join-Path $tmp "part$n.err"
    [IO.File]::WriteAllText($in, $sql, $utf8)
    # cmd.exe redirects raw bytes to files: no PowerShell / console decoding involved. stderr kept separate.
    $cmdLine = "npx --yes supabase db query --remote=$Ref --read-only --output-format json -f `"$in`" > `"$out`" 2> `"$err`""
    Push-Location $webRoot
    try { & cmd.exe /d /c $cmdLine; $code = $LASTEXITCODE } finally { Pop-Location }
  }
  $text = if (Test-Path $out) { [IO.File]::ReadAllText($out, $utf8) } else { '' }
  $errText = if (Test-Path $err) { [IO.File]::ReadAllText($err, $utf8) } else { '' }
  if ($code -ne 0) { Fail "$name : CLI exit $code $($errText.Trim())"; return $null }
  if ($errText -notmatch [regex]::Escape($Ref)) { Fail "$name : CLI did not confirm target $Ref"; return $null }
  $r = Read-CliJson $text
  if (-not $r.ok) { Fail "$name : $($r.error)"; return $null }
  if (@($r.rows).Count -lt 1) { Fail "$name : query returned no rows"; return $null }
  return $r.rows
}

function Get-Num($row, [string]$k) {
  if ($null -eq $row -or -not ($row.PSObject.Properties.Name -contains $k)) { Fail "column '$k' missing"; return $null }
  $v = $row.$k
  $d = [decimal]0   # PowerShell 5.1 has no 'm' decimal literal suffix
  if (-not [decimal]::TryParse([string]$v, [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$d)) { Fail "column '$k' is not a number: '$v'"; return $null }
  return $d
}

$patches = [ordered]@{}
$counts = [ordered]@{}
try {
  Write-Host "===== 97 read-only check: $Ref =====" -ForegroundColor Cyan

  # ---- 1) patch state ----
  Write-Host '--- 1) patch state'
  $p1 = Invoke-ReadOnly '1) patch state' $f.Substring($a, $b - $a) 1
  if ($p1) {
    foreach ($r in $p1) {
      if ($null -eq $r.patch -or $null -eq $r.applied) { Fail "patch row without patch/applied columns"; continue }
      $code = ([string]$r.patch).Trim().Split([char[]]@(' ', "`t", [char]0x3000), [StringSplitOptions]::RemoveEmptyEntries)[0]
      if ($r.applied -isnot [bool]) { Fail "patch $code : 'applied' is not a boolean ($($r.applied))"; continue }
      $patches[$code] = $r.applied
      Write-Host ("        {0,-4} applied={1}" -f $code, $r.applied)
    }
    foreach ($e in $ExpectApplied) {
      if (-not $patches.Contains($e)) { Fail "patch '$e' not found in 97 output" }
      elseif ($patches[$e]) { Pass "$e applied" } else { Fail "$e expected applied=true, got false" }
    }
    foreach ($k in @($patches.Keys)) {
      if ($ExpectApplied -contains $k -or $k -eq '05') { continue }
      if ($patches[$k]) { Fail "$k is applied but was not expected (-ExpectApplied)" } else { Pass "$k not applied (as expected)" }
    }
  }

  # ---- 2) row counts ----
  Write-Host '--- 2) row counts'
  $p2 = Invoke-ReadOnly '2) row counts' $f.Substring($b, $c - $b) 2
  $required2 = 'auth_users', 'profiles', 'players_with_line', 'sessions', 'open_sessions', 'registrations', 'waitlist',
               'waitlist_promotions', 'rounds', 'matches', 'score_submissions', 'wallet_txns', 'wallet_balance_cents_sum',
               'operation_reports', 'infinity_bans_must_be_0'
  if ($p2) {
    if (@($p2).Count -ne 1) { Fail "2) row counts : expected 1 row, got $(@($p2).Count)" }
    foreach ($k in $required2) { $v = Get-Num $p2[0] $k; if ($null -ne $v) { $counts[$k] = $v; Write-Host ("        {0,-26} {1}" -f $k, $v) } }
    if ($counts.Contains('infinity_bans_must_be_0')) { if ($counts['infinity_bans_must_be_0'] -eq 0) { Pass 'infinity_bans = 0' } else { Fail "infinity_bans = $($counts['infinity_bans_must_be_0'])" } }
    foreach ($k in 'auth_users', 'profiles', 'sessions', 'registrations', 'rounds', 'matches', 'operation_reports') {
      if ($counts.Contains($k)) { if ($counts[$k] -gt 0) { Pass "$k = $($counts[$k]) (> 0)" } else { Fail "$k = 0 (production data missing?)" } }
    }
  }

  # ---- 3) LINE mapping ----
  Write-Host '--- 3) LINE mapping'
  $p3 = Invoke-ReadOnly '3) LINE mapping' $f.Substring($c) 3
  if ($p3) {
    if (@($p3).Count -ne 1) { Fail "3) LINE mapping : expected 1 row, got $(@($p3).Count)" }
    foreach ($k in 'line_created_users', 'line_meta_unbound', 'duplicate_line_bindings_must_be_0') {
      $v = Get-Num $p3[0] $k; if ($null -ne $v) { $counts[$k] = $v; Write-Host ("        {0,-34} {1}" -f $k, $v) }
    }
    if ($counts.Contains('duplicate_line_bindings_must_be_0')) { if ($counts['duplicate_line_bindings_must_be_0'] -eq 0) { Pass 'duplicate LINE bindings = 0' } else { Fail "duplicate LINE bindings = $($counts['duplicate_line_bindings_must_be_0'])" } }
  }

  # ---- baseline comparison ----
  if ($Baseline) {
    Write-Host "--- baseline: $Baseline"
    if (-not (Test-Path $Baseline)) { Fail "baseline file not found: $Baseline" }
    else {
      $base = $null
      try { $base = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($Baseline, $utf8)) } catch { Fail "baseline is not valid JSON: $($_.Exception.Message)" }
      if ($base -and -not $base.counts) { Fail 'baseline has no counts' }
      elseif ($base) {
        foreach ($prop in $base.counts.PSObject.Properties) {
          $k = $prop.Name; $old = [decimal]$prop.Value
          if (-not $counts.Contains($k)) { Fail "$k missing in current run"; continue }
          $new = $counts[$k]
          if ($k -in @('open_sessions', 'waitlist', 'line_meta_unbound')) { if ($new -ne $old) { Warn "$k $old -> $new (operational, review)" } else { Pass "$k unchanged ($new)" }; continue }
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
  }
} catch {
  Fail "unexpected error: $($_.Exception.Message)"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# ---- snapshot: only after every check passed; temp file -> read back & compare -> move ----
if ($SaveSnapshot) {
  if ($script:fails.Count -gt 0) {
    Write-Host "  snapshot NOT written (checks failed). Existing file at $SaveSnapshot (if any) was not touched." -ForegroundColor Red
  } else {
    $snapTmp = "$SaveSnapshot.tmp-$([guid]::NewGuid().ToString('N'))"
    try {
      $countsOut = [ordered]@{}; foreach ($k in $counts.Keys) { $countsOut[$k] = [string]$counts[$k] }
      $snap = [ordered]@{ ref = $Ref; taken_at = (Get-Date).ToUniversalTime().ToString('o'); expect_applied = $ExpectApplied; patches = $patches; counts = $countsOut }
      [IO.File]::WriteAllText($snapTmp, ($snap | ConvertTo-Json -Depth 4), $utf8)
      $back = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($snapTmp, $utf8))
      foreach ($k in $counts.Keys) { if ([decimal]$back.counts.$k -ne $counts[$k]) { throw "snapshot read-back mismatch for $k" } }
      foreach ($k in $patches.Keys) { if ([bool]$back.patches.$k -ne $patches[$k]) { throw "snapshot read-back mismatch for patch $k" } }
      Move-Item -Force -LiteralPath $snapTmp -Destination $SaveSnapshot
      Pass "snapshot written and verified: $SaveSnapshot ($($counts.Count) counts, $($patches.Count) patches)"
    } catch {
      Fail "snapshot: $($_.Exception.Message)"
    } finally {
      if (Test-Path -LiteralPath $snapTmp) { Remove-Item -Force -LiteralPath $snapTmp }
    }
  }
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
