<#
.SYNOPSIS
  正式 Worker（badminton-drop-in-prod，正式 Supabase ngudidpitcfyzmbphlgt）的建置、檢查與部署。
  預設只「建置 + 靜態檢查 + dry-run」，不上傳。上傳必須同時給 -Deploy 與 -ConfirmWorker badminton-drop-in-prod。

.DESCRIPTION
  檢查（任何一項失敗即中止，不上傳）：
    - Cloudflare 帳號必須是 feb96af4be0e308c286c3fd8d50e1941（cf-account-guard.ps1）
    - 工作區乾淨、HEAD 已推送到 origin（部署的版本可追溯）
    - -EnvFile 只能有公開的 NEXT_PUBLIC_* 值：
        NEXT_PUBLIC_SUPABASE_URL = https://ngudidpitcfyzmbphlgt.supabase.co
        NEXT_PUBLIC_SUPABASE_ANON_KEY 為正式專案的 anon key（JWT ref / role 檢查）
        NEXT_PUBLIC_LINE_LIFF_ID 必填（正式 LIFF；與 Vercel 相同）
      不得含 service_role、Cloudflare 憑證、Demo / 唯讀旗標
    - 建置產物：Worker 名稱、正式 Supabase URL 存在；Staging ref / Demo 假後端 / service_role 不得出現
    - cloudflare.config.ts 不得宣告 routes / 網域（本階段只用 workers.dev）
  金流：程式碼內 ONLINE_PAYMENTS_ENABLED = false（不是環境變數），本腳本另外確認仍為 false。

  -SetServiceRoleFile <path>：上傳後把正式 service_role 設成 Worker secret（檔案在 repo 外；值不顯示）。

  切換前存取閘門（src/worker/prodGate.ts，fail closed）：本腳本一律以 NEXT_PUBLIC_PROD_ACCESS_GATE=1 建置，並確認產物含閘門。
    - Worker secret PROD_GATE_PASSWORD（>= 16 字元）：測試人員以 Basic Auth 進入。未設定 → 整站 503。
    - Worker secret PROD_SITE_PUBLIC = '1'：正式公開（切換當天才設定；本腳本不會設定它）。
  -SetGatePasswordFile <path>：上傳後把 PROD_GATE_PASSWORD 設成 Worker secret（檔案在 repo 外；值不顯示）。
  部署後會列出 secrets：PROD_SITE_PUBLIC 已存在時顯示「已公開」警告。

  Secret 檔可以只有值，或單行 NAME=value（只取值）。service_role 必須是純 JWT（ref / role 正確）或 sb_secret_，
  並先以唯讀 GET 向正式 Supabase 驗證（HTTP 200）才會上傳；任何一項不符即中止。
  -SecretsOnly：只更新 Worker secrets（不建置、不上傳程式碼），需 -ConfirmWorker。

.EXAMPLE
  # 1) 只檢查（不上傳、不需核准）
  .\scripts\cloudflare\cf-deploy-prod.ps1 -IgnoreEnvToken -EnvFile D:\project\secrets\prod.env
  # 2) 正式部署（需使用者核准；部署後站台維持上鎖，只有持有閘門密碼者可進入）
  .\scripts\cloudflare\cf-deploy-prod.ps1 -IgnoreEnvToken -EnvFile D:\project\secrets\prod.env -Deploy -ConfirmWorker badminton-drop-in-prod -SetServiceRoleFile D:\project\secrets\prod-service-role.txt -SetGatePasswordFile D:\project\secrets\prod-gate-password.txt
  # 3) 只修正 Worker secret（需使用者核准；程式碼不變）
  .\scripts\cloudflare\cf-deploy-prod.ps1 -IgnoreEnvToken -EnvFile D:\project\secrets\prod.env -SecretsOnly -ConfirmWorker badminton-drop-in-prod -SetServiceRoleFile D:\project\secrets\prod-service-role.txt
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$EnvFile,
  [switch]$Deploy,
  [string]$ConfirmWorker,
  [string]$SetServiceRoleFile,
  [string]$SetGatePasswordFile,
  [switch]$SecretsOnly,
  [switch]$IgnoreEnvToken
)

