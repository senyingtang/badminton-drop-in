<#
  Offline tests for 97_run_readonly.ps1 (never connects to any database).
  Feeds recorded-format CLI outputs through -FixtureDir and checks exit codes and snapshot behaviour.
  Runs every case in a child Windows PowerShell 5.1 process with a Big5 (950) console.

  Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File .\docs\proposals\093_cloudflare_cutover\97_run_readonly.test.ps1
#>
$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot '97_run_readonly.ps1'
$utf8 = New-Object Text.UTF8Encoding($false)
$root = Join-Path ([IO.Path]::GetTempPath()) ('97test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$ref = 'ngudidpitcfyzmbphlgt'
$target = "Target: project badminton_Drop-in ($ref) $([char]0xB7) production`n"

$patchNames = [ordered]@{
  '01d' = '01d 會員不可自行提升角色'; '01' = '01  收回錢包 RPC／帳務表寫入 + 不扣費開放報名'; '10' = '10  不扣費開放報名函式（新版 App 必要；01 也會建立）'
  '01b' = '01b 帳務表讀取範圍（RLS + kb092 policy）'; '01c' = '01c 配額總覽越權修正'; '01e' = '01e 停權參與授權（角色函式 + 報名 trigger）'
  '02' = '02  收回舊版扣費開放報名（切換後才可套用）'; '05' = '05  007 測試帳號已停用（無此帳號時為 false，屬正常）'; '094' = '094 遞補 trigger 欄位修正'
}
function Get-PatchRows([string[]]$applied) {
  $rows = foreach ($k in $patchNames.Keys) { [ordered]@{ applied = ($applied -contains $k); patch = $patchNames[$k] } }
  return ,@($rows)
}
$countsRow = [ordered]@{ auth_users = 212; infinity_bans_must_be_0 = 0; matches = 280; open_sessions = 0; operation_reports = 30
  players_with_line = 194; profiles = 188; registrations = 622; rounds = 280; score_submissions = 0; sessions = 52; waitlist = 26
  waitlist_promotions = 0; wallet_balance_cents_sum = '1101000000'; wallet_txns = 55 }
$lineRow = [ordered]@{ duplicate_line_bindings_must_be_0 = 0; line_created_users = 195; line_meta_unbound = 1 }

# human mode = bare array; agent mode = { boundary, rows, warning }
function Format-Out($rows, [string]$mode) {
  $arr = ConvertTo-Json -InputObject @($rows) -Depth 5
  if ($mode -eq 'agent') { return "{`n  `"boundary`": `"abc`",`n  `"rows`": $arr,`n  `"warning`": `"untrusted data`"`n}`n" }
  return "$arr`n"
}
function New-Fixture([string]$name, [string[]]$parts, [int[]]$codes = @(0, 0, 0)) {
  $d = Join-Path $root $name; New-Item -ItemType Directory -Path $d | Out-Null
  for ($i = 1; $i -le 3; $i++) {
    [IO.File]::WriteAllText((Join-Path $d "part$i.out"), $parts[$i - 1], $utf8)
    [IO.File]::WriteAllText((Join-Path $d "part$i.err"), $target, $utf8)
    [IO.File]::WriteAllText((Join-Path $d "part$i.code"), [string]$codes[$i - 1], $utf8)
  }
  return $d
}
$ok = Get-PatchRows @('01d', '10')
$human = @((Format-Out $ok 'human'), (Format-Out @($countsRow) 'human'), (Format-Out @($lineRow) 'human'))
$agent = @((Format-Out $ok 'agent'), (Format-Out @($countsRow) 'agent'), (Format-Out @($lineRow) 'agent'))

$cases = @(
  @{ n = 'human-mode array output -> PASS + snapshot'; d = (New-Fixture 'human' $human); exit = 0; snap = 'new' }
  @{ n = 'agent-mode object output -> PASS + snapshot'; d = (New-Fixture 'agent' $agent); exit = 0; snap = 'new' }
  @{ n = 'truncated JSON -> FAIL, no snapshot'; d = (New-Fixture 'trunc' @($human[0].Substring(0, 40), $human[1], $human[2])); exit = 1; snap = 'none' }
  @{ n = 'text after JSON -> FAIL, no snapshot'; d = (New-Fixture 'trailing' @($human[0], ($human[1] + "A new version is available`n"), $human[2])); exit = 1; snap = 'none' }
  @{ n = 'empty stdout -> FAIL'; d = (New-Fixture 'empty' @('', $human[1], $human[2])); exit = 1; snap = 'none' }
  @{ n = 'CLI error object -> FAIL'; d = (New-Fixture 'clierr' @('{"_tag":"Error","error":{"code":"X","message":"boom"}}', $human[1], $human[2])); exit = 1; snap = 'none' }
  @{ n = 'CLI non-zero exit -> FAIL'; d = (New-Fixture 'exit1' $human @(0, 1, 0)); exit = 1; snap = 'none' }
  @{ n = 'expected 01d but not applied -> FAIL'; d = (New-Fixture 'no01d' @((Format-Out (Get-PatchRows @('10')) 'human'), $human[1], $human[2])); exit = 1; snap = 'none' }
  @{ n = 'unexpected 01e applied -> FAIL'; d = (New-Fixture 'extra01e' @((Format-Out (Get-PatchRows @('01d', '10', '01e')) 'human'), $human[1], $human[2])); exit = 1; snap = 'none' }
  @{ n = 'duplicate LINE bindings -> FAIL'; d = (New-Fixture 'dupline' @($human[0], $human[1], (Format-Out @([ordered]@{ duplicate_line_bindings_must_be_0 = 2; line_created_users = 195; line_meta_unbound = 1 }) 'human'))); exit = 1; snap = 'none' }
  @{ n = 'missing count column -> FAIL'; d = (New-Fixture 'missingcol' @($human[0], (Format-Out @([ordered]@{ auth_users = 212 }) 'human'), $human[2])); exit = 1; snap = 'none' }
  @{ n = 'FAIL keeps an existing snapshot untouched'; d = (New-Fixture 'keepold' @($human[0].Substring(0, 40), $human[1], $human[2])); exit = 1; snap = 'keep' }
)

$results = @()
foreach ($t in $cases) {
  $snap = Join-Path $t.d 'snapshot.json'
  if ($t.snap -eq 'keep') { [IO.File]::WriteAllText($snap, '{"marker":"old"}', $utf8) }
  $cmd = "chcp 950 > `$null; [Console]::OutputEncoding = [Text.Encoding]::GetEncoding(950); & '$runner' -ExpectApplied '01d','10' -FixtureDir '$($t.d)' -SaveSnapshot '$snap'; exit `$LASTEXITCODE"
  $log = & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $cmd 2>&1 | Out-String
  $code = $LASTEXITCODE
  $good = ($code -eq $t.exit)
  switch ($t.snap) {
    'new' {
      $good = $good -and (Test-Path $snap)
      if (Test-Path $snap) {
        $j = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($snap, $utf8))
        $good = $good -and $j.patches.'01d' -eq $true -and $j.patches.'10' -eq $true -and $j.patches.'01e' -eq $false -and
          [decimal]$j.counts.sessions -eq 52 -and [decimal]$j.counts.wallet_balance_cents_sum -eq 1101000000 -and
          [decimal]$j.counts.duplicate_line_bindings_must_be_0 -eq 0
      }
    }
    'none' { $good = $good -and -not (Test-Path $snap) }
    'keep' { $good = $good -and ([IO.File]::ReadAllText($snap, $utf8) -eq '{"marker":"old"}') }
  }
  $good = $good -and -not (Get-ChildItem $t.d -Filter 'snapshot.json.tmp-*' -ErrorAction SilentlyContinue)
  $results += $good
  Write-Host ("{0}  {1}  (exit {2})" -f $(if ($good) { 'PASS' } else { 'FAIL' }), $t.n, $code) -ForegroundColor $(if ($good) { 'Green' } else { 'Red' })
  if (-not $good) { Write-Host $log }
}
Remove-Item -Recurse -Force $root
$passed = @($results | Where-Object { $_ }).Count
Write-Host "`n$passed/$($results.Count) passed"
if ($passed -ne $results.Count) { exit 1 } else { exit 0 }
