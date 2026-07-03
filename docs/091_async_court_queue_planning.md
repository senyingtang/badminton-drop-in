# 091：待上場預排組／非指定場地號碼排組流程 — 技術設計

> **階段**：Planning only（本文件不變更 production flow）  
> **日期**：2026-07-04  
> **相關診斷**：`docs/091_round_queue_diagnostics.sql`

---

## 摘要

臨打實務上各面場結束時間不同，現行「每面場各自預排下一輪草稿（`rounds.court_no` + `round_no`）」仍要求**建立當下就綁定場地號碼**。091 目標是引入 **待上場組 queue**：團主先產生 N 組（每組 4 人、不指定場地），任一面場結束後再將 queue 頭一組補上該場並鎖定開打，同時補產新 queue 維持緩衝。

**設計原則**

- 不破壞現有同步排組路徑（wave / per-court draft）— 以 **feature flag** 並行。
- **不修改** `assignment-engine.ts` 核心演算法；queue 產生可 **呼叫** `generateAssignment(players, groupCount)`，僅改讀寫層。
- AI 僅產生建議；**deterministic validation** + 團主確認後才寫入 queue。
- 上場次數仍只在 **`lock_round_and_increment_counters`** 時遞增（與現行一致）。

---

## 1. 現有模型盤點（Part A）

### 1.1 資料表與欄位

| 實體 | 表名 | 關鍵欄位 | 說明 |
|------|------|----------|------|
| 輪次 | `rounds` | `session_id`, **`court_no`**, `round_no`, `status`, `locked_at`, `finished_at` | 029 後為 **每面場獨立輪次序列**；`unique(session_id, court_no, round_no)` |
| 比賽 | `matches` | `round_id`, **`court_no`**, `match_label`, `final_score_*`, `confirmed_at` | 每 round 每 court 一場；`unique(round_id, court_no)` |
| 隊伍／球員 | `match_teams`, `match_team_players` | `participant_id` | 標準 2v2 結構 |
| 排組建議 | `assignment_recommendations` | `session_id`, `round_no`, **`court_no`**, `status`, `source` | `status`: draft / generated / applied / discarded |
| 建議明細 | `assignment_recommendation_items` | `recommendation_id`, **`court_no`**, `team_no`, `participant_id` | `court_no >= 1` NOT NULL |
| 場次面場 | `sessions.court_count` | 預設面場數 | 與 `session_courts`（sort_order → 實體 court_no）搭配 |
| 參與者 | `session_participants` | `status`, `total_matches_played`, `consecutive_rounds_played`, `is_locked_for_current_round`, `leave_after_current_round`, `unavailable` 等 | 排組候選池與鎖定狀態 |

> 備註：早期 schema v1 有 `round_matches`；**現行 production 為 `matches`**（`001_base_schema.sql`）。

### 1.2 現行 UI／程式流程（`RoundList.tsx`）

| 操作 | 入口 | 後端 |
|------|------|------|
| 產生第一輪（全部面場） | `openFirstWavePreview` → `generateAssignment(players, courtCount)` | `apply_assignment_recommendation_and_create_round(session, court_no, round_no=1, payload)` × N 面場 |
| 預排下一輪（單面場） | `openNextRoundPreviewForCourt(slot)` → `generateAssignment(players, 1)` | 同上，`input_court_no` = 該 slot 實體場號 |
| 鎖定開打 | `RoundPanel` → `lock_round_and_increment_counters` | `round.status`: draft → locked；參與者 +1 上場次數 |
| 結束本輪 | `handleFinishRound` → `finish_round_and_release_locks` | `round.status`: locked → finished；解鎖、更新 consecutive；若全場無 locked 則 `session.status` → `round_finished` |
| 手機排組精簡檢視 | `showMobileRoundsCompactTop` | `participantsCache`（`list_session_participants_for_host` + `session_participants` 暱稱欄位）+ `rounds` 的 draft/locked 占用集 |