$ErrorActionPreference = 'Stop'
$ProdRef = 'ngudidpitcfyzmbphlgt'
$ProdUrl = "https://$ProdRef.supabase.co"
$StagingRef = 'cwvhxkujxsurvrmjexvm'
$WorkerName = 'badminton-drop-in-prod'
$WebRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Guard = Join-Path $PSScriptRoot 'cf-account-guard.ps1'

function Say([string]$m, [string]$c = 'Gray') { Write-Host "[cf-deploy-prod] $m" -ForegroundColor $c }
function Fail([string]$m) { Say "FAIL: $m" 'Red'; exit 2 }
function Decode-JwtPayload([string]$jwt) {
  $p = $jwt.Split('.')
  if ($p.Count -ne 3) { return $null }
  $s = $p[1].Replace('-', '+').Replace('_', '/')
  switch ($s.Length % 4) { 2 { $s += '==' } 3 { $s += '=' } }
  try { return ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) | ConvertFrom-Json) } catch { return $null }
}
function Read-DotEnv([string]$Path) {
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  foreach ($line in Get-Content -Encoding UTF8 $Path) {
    $mm = [regex]::Match($line, '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$')
    if (-not $mm.Success) { continue }
    $v = $mm.Groups[2].Value.Trim()
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) { $v = $v.Substring(1, $v.Length - 2) }
    $map[$mm.Groups[1].Value] = $v
  }
  return $map
}

# --- secret files ------------------------------------------------------------------
# 檔案可以是「只有值」或單行「NAME=value」（例如 Service_Role_Key=eyJ...）；只取值，且值必須嚴格符合格式。
# 曾發生：整行 "Service_Role_Key=eyJ..." 被當成 secret 上傳，Supabase 回 Invalid API key。
function Read-SecretFile([string]$Path, [string[]]$Names) {
  if (-not (Test-Path $Path)) { Fail "secret file not found: $Path" }
  $full = (Resolve-Path $Path).Path
  if ($full -like "$((Resolve-Path (Join-Path $WebRoot '..')).Path)*") { Fail "$Path must live outside the repository." }
  $raw = [IO.File]::ReadAllText($full).Trim([char]0xFEFF, ' ', "`r", "`n", "`t")
  $lines = @($raw -split "`r?`n" | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') })
  if ($lines.Count -ne 1) { Fail "$Path must contain exactly one non-comment line (found $($lines.Count))." }
  $line = $lines[0].Trim()
  $m = [regex]::Match($line, '^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$')
  if ($m.Success) {
    if ($Names -notcontains $m.Groups[1].Value) { Fail "$Path is NAME=value with an unexpected name '$($m.Groups[1].Value)'." }
    $line = $m.Groups[2].Value.Trim().Trim('"').Trim("'")
    Say "$Path is in NAME=value form; using only the value." 'Yellow'
  }
  return $line
}
function Get-ServiceRoleKey([string]$Path) {
  $v = Read-SecretFile $Path @('SUPABASE_SERVICE_ROLE_KEY', 'Service_Role_Key', 'SERVICE_ROLE_KEY')
  $isJwt = $v -cmatch '^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
  if ($isJwt) {
    $p = Decode-JwtPayload $v
    if (-not $p -or $p.ref -ne $ProdRef -or $p.role -ne 'service_role') { Fail 'service role file is not the production service_role key (JWT ref/role).' }
  } elseif ($v -notmatch '^sb_secret_[A-Za-z0-9_-]{16,}$') {
    Fail 'service role file does not contain a bare JWT or sb_secret_ key.'
  }
  # 線上驗證：唯讀 GET（limit=1），只看狀態碼，不輸出內容與金鑰
  $headers = @{ apikey = $v }
  if ($isJwt) { $headers.Authorization = "Bearer $v" }
  try {
    $code = [int](Invoke-WebRequest -UseBasicParsing -Method Get -Uri "$ProdUrl/rest/v1/session_operation_reports?select=id&limit=1" -Headers $headers -TimeoutSec 20).StatusCode
  } catch { $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 } }
  if ($code -ne 200) { Fail "service role key rejected by production Supabase (HTTP $code); it will not be uploaded." }
  Say 'service role key: format ok and accepted by production Supabase (read-only check)' 'Green'
  return $v
}
function Get-GatePassword([string]$Path) {
  $v = Read-SecretFile $Path @('PROD_GATE_PASSWORD')
  if ($v.Length -lt 16) { Fail 'gate password must be at least 16 characters.' }
  if ($v -match '\s') { Fail 'gate password must not contain whitespace.' }
  return $v
}
function Set-WorkerSecret([string]$Name, [string]$Value) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $lines = & $Guard -IgnoreEnvToken:$IgnoreEnvToken -CfArgs @('workers', 'secrets', 'update', $Name, '--worker', $WorkerName, '--text', $Value, '--type', 'secret_text') 2>&1 |
    ForEach-Object { ("$_" -replace [regex]::Escape($Value), '***') }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  $lines | Select-Object -Last 3 | ForEach-Object { Say $_ }
  if ($code -ne 0) { Fail "setting Worker secret $Name failed (exit $code)." }
  Say "Worker secret $Name updated" 'Green'
}
function Show-SecretStatus {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $list = (& $Guard -IgnoreEnvToken:$IgnoreEnvToken -CfArgs @('workers', 'secrets', 'list', '--worker', $WorkerName) 2>&1 | ForEach-Object { "$_" }) -join "`n"
  $ErrorActionPreference = $prev
  if ($list -notmatch 'SUPABASE_SERVICE_ROLE_KEY') { Say 'SUPABASE_SERVICE_ROLE_KEY is NOT set on the Worker: LINE login, signup notifications and admin APIs will fail until it is.' 'Yellow' }
  if ($list -match 'PREVIEW_ACCESS_PASSWORD') { Fail 'PREVIEW_ACCESS_PASSWORD must not exist on the production Worker.' }
  if ($list -notmatch 'PROD_GATE_PASSWORD') { Say 'PROD_GATE_PASSWORD is NOT set: the whole site answers 503 (fail closed) until it is.' 'Yellow' }
  if ($list -match 'PROD_SITE_PUBLIC') { Say 'WARNING: PROD_SITE_PUBLIC exists on the Worker - the site is PUBLIC if its value is 1.' 'Yellow' }
  else { Say 'access gate: LOCKED (PROD_SITE_PUBLIC not set). Open at cutover only.' 'Green' }
}

