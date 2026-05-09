-- 066_next_round_flexible_roster_and_court_slots.sql
-- 本次新增功能所需的最小 DB 補強（不修改 057-065；不批次修舊 rounds/matches；不處理 terminal sessions）。
--
-- 目標：
-- - 名單彈性旗標（若不存在才新增）
-- - 供 UI / 後續 RPC 使用的備註欄位（若不存在才新增）
--
-- 注意：本檔不修改公開報名流程（share_signup_code / self_signup_to_session_by_share_code）。

begin;

alter table public.session_participants
  add column if not exists unavailable_for_next_round boolean not null default false;

alter table public.session_participants
  add column if not exists leave_after_current_round boolean not null default false;

alter table public.session_participants
  add column if not exists roster_note text;

comment on column public.session_participants.unavailable_for_next_round is '僅影響下一輪排組候選池：true 表示下一輪暫不排入';
comment on column public.session_participants.leave_after_current_round is '本輪打完後離場（不影響已鎖定本輪）';
comment on column public.session_participants.roster_note is '名單備註（例如本場不打、臨時狀況）';

commit;