場地號碼存在：

- `rounds.court_no`（實體租借場號，經 058 `session_courts` 映射）
- `matches.court_no`（與 round 一致）
- `assignment_recommendation_items.court_no`
- Payload 內 `courtNo`（slot sortOrder 或 physical，由 `normalizeRoundCourtKey` 轉換）

### 1.3 Part A 問答

| # | 問題 | 答案 |
|---|------|------|
| 1 | 現在是否強依賴 `court_number`？ | **是。** `rounds.court_no`、`matches.court_no` 皆 NOT NULL；`apply_assignment` 強制 `input_court_no >= 1`；建立草稿時即綁定場地。 |
| 2 | `round` 是否代表「同步的一輪」？ | **否（029 之後）。** 每面場有獨立 `round_no` 序列；場地 A 第 3 輪與場地 B 第 2 輪可並存。語意上 round = **該面場的一次排組生命週期**（draft→locked→finished）。 |
| 3 | `match` 是否可不指定 `court_number`？ | **否。** `matches.court_no` NOT NULL，`chk_matches_court_no >= 1`。 |
| 4 | 是否已有 `queued` / `active` / `completed`？ | **無 queued。** `round_status_type`: draft / locked / finished / cancelled。`matches` 無獨立 status；「進行中」= 所屬 round `locked`。`completed` 對應 round `finished`。 |
| 5 | 是否已有 `started_at` / `completed_at`？ | **部分。** `rounds.locked_at`（開打）、`rounds.finished_at`（結束）；`matches.confirmed_at`（比分確認）。**無** match 級 `started_at` / `completed_at`。 |
| 6 | 手機排組模式資料來源？ | `fetchRounds`：`rounds` 巢狀 `matches` + RPC `list_session_participants_for_host` + `session_participants` 暱稱；`currentRosterBuckets` 依 draft/locked 占用切分場上／等待。 |

---

## 2. 新模型建議（Part B）

### 2.1 概念對照

| 新概念 | 建議承載方式 |
|--------|----------------|
| `queued_groups`（待上場組，不指定場地） | **新表** `session_queue_groups`（首選）或擴充 `assignment_recommendations`（次選，需 nullable `court_no`） |
| `active_matches`（已上場） | **沿用** `rounds`（status=locked）+ `matches` |
| `completed_matches`（已完成） | **沿用** `rounds`（status=finished）+ `matches`（含比分） |

**不建議** 直接用 `matches` 承載 queued：現有 FK `round_id` NOT NULL 且 `court_no` NOT NULL，與「未指定場地」衝突。

### 2.2 建議新表（Migration Proposal — 尚未實作）

```sql
-- PROPOSAL ONLY — docs/092_session_queue_groups.sql（未來實作檔名建議）

create type session_queue_group_status_type as enum (
  'queued',      -- 待上場
  'assigned',    -- 已指派場地、建立 draft round（過渡）
  'active',      -- 已 lock（可與 round locked 冗餘，或省略）
  'completed',   -- 所屬 round finished
  'cancelled'
);

create table public.session_queue_groups (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  queue_position integer not null,          -- 1 = 下一組
  status session_queue_group_status_type not null default 'queued',
  source generation_source_type not null default 'rule_engine',
  rule_summary text,
  ai_summary text,
  debug_payload jsonb not null default '{}',
  -- 指派後填入
  assigned_court_no integer,
  assigned_round_id uuid references public.rounds(id) on delete set null,
  created_by_user_id uuid references public.app_user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, queue_position)  -- 重新整理 queue 時整批更新 position
);

create table public.session_queue_group_players (
  id uuid primary key default gen_random_uuid(),
  queue_group_id uuid not null references public.session_queue_groups(id) on delete cascade,
  team_no smallint not null check (team_no in (1, 2)),
  seat_no smallint not null check (seat_no in (1, 2)),
  participant_id uuid not null references public.session_participants(id) on delete cascade,
  unique (queue_group_id, participant_id),
  unique (queue_group_id, team_no, seat_no)
);
```