if (($Deploy -or $SecretsOnly) -and $ConfirmWorker -ne $WorkerName) { Fail "-Deploy / -SecretsOnly require -ConfirmWorker $WorkerName (production changes must be explicit)." }
if ($Deploy -and $SecretsOnly) { Fail '-Deploy and -SecretsOnly cannot be combined.' }
if (($SetServiceRoleFile -or $SetGatePasswordFile) -and -not ($Deploy -or $SecretsOnly)) { Fail '-SetServiceRoleFile / -SetGatePasswordFile need -Deploy or -SecretsOnly.' }
# 先驗證（建置前就失敗，不會上傳一半）
$ServiceRoleKey = if ($SetServiceRoleFile) { Get-ServiceRoleKey $SetServiceRoleFile } else { $null }
$GatePassword = if ($SetGatePasswordFile) { Get-GatePassword $SetGatePasswordFile } else { $null }

# --- secrets only: no git / build / upload of code ------------------------------------
if ($SecretsOnly) {
  if (-not $ServiceRoleKey -and -not $GatePassword) { Fail '-SecretsOnly needs -SetServiceRoleFile and/or -SetGatePasswordFile.' }
  if ($ServiceRoleKey) { Set-WorkerSecret 'SUPABASE_SERVICE_ROLE_KEY' $ServiceRoleKey }
  if ($GatePassword) { Set-WorkerSecret 'PROD_GATE_PASSWORD' $GatePassword }
  Remove-Variable ServiceRoleKey, GatePassword -ErrorAction SilentlyContinue
  Show-SecretStatus
  Say 'secrets updated (code unchanged)' 'Green'
  exit 0
}

# --- git: clean tree, pushed HEAD -------------------------------------------------
$branch = (& git -C $WebRoot rev-parse --abbrev-ref HEAD 2>$null)
$head = (& git -C $WebRoot rev-parse --short HEAD 2>$null)
if (-not $head) { Fail 'not a git checkout.' }
$dirty = (& git -C $WebRoot status --porcelain --untracked-files=no -- . 2>$null)
if ($dirty) { Fail "web/ has uncommitted changes. Commit and push first:`n$dirty" }
& git -C $WebRoot fetch -q origin 2>$null
$onRemote = (& git -C $WebRoot branch -r --contains HEAD 2>$null)
if (-not $onRemote) { Fail "HEAD $head is not pushed to origin." }
Say "branch = $branch, HEAD = $head (pushed)"

