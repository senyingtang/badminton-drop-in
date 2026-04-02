-- 建立測試使用者（需在 auth 建立後手動對應）
insert into kb_players (id, nickname)
values
(gen_random_uuid(), '玩家A'),
(gen_random_uuid(), '玩家B'),
(gen_random_uuid(), '玩家C'),
(gen_random_uuid(), '玩家D'),
(gen_random_uuid(), '玩家E'),
(gen_random_uuid(), '玩家F');

-- 建立測試 session
insert into kb_sessions (id, name, host_user_id, status)
values
(gen_random_uuid(), '測試場', auth.uid(), 'draft');