**狀態流**

```
generate N groups → status=queued (無 court_no)
       ↓
court X 結束本輪 → promote_queue_head_to_court(session, court_no=X)
       ↓
建立 draft round + match（現有結構）+ 關聯 assigned_round_id
       ↓
團主確認 / 自動 → lock_round_and_increment_counters（現有）
       ↓
finish_round_and_release_locks → queue group → completed
       ↓
可選：自動 generate 1 組補回 queue（維持 queue 深度 = 開場面數）
```

### 2.3 與現有 `rounds` 並存策略

- **Legacy 模式**（預設）：行為不變。
- **Queue 模式**（`sessions.metadata.queue_mode = true` 或 feature flag）：
  - 隱藏／弱化「預排下一輪 · N 號場」按鈕。
  - 顯示「待上場組」區塊 + 「排 1／2／全部」。
  - `finish_round` 後可選「自動補 queue 到該場」。

### 2.4 次選：僅擴充 `assignment_recommendations`（較少表、較多約束改動）

- `assignment_recommendations.court_no` 改 **nullable**；`NULL` = 待上場。
- 新增 `recommendation_status_type` 值 `queued`。
- `assignment_recommendation_items.court_no` 改 nullable 或固定 `0`（需放寬 `chk_ari_court_no`）。
- **風險**：現有 RPC 假設 `court_no >= 1`；需全面審查 030/058/059 等函式。

**結論**：首選獨立 queue 表，與現有 `rounds`/`matches` 邊界清晰，歷史資料零影響。

---

## 3. 預排組數量（Part C）

### 3.1 團主操作

| 按鈕 | `groupCount` | 說明 |
|------|--------------|------|
| 排 1 組 | 1 | 4 人 |
| 排 2 組 | 2 | 8 人 |
| 排全部場地 | `sessions.court_count`（或 `session_courts` 列數） | 例如 3 面場 → 3 組 12 人 |

### 3.2 候選池規則（與現行 `getAssignablePlayers` 對齊）

沿用 `RoundList.getAssignablePlayers` 篩選，**不修改** `assignment-engine.ts`：

1. `status` ∈ `confirmed_main`, `promoted_from_waitlist`
2. `leave_after_current_round = false`
3. `is_locked_for_current_round = false`
4. 不在任一 `draft` / `locked` round 的 `match_team_players` 中
5. **新增**：不在任一 `session_queue_groups`（status=`queued`）的 player 列中
6. `status = unavailable`（暫停）排除

排序與配對規則由 `generateAssignment` 處理：

- 隊內級差 ≤ 1（軟性提示）
- 上場次數少者優先
- 連續上場 ≥ 2 者往後

### 3.3 產生多組演算法（wrapper，非改核心）

```text
remaining = getAssignablePlayers()
groups = []
for i in 1..groupCount:
  result = generateAssignment(remaining, 1)  // 現有函式，courtCount=1
  if result.assignments.length == 0: break
  groups.push(result.assignments[0])
  remaining = remaining.filter(p => not in this group)
persist groups to session_queue_groups
```

人數不足時：產生實際可排組數 + UI 提示（與現行 `pairingHints` 一致）。

---

## 4. AI API 可行性（Part D）

### 4.1 現況盤點

| 項目 | 狀態 |
|------|------|
| Env | `AI_API_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_PROVIDER`, 各 provider key（見 `lib/ai/server-config.ts`） |
| Provider | custom / openai / openrouter / deepseek / groq / mistral / ollama |
| Route | `GET /api/ai/status`, `POST /api/ai/chat`（OpenAI 相容 proxy） |
| Helper | `getAiServerConfig()`, `buildChatCompletionsUrl()` |
| `worker_jobs` | **不存在** |
| DB `generation_source_type` | 已有 `ai_assisted` enum 值（尚未用於排組 flow） |
| 排組 AI 整合 | **無**；設定頁 `AiIntegrationCard` 僅說明 chat API |