# --- worker config -----------------------------------------------------------------
$configText = Get-Content -Raw -Encoding UTF8 (Join-Path $WebRoot 'cloudflare.config.ts')
if ($configText -notmatch ('(?m)^\s*prod:\s*"' + [regex]::Escape($WorkerName) + '"')) { Fail "cloudflare.config.ts must map prod -> '$WorkerName'." }
if ($configText -match '(?im)^\s*(routes|route|customDomains?|domains?|zone)\s*:') { Fail 'cloudflare.config.ts declares routes/domains; this phase stays on workers.dev.' }
$gate = Get-Content -Raw -Encoding UTF8 (Join-Path $WebRoot 'src\lib\payments\paymentGate.ts')
if ($gate -notmatch 'ONLINE_PAYMENTS_ENABLED\s*=\s*false') { Fail 'paymentGate.ts: ONLINE_PAYMENTS_ENABLED must stay false.' }

# --- env file ------------------------------------------------------------------------
$envPath = (Resolve-Path $EnvFile).Path
if ($envPath -like "$((Resolve-Path (Join-Path $WebRoot '..')).Path)*") { Fail "-EnvFile must live outside the repository (e.g. D:\project\secrets\prod.env)." }
$vars = Read-DotEnv $envPath
foreach ($k in $vars.Keys) {
  if ($k -notlike 'NEXT_PUBLIC_*') { Fail "-EnvFile may only contain NEXT_PUBLIC_* build values (found $k). Secrets go to Worker secrets." }
}
if ($vars['NEXT_PUBLIC_SUPABASE_URL'].TrimEnd('/') -ne $ProdUrl) { Fail "NEXT_PUBLIC_SUPABASE_URL must be $ProdUrl." }
$anon = Decode-JwtPayload $vars['NEXT_PUBLIC_SUPABASE_ANON_KEY']
if (-not $anon -or $anon.ref -ne $ProdRef -or $anon.role -ne 'anon') { Fail 'NEXT_PUBLIC_SUPABASE_ANON_KEY must be the production anon key (JWT role=anon, ref=ngudidpitcfyzmbphlgt).' }
if (-not $vars['NEXT_PUBLIC_LINE_LIFF_ID']) { Fail 'NEXT_PUBLIC_LINE_LIFF_ID is required (same value as the Vercel production env).' }
foreach ($flag in @('NEXT_PUBLIC_DEMO_PREVIEW', 'NEXT_PUBLIC_READONLY_PREVIEW')) {
  if ($vars[$flag] -and $vars[$flag] -ne '0') { Fail "$flag must not be enabled for production." }
}
foreach ($f in @('.env.production.local', '.env.local', '.env.production', '.env')) {
  $m = Read-DotEnv (Join-Path $WebRoot $f)
  foreach ($flag in @('NEXT_PUBLIC_DEMO_PREVIEW', 'NEXT_PUBLIC_READONLY_PREVIEW')) { if ($m[$flag] -eq '1') { Fail "web/$f enables $flag; remove it before a production build." } }
}
Say "env: Supabase=$ProdUrl (anon ok), LIFF id set, $($vars.Count) public values" 'Green'