### 4.2 AI 使用方式（Proposal）

**新 route（建議）**：`POST /api/sessions/[id]/assignment/ai-suggest`

- Input：候選池 snapshot（participant id、level、totalPlayed、consecutivePlayed、displayName）
- 呼叫內部 `lib/ai/assignmentSuggest.ts`（新建）→ `POST` 至既有 chat completions（不暴露 key 給 client）
- Output：`{ suggestions: CourtAssignment[], rationale: string, source: 'ai_assisted' }` — **僅 JSON，不寫 DB**

**AI 允許**：產生排組建議、說明理由、排序候選組合。

**AI 禁止**：直接 INSERT/UPDATE queue 或 rounds；忽略暫停／離場；忽略級數規則；忽略上場次數平衡。

**Fallback**：AI 逾時／格式錯誤／validation 失敗 → `generateAssignment`（rule engine）。

### 4.3 Deterministic Validation（`lib/assignment/validateQueueGroup.ts` — 建議新建）

對每一組（4 個 `participantId`）：

| # | 規則 | 失敗處理 |
|---|------|----------|
| 1 | 4 個 id 皆存在於候選池 snapshot | reject group |
| 2 | `status` = confirmed_main（或含 promoted，與現行一致） | reject |
| 3 | 非 `unavailable` | reject |
| 4 | `leave_after_current_round = false` | reject |
| 5 | 非 `is_locked_for_current_round` | reject |
| 6 | 不在其他 queued / draft / locked 中 | reject |
| 7 | 4 人無重複 | reject |
| 8 | 隊內級差 ≤ 1（與 engine 一致，可 warn 不阻擋） | hint |
| 9 | level 在 1–18 | reject |
| 10 | 跨組批次：同一 participant 不可出現在多個 queued group | reject 整批 |

通過 validation 後，團主在 UI 預覽確認 → `POST /api/sessions/[id]/queue-groups` 寫入。

---

## 5. UI 設計（Part E）

### 5.1 手機排組模式（Queue 模式開啟時）

```
┌─────────────────────────────────────┐
│ 區塊 1：進行中場地                    │
│  場地 5：A/B vs C/D    [結束本輪]     │
│  場地 6：E/F vs G/H    [結束本輪]     │
├─────────────────────────────────────┤
│ 區塊 2：待上場組（queue_position）    │
│  下一組 1：I/J vs K/L  [編輯][取消]   │
│  下一組 2：M/N vs O/P  [編輯][取消]   │
├─────────────────────────────────────┤
│ 區塊 3：等待池（依 total_matches 排序）│
│  …                                   │
└─────────────────────────────────────┘
 固定底部列：
 排組模式｜待上場 2 組
 [排 1 組] [排 2 組] [排全部]
```

### 5.2 桌機 `RoundList`

- 保留現有「面場分欄輪次卡」作為 **進行中／歷史** 檢視。
- 頂部新增 **待上場 queue** 橫向列表（可拖曳調整 `queue_position` — 二期）。
- 「結束本輪」後 Modal：「將待上場組 1 補至本場？」［是］［稍後手動］。

### 5.3 編輯待上場組

- 複用 `AssignmentPreview` + `swapPlayers`（僅 client state）。
- 確認後 PATCH queue group players。

---

## 6. API Proposal

| Method | Path | 說明 |
|--------|------|------|
| `GET` | `/api/sessions/[id]/queue-groups` | 列出 queued + 摘要 |
| `POST` | `/api/sessions/[id]/queue-groups/generate` | body: `{ count: 1\|2\|courtCount, source?: 'rule_engine'\|'ai_assisted' }` |
| `POST` | `/api/sessions/[id]/queue-groups/ai-suggest` | 僅回傳建議，不寫入 |
| `POST` | `/api/sessions/[id]/queue-groups/[gid]/assign` | body: `{ court_no }` — 建立 draft round |
| `PATCH` | `/api/sessions/[id]/queue-groups/[gid]` | 編輯球員 |
| `DELETE` | `/api/sessions/[id]/queue-groups/[gid]` | 取消 queued |
| `POST` | `/api/sessions/[id]/courts/[courtNo]/finish-and-refill` | 包裝 `finish_round` + optional `assign` queue head |

DB RPC（未來）：

- `generate_session_queue_groups(session_id, count, payload)`
- `promote_queue_group_to_court(queue_group_id, court_no)` — 內部呼叫現有 match 建立邏輯

---

## 7. 風險清單（Part F）

| # | 風險 | 等級 | 緩解 |
|---|------|------|------|
| 1 | 現有 round/court 結構 **不支援** queued（court_no NOT NULL） | 高 | 獨立 queue 表；不修改現有 draft 語意 |
| 2 | 歷史排組紀錄 | 低 | 新表新 flow；舊 `rounds` 不遷移 |
| 3 | 上場次數統計 | 中 | queue 不呼叫 lock；僅 promote→lock 時 increment（與現行一致） |
| 4 | 營運報表 | 低 | 不依賴 round queue；**不修改** |
| 5 | LINE 通知 | 低 | 不新增推播；**不修改** recipient 邏輯 |
| 6 | 手機 UI | 中 | 新區塊 + 底部列；需 375px 不橫向捲動測試 |
| 7 | Rollback | — | Feature flag 關閉 → 隱藏 queue UI；queue 表資料可保留或 soft-cancel |
| 8 | Feature flag | 建議 | `sessions.metadata.scheduling_mode = 'legacy'\|'queue'` 或 env `FEATURE_COURT_QUEUE=1` |

### Rollback Plan

1. Flag 設回 `legacy`。
2. 取消所有 `status=queued` groups（不影響進行中 locked rounds）。
3. 團主繼續用現有 per-court 預排按鈕。

### Rollout Plan（建議分三期）

| 期 | 內容 |
|----|------|
| **091** | 本設計文件 + diagnostics（完成） |
| **092** | Migration `session_queue_groups` + generate/promote RPC + flag |
| **093** | 手機／桌機 queue UI + validation + AI suggest route |
| **094** | 試點場次 → 預設開啟評估 |

---

## 8. Open Questions

1. **Queue 深度上限**：是否固定 = `court_count`，或允許團主累積更多組？
2. **自動補場**：結束本輪後是否預設自動 promote（需不需要比分必填才可結束—現行已必填）？
3. **Promote 時 round_no**：該面場 `max(round_no)+1`（與現行 per-court 一致）？
4. **AI 成本**：每場次 suggest 次數是否限流（rate limit per host）？
5. **Realtime**：queue 變更是否訂閱 `session_queue_groups` postgres_changes（與 rounds 相同）？
6. **多團主**：並發 promote 同一 queue head 的鎖定策略（`for update skip locked`）？
7. **候補遞補**：promoted_from_waitlist 是否自動進入 queue 候選（現行已在 getAssignablePlayers）？

---

## 9. 與限制對照

| 限制 | 遵守 |
|------|------|
| 本階段僅 planning | ✅ 僅 docs |
| 不動排組核心演算法 | ✅ wrapper 呼叫 `generateAssignment` |
| 不動正式 DB schema | ✅ 僅 proposal |
| Phase 4 / 付款 / 分潤 | ✅ 未觸及 |
| 營運報表 | ✅ 未觸及 |
| 報名流程 | ✅ 未觸及 |
| Messaging API | ✅ 未觸及 |

---

## 附錄：現行 enum 參考

```sql
-- round_status_type
'draft', 'locked', 'finished', 'cancelled'

-- recommendation_status_type
'draft', 'generated', 'applied', 'discarded'

-- generation_source_type
'rule_engine', 'ai_assisted', 'manual'
```