# --- build ---------------------------------------------------------------------------
$saved = @{}
function Set-Env([string]$n, [string]$v) { if (-not $saved.ContainsKey($n)) { $saved[$n] = [Environment]::GetEnvironmentVariable($n, 'Process') }; [Environment]::SetEnvironmentVariable($n, $v, 'Process') }
try {
  foreach ($k in $vars.Keys) { Set-Env $k $vars[$k] }
  Set-Env 'NEXT_PUBLIC_DEMO_PREVIEW' '0'
  Set-Env 'NEXT_PUBLIC_READONLY_PREVIEW' '0'
  Set-Env 'NEXT_PUBLIC_PROD_ACCESS_GATE' '1'   # 切換前存取閘門（fail closed）；開放改由 Worker secret PROD_SITE_PUBLIC 控制
  Set-Env 'BADMINTON_CF_TARGET' 'prod'
  Push-Location $WebRoot
  try {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & npx vite build 2>&1 | ForEach-Object { "$_" } | Select-Object -Last 3 | ForEach-Object { Say $_ }
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
  } finally { Pop-Location }
  if ($code -ne 0) { Fail "vite build exited with $code" }

  $out = Join-Path $WebRoot '.cloudflare\output\v0'
  $built = (Get-Content -Raw (Join-Path $out 'workers\default\worker.config.json') | ConvertFrom-Json).name
  if ($built -ne $WorkerName) { Fail "built worker name '$built' != '$WorkerName'." }
  $js = @(Get-ChildItem $out -Recurse -File -Include *.js, *.json, *.html)
  if (@($js | Select-String -SimpleMatch $ProdUrl -List).Count -eq 0) { Fail 'build output does not contain the production Supabase URL.' }
  # Demo 假後端的判斷常數（demo-preview.invalid）一定在程式碼內；Demo 只在 NEXT_PUBLIC_DEMO_PREVIEW=1 時啟用，上面已強制為 0。
  foreach ($bad in @($StagingRef)) {
    $hits = @($js | Select-String -SimpleMatch $bad -List)
    if ($hits.Count -gt 0) { Fail "build output contains '$bad' ($($hits.Count) files)." }
  }
  # service_role 金鑰不可進入產物（JWT payload 內 "role":"service_role" 的 base64 片段）
  foreach ($frag in @('c2VydmljZV9yb2xl', 'InNlcnZpY2Vfcm9sZS', 'sb_secret_')) {
    $hits = @($js | Select-String -SimpleMatch $frag -List)
    if ($hits.Count -gt 0) { Fail "build output contains a service_role-looking key fragment '$frag'." }
  }
  # repo 外已知密鑰檔的值不可出現在產物
  foreach ($sf in @('D:\project\secrets\staging-service-role.txt', 'D:\project\secrets\badminton-readonly-preview-password.txt')) {
    if ($sf -and (Test-Path $sf)) {
      $sv = (Get-Content -Raw $sf).Trim()
      if ($sv.Length -ge 16 -and @($js | Select-String -SimpleMatch $sv -List).Count -gt 0) { Fail "build output contains the value of $sf." }
    }
  }
  if ($ServiceRoleKey -and @($js | Select-String -SimpleMatch $ServiceRoleKey -List).Count -gt 0) { Fail 'build output contains the production service_role key.' }
  # 切換前存取閘門必須在 Worker 產物內（標記字串來自 src/worker/prodGate.ts）
  $workerJs = @(Get-ChildItem (Join-Path $out 'workers') -Recurse -File -Include *.js, *.mjs)
  foreach ($marker in @('prod-gate-v1', 'PROD_SITE_PUBLIC', 'PROD_GATE_PASSWORD')) {
    if (@($workerJs | Select-String -SimpleMatch $marker -List).Count -eq 0) { Fail "worker bundle does not contain the production access gate ($marker)." }
  }
  # 閘門密碼不可進入產物
  if ($GatePassword -and @($js | Select-String -SimpleMatch $GatePassword -List).Count -gt 0) { Fail 'build output contains the gate password.' }
  Say "verified build: worker=$built, Supabase=$ProdUrl, access gate present, no staging/demo/service_role, payments disabled" 'Green'

  # --- upload (guarded) ------------------------------------------------------------
  $deployArgs = @('deploy', '--skip-build')
  if (-not $Deploy) { $deployArgs += '--dry-run'; Say 'DRY RUN only (production upload needs -Deploy -ConfirmWorker badminton-drop-in-prod)' 'Yellow' }
  $vinextCli = Join-Path $WebRoot 'node_modules\@vinext\cloudflare\dist\cli.js'
  & $Guard -IgnoreEnvToken:$IgnoreEnvToken -Run { & node $vinextCli @deployArgs }
  if ($LASTEXITCODE -ne 0) { Fail "guard or deploy exited with $LASTEXITCODE" }

  if ($Deploy -and $ServiceRoleKey) { Set-WorkerSecret 'SUPABASE_SERVICE_ROLE_KEY' $ServiceRoleKey }
  if ($Deploy -and $GatePassword) { Set-WorkerSecret 'PROD_GATE_PASSWORD' $GatePassword }
  if ($Deploy) {
    Show-SecretStatus
    Say "deployed https://$WorkerName.senyingtang2025.workers.dev (HEAD $head)" 'Green'
  }
  Say 'done' 'Green'
} finally {
  foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') }
}
