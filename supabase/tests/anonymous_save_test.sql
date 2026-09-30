-- 익명 계정 저장 + 교환 기록 검사 — npx supabase test db
-- worklog-mac/records/cloud-authority/design-p2.md 1·3·4·7절, 8절 SQL 항목
-- 교환의 익명 거부·규약 2·3인자 set_offer 는 trade_test.sql 에서 본다
-- 한 트랜잭션 안이라 now() 가 고정이다. 시간 경과는 postgres 역할로 시각 칸을 옮겨 재현한다
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- P4 서버 검증: 앱은 upload_save RPC 대신 Edge Function upload-save 를 거친다(20261003100000_save_verify.sql).
-- 이 시험은 검증 없이 같은 저장 경로(accept_save, 위반 없음, 비교한 rev = 지금 rev)를 부른다. 트랜잭션 안에서만 있는 도우미다
create function public.test_upload(p_device uuid, p_base_rev bigint, p_save jsonb, p_save_v int, p_app_version text, p_op uuid)
returns bigint language sql security definer set search_path = '' as $f$
  select public.accept_save(auth.uid(), p_device, p_base_rev, (select c.rev from public.cloud_saves c where c.user_id = auth.uid()), p_save, p_save_v, p_app_version, p_op, '[]'::jsonb)
$f$;
grant execute on function public.test_upload(uuid, bigint, jsonb, int, text, uuid) to authenticated;

-- 로컬 DB 에 남은 원장·예약 행이 시험 개체 지문과 겹치지 않게 비운다 (트랜잭션 끝에 되돌린다)
delete from cloud_private.pet_ledger;
delete from trade_private.pet_offers;

-- 사용자: a* 는 익명, b* 는 로그인 계정, c* 는 정리 작업 대상
insert into auth.users (id, email, raw_user_meta_data, is_anonymous, aud, role, created_at) values
  ('00000000-0000-0000-0000-0000000000a1', null, '{}', true, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000a2', null, '{}', true, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000a3', null, '{}', true, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000a4', null, '{}', true, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000a5', null, '{}', true, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000a6', null, '{}', true, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000a7', null, '{}', true, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000a8', null, '{}', true, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000a9', null, '{}', true, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000aa', null, '{}', true, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000b1', 'anon_b1@example.com', '{}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000b2', 'anon_b2@example.com', '{}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000b3', 'anon_b3@example.com', '{}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000b4', 'anon_b4@example.com', '{}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000b5', 'anon_b5@example.com', '{}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000b6', 'anon_b6@example.com', '{}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000b7', 'anon_b7@example.com', '{}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000b8', 'anon_b8@example.com', '{}', false, 'authenticated', 'authenticated', now());

create temp table kv (k text primary key, v text);
grant all on kv to authenticated;

-- who 는 uuid 끝 두 자리. 토큰의 is_anonymous 는 참고용이다(함수는 계정 행을 본다)
create function pg_temp.act(who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', '00000000-0000-0000-0000-0000000000' || who,
    'role', 'authenticated',
    'is_anonymous', who like 'a%')::text, true);
$$;
grant execute on function pg_temp.act(text) to authenticated;
create function pg_temp.v(key text) returns text language sql as $$ select v from kv where k = key $$;
grant execute on function pg_temp.v(text) to authenticated;
create function pg_temp.uid(who text) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000' || who)::uuid $$;
grant execute on function pg_temp.uid(text) to authenticated;

-- 첫 선택만 마친 새 게임 저장(fresh)
create function pg_temp.fresh() returns jsonb language sql as $$
  select '{
    "v": 3,
    "pets": [{"id":"p1","since":5000,"species":"pichu","shiny":false,"nature":"hardy","level":1,"stage":0,"evolved":[]}],
    "starterPetId": "p1",
    "party": {"slots": [{"state":"pokemon","petId":"p1"},{"state":"empty"},{"state":"locked"},{"state":"locked"},{"state":"locked"},{"state":"locked"}]},
    "boxes": [{"id":"b1","name":"박스 1","slots":[null,null,null]}],
    "eggs": [], "eggSeq": 0, "bag": {},
    "points": {"balance":120,"progressMs":0},
    "dex": {"unlocked":["pichu"],"obtained":["pichu"],"shinyObtained":[]},
    "totals": {"workMs":0,"presenceMs":0},
    "trade": {"pending":null},
    "mail": {"applied":[],"read":[]}
  }'::jsonb;
$$;
grant execute on function pg_temp.fresh() to authenticated;
create function pg_temp.fresh_with(path text[], val jsonb) returns jsonb language sql as $$
  select jsonb_set(pg_temp.fresh(), path, val);
$$;
grant execute on function pg_temp.fresh_with(text[], jsonb) to authenticated;

-- ── 1. 익명 새 설치: claim·touch·받기·첫 올리기 ──
set local role authenticated;
select pg_temp.act('a1');
select results_eq($$ select outcome, rev, updated_at, has_save, other_label, other_seen from public.claim_device('d1000000-0000-0000-0000-000000000001', 'PC 1', '0.13.0', 'boot', false) $$,
  $$ values ('claimed'::text, 0::bigint, null::timestamptz, false, null::text, null::timestamptz) $$, '익명 claim 은 행 없이 claimed(F11)');
select results_eq($$ select active, rev from public.touch_device('d1000000-0000-0000-0000-000000000001', '0.13.0', 'active') $$,
  $$ values (true, 0::bigint) $$, '익명 touch 는 행이 없으면 (true, 0)');
select results_eq($$ select save, rev, save_v from public.download_save('d1000000-0000-0000-0000-000000000001') $$,
  $$ values (null::jsonb, 0::bigint, null::int) $$, '익명 받기는 행이 없으면 빈 저장');
select throws_ok($$ select public.test_upload('d1000000-0000-0000-0000-000000000001', 0, '{"v":3,"pets":[]}', 3, '0.13.0', 'a1000000-0000-0000-0000-000000000001') $$,
  'P0001', 'CLOUD_EMPTY_SAVE', '개체가 없는 첫 올리기는 거절');
select throws_ok($$ select public.test_upload('d1000000-0000-0000-0000-000000000001', 1, pg_temp.fresh(), 3, '0.13.0', 'a1000000-0000-0000-0000-000000000002') $$,
  'P0001', 'CLOUD_REV_CONFLICT', '첫 올리기의 base_rev 는 0');
select throws_ok($$ select public.test_upload('d1000000-0000-0000-0000-000000000001', 0, pg_temp.fresh(), 3, '0.12.0', 'a1000000-0000-0000-0000-000000000003') $$,
  'P0001', 'CLOUD_UPDATE_REQUIRED', '낮은 버전은 첫 올리기도 거절');
reset role;
select ok(not exists (select 1 from public.cloud_saves where user_id = pg_temp.uid('a1')), '거절한 동안 익명 행은 만들지 않는다');
set local role authenticated;
select pg_temp.act('a1');
select is(public.test_upload('d1000000-0000-0000-0000-000000000001', 0, pg_temp.fresh(), 3, '0.13.0', 'a1000000-0000-0000-0000-000000000004'), 1::bigint, '첫 실제 올리기가 행을 만든다 → rev 1');
select is(public.test_upload('d1000000-0000-0000-0000-000000000001', 0, pg_temp.fresh(), 3, '0.13.0', 'a1000000-0000-0000-0000-000000000004'), 1::bigint, '같은 op 재전송은 rev 1');
reset role;
select results_eq($$ select active_device, rev, trust, presence, last_op_rev from public.cloud_saves where user_id = pg_temp.uid('a1') $$,
  $$ values ('d1000000-0000-0000-0000-000000000001'::uuid, 1::bigint, 'fresh'::text, 'active'::text, 1::bigint) $$, '첫 올리기: 이 PC 가 활성, 분류 fresh');
select ok((select first_saved_at = now() from public.cloud_saves where user_id = pg_temp.uid('a1')), '첫 저장 시각을 남긴다');
set local role authenticated;
select pg_temp.act('a1');
select results_eq($$ select outcome, rev, has_save from public.claim_device('d1000000-0000-0000-0000-000000000001', 'PC 1', '0.13.0', 'boot', false) $$,
  $$ values ('claimed'::text, 1::bigint, true) $$, '행이 생긴 뒤 claim 은 보통 규칙');
select results_eq($$ select active, rev from public.touch_device('d2000000-0000-0000-0000-000000000002', '0.13.0', 'active') $$,
  $$ values (false, 1::bigint) $$, '행이 생긴 뒤 다른 PC 의 touch 는 active=false');
select is(public.test_upload('d1000000-0000-0000-0000-000000000001', 1, pg_temp.fresh_with('{pets,0,level}', '10'), 3, '0.13.0', 'a1000000-0000-0000-0000-000000000005'), 2::bigint, '다음 올리기 → rev 2');
reset role;
select is((select trust from public.cloud_saves where user_id = pg_temp.uid('a1')), 'fresh', '분류는 첫 저장 뒤 바뀌지 않는다');

-- ── 2. 첫 저장 분류(3절) ──
select ok(cloud_private.is_fresh(pg_temp.fresh()), '새 게임 저장은 fresh');
select ok(cloud_private.is_fresh(pg_temp.fresh_with('{pets,0,level}', '3')), '레벨 3 까지 fresh');
select ok(cloud_private.is_fresh(pg_temp.fresh_with('{points,balance}', '220')), '포인트 220 까지 fresh');
select ok(cloud_private.is_fresh(pg_temp.fresh_with('{bag}', '{"a":1,"b":2}')), '도구 합 3 까지 fresh');
select ok(cloud_private.is_fresh(pg_temp.fresh_with('{totals}', '{"workMs":3600000,"presenceMs":3600000}')), '누적 2시간까지 fresh');
select ok(cloud_private.is_fresh(pg_temp.fresh() - 'trade' - 'mail'), 'trade·mail 칸이 없어도 fresh');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{v}', '2')), 'v 가 3 이 아니면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{pets}', '[]')), '개체 0 이면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{pets,1}', '{"id":"p2","since":6000,"species":"pichu","shiny":false,"level":1,"stage":0,"evolved":[]}')), '개체 2 면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{starterPetId}', '"p9"')), '첫 선택 개체가 아니면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{pets,0,shiny}', 'true')), '이로치면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{pets,0,stage}', '1')), '진화했으면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{pets,0,evolved}', '["pichu"]')), '거쳐 온 종이 있으면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{pets,0,forms}', '[]')), '모습(forms) 칸이 있으면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{pets,0,species}', '"pikachu"')), '첫 선택 후보가 아닌 종이면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{pets,0,level}', '4')), '레벨 4 면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{eggs}', '[{"id":"e1"}]')), '알이 있으면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{eggSeq}', '1')), '알을 만든 적이 있으면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{points,balance}', '221')), '포인트 221 이면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{bag}', '{"a":4}')), '도구 합 4 면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{dex,shinyObtained}', '["pichu"]')), '이로치 도감이 있으면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{dex,obtained}', '["pichu","eevee"]')), '얻은 종 2 면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{party,slots,2}', '{"state":"empty"}')), '열린 파티 칸 3 이면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{boxes,0,slots,0}', '"p1"')), '박스에 개체가 있으면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{trade,pending}', '{"channelId":"x","petId":"p1"}')), '교환 pending 이 있으면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{mail,applied}', '["l1"]')), '우편 선물을 넣었으면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{totals}', '{"workMs":3600000,"presenceMs":3600001}')), '누적 2시간 넘으면 아님');
select ok(not cloud_private.is_fresh(pg_temp.fresh_with('{points,balance}', '"abc"')), '숫자 자리가 문자면 오류 없이 아님');
select ok(not cloud_private.is_fresh('[]'::jsonb), '객체가 아니면 아님');
select is(cloud_private.first_trust(pg_temp.fresh()), 'fresh', 'first_trust: fresh');
select is(cloud_private.first_trust(pg_temp.fresh_with('{pets,0,level}', '50')), 'legacy', 'fresh 가 아니고 legacy 창 안이면 legacy');
select ok((select value::timestamptz > now() + interval '29 days' from cloud_private.settings where key = 'legacy_until'), 'legacy_until 초기값은 약 30일 뒤');
update cloud_private.settings set value = (now() - interval '1 second')::text where key = 'legacy_until';
select is(cloud_private.first_trust(pg_temp.fresh_with('{pets,0,level}', '50')), 'unverified', 'legacy 창이 지나면 unverified');
select is(cloud_private.first_trust(pg_temp.fresh()), 'fresh', '창이 지나도 fresh 는 fresh');
delete from cloud_private.settings where key = 'legacy_until';
select is(cloud_private.first_trust(pg_temp.fresh_with('{pets,0,level}', '50')), 'unverified', 'legacy_until 설정이 없으면 unverified');
insert into cloud_private.settings (key, value) values ('legacy_until', (now() + interval '30 days')::text);
select ok(cloud_private.setting('starter_species') like 'bulbasaur,%,eevee', '첫 선택 후보 설정이 있다');
select is(array_length(string_to_array(cloud_private.setting('starter_species'), ','), 1), 29, '첫 선택 후보는 29종(data/unlocks.json starter)');

-- 로그인 계정의 첫 올리기(행은 있고 save 가 비었음)도 분류를 정한다
set local role authenticated;
select pg_temp.act('b1');
select lives_ok($$ select * from public.claim_device('d3000000-0000-0000-0000-000000000003', 'PC 3', '0.13.0', 'boot', false) $$, 'b1 claim');
select is(public.test_upload('d3000000-0000-0000-0000-000000000003', 0, pg_temp.fresh_with('{pets,0,level}', '50'), 3, '0.13.0', 'b1000000-0000-0000-0000-000000000001'), 1::bigint, 'b1 첫 올리기');
select is(public.test_upload('d3000000-0000-0000-0000-000000000003', 1, pg_temp.fresh(), 3, '0.13.0', 'b1000000-0000-0000-0000-000000000002'), 2::bigint, 'b1 두 번째 올리기');
reset role;
select results_eq($$ select trust, first_saved_at is not null from public.cloud_saves where user_id = pg_temp.uid('b1') $$,
  $$ values ('legacy'::text, true) $$, '로그인 첫 저장도 분류한다. 뒤의 fresh 저장이 분류를 바꾸지 않는다');

-- 진행 있음(7절)
select ok(not cloud_private.has_progress(pg_temp.fresh()), '새 게임은 진행 없음');
select ok(cloud_private.has_progress(pg_temp.fresh_with('{pets,1}', '{"id":"p2","level":1}')), '개체 2 면 진행 있음');
select ok(cloud_private.has_progress(pg_temp.fresh_with('{eggs}', '[{"id":"e1"}]')), '알 1 이면 진행 있음');
select ok(cloud_private.has_progress(pg_temp.fresh_with('{pets,0,level}', '2')), '레벨 2 면 진행 있음');
select ok(not cloud_private.has_progress(null), '저장이 없으면 진행 없음');

-- ── 3. 원장(4절) ──
-- b3·b4 가 서버 저장을 올리고 교환을 끝낸다
set local role authenticated;
select pg_temp.act('b3');
select lives_ok($$ select * from public.claim_device('d4000000-0000-0000-0000-000000000004', 'PC 4', '0.13.0', 'boot', false) $$, 'b3 claim');
select is(public.test_upload('d4000000-0000-0000-0000-000000000004', 0,
  '{"v":3,"pets":[{"id":"p1","since":3001,"species":"pikachu","shiny":false,"nature":"hardy","level":9},{"id":"p2","since":3002,"species":"eevee","shiny":false,"nature":"calm","level":5}]}',
  3, '0.13.0', 'b3000000-0000-0000-0000-000000000001'), 1::bigint, 'b3 올리기');
with c as (select * from public.create_channel(2, 'dv1'))
insert into kv values ('ch', (select channel_id::text from c)), ('tok', (select token from c));
select pg_temp.act('b4');
select lives_ok($$ select * from public.claim_device('d5000000-0000-0000-0000-000000000005', 'PC 5', '0.13.0', 'boot', false) $$, 'b4 claim');
select is(public.test_upload('d5000000-0000-0000-0000-000000000005', 0,
  '{"v":3,"pets":[{"id":"p1","since":4001,"species":"mudkip","shiny":false,"nature":"brave","level":7}]}',
  3, '0.13.0', 'b4000000-0000-0000-0000-000000000001'), 1::bigint, 'b4 올리기');
select lives_ok($$ select public.join_channel(pg_temp.v('tok'), 2, 'dv1') $$, 'b4 참가');
-- P5: 앱이 보낸 레벨이 서버 값보다 크면 아직 올리지 않은 진행 — 옛 서버 값으로 제안하지 않는다
select throws_ok($$ select public.set_offer(pg_temp.v('ch')::uuid, '{"species":"mudkip","level":100,"shiny":false,"nature":"brave"}', '{"id":"p1","since":4001}') $$,
  'P0001', 'TRADE_PET_NOT_SYNCED', 'P5 앱 레벨이 서버보다 크면 NOT_SYNCED');
-- 채널의 제안은 서버 저장 값으로 만든다 — 앱이 보낸 다른 칸(affinity 등)은 쓰지 않는다
select is(public.set_offer(pg_temp.v('ch')::uuid, '{"species":"mudkip","level":7,"affinity":100,"shiny":false,"nature":"brave"}', '{"id":"p1","since":4001}'), 1, 'b4 제안');
reset role;
select is((select (guest_offer ->> 'level')::int from public.trade_channels where id = pg_temp.v('ch')::uuid), 7, 'P5 제안 레벨은 서버 저장 값');
select is((select guest_offer ->> 'affinity' from public.trade_channels where id = pg_temp.v('ch')::uuid), null, 'P5 앱이 보낸 값은 제안에 쓰지 않는다');
select pg_temp.act('b3');
select is(public.set_offer(pg_temp.v('ch')::uuid, '{"species":"pikachu","level":9,"shiny":false,"nature":"hardy"}', '{"id":"p1","since":3001}'), 2, 'b3 제안');
select is(public.set_ready(pg_temp.v('ch')::uuid, 2)::text, 'joined', 'b3 확정');
select pg_temp.act('b4');
select is(public.set_ready(pg_temp.v('ch')::uuid, 2)::text, 'done', 'b4 확정 → done');
-- P5: 끝나는 순간 받은 제안을 남긴다 — 반영(ack_applied) 뒤 채널 제안이 지워져도 검증이 대조한다
reset role;
select is((select count(*)::int from cloud_private.trade_receipts where channel_id = pg_temp.v('ch')::uuid), 2, 'P5 두 사람의 받은 제안');
select is((select (offer ->> 'level')::int from cloud_private.trade_receipts r join public.trade_channels c on c.id = r.channel_id
  where r.channel_id = pg_temp.v('ch')::uuid and r.user_id = c.host), 7, 'P5 호스트가 받은 제안은 게스트의 서버 저장 값');
select pg_temp.act('b4');
select is(public.set_ready(pg_temp.v('ch')::uuid, 2)::text, 'done', '같은 확정을 다시 보내도 원장이 겹치지 않는다');
reset role;
select is((select count(*)::int from cloud_private.pet_ledger where channel_id = pg_temp.v('ch')::uuid), 2, 'done 은 원장 2행');

-- 되돌리기: 보낸 개체가 남은 저장(pending 없음)은 거부
set local role authenticated;
select pg_temp.act('b3');
select throws_ok($$ select public.test_upload('d4000000-0000-0000-0000-000000000004', 1,
  '{"v":3,"pets":[{"id":"p1","since":3001,"species":"pikachu"},{"id":"p2","since":3002,"species":"eevee"}],"trade":{"pending":null}}',
  3, '0.13.0', 'b3000000-0000-0000-0000-000000000002') $$, 'P0001', 'CLOUD_PET_TRADED_OUT', '교환 뒤 보낸 개체가 남은 저장은 거부(.bak 되돌리기)');
select throws_ok($$ select public.set_offer(pg_temp.v('ch')::uuid, '{"species":"pikachu","level":9,"shiny":false,"nature":"hardy"}', '{"id":"p1","since":3001}') $$,
  'P0001', 'TRADE_CLOSED', '끝난 채널에는 제안하지 못한다');
-- 예외: 반영 전 저장(pending 이 그 채널·그 개체, 7일 이내). 반영 알림 여부는 보지 않는다(검수 M1)
select is(public.test_upload('d4000000-0000-0000-0000-000000000004', 1,
  jsonb_build_object('v', 3, 'pets', '[{"id":"p1","since":3001,"species":"pikachu"},{"id":"p2","since":3002,"species":"eevee"}]'::jsonb,
    'trade', jsonb_build_object('pending', jsonb_build_object('channelId', pg_temp.v('ch'), 'petId', 'p1'))),
  3, '0.13.0', 'b3000000-0000-0000-0000-000000000003'), 2::bigint, '반영 전 저장(pending)은 받는다');
select throws_ok($$ select public.test_upload('d4000000-0000-0000-0000-000000000004', 2,
  jsonb_build_object('v', 3, 'pets', '[{"id":"p1","since":3001,"species":"pikachu"}]'::jsonb,
    'trade', jsonb_build_object('pending', jsonb_build_object('channelId', pg_temp.v('ch'), 'petId', 'p2'))),
  3, '0.13.0', 'b3000000-0000-0000-0000-000000000004') $$, 'P0001', 'CLOUD_PET_TRADED_OUT', 'pending 의 개체가 다르면 예외가 아니다');
select lives_ok($$ select public.ack_applied(pg_temp.v('ch')::uuid) $$, 'b3 반영 알림');
select throws_ok($$ select public.test_upload('d4000000-0000-0000-0000-000000000004', 2,
  jsonb_build_object('v', 3, 'pets', '[{"id":"p1","since":3001,"species":"pikachu"}]'::jsonb,
    'trade', jsonb_build_object('pending', jsonb_build_object('channelId', pg_temp.v('ch'), 'petId', 'p2'))),
  3, '0.13.0', 'b3000000-0000-0000-0000-000000000005') $$, 'P0001', 'CLOUD_PET_TRADED_OUT', '반영 알림 뒤에도 pending 의 개체가 다르면 거부');
-- 올리기 전송 중에 반영·알림이 끝난 경우: 알림 뒤에 도착한 pending 저장도 7일 안이면 받는다
select is(public.test_upload('d4000000-0000-0000-0000-000000000004', 2,
  jsonb_build_object('v', 3, 'pets', '[{"id":"p1","since":3001,"species":"pikachu"}]'::jsonb,
    'trade', jsonb_build_object('pending', jsonb_build_object('channelId', pg_temp.v('ch'), 'petId', 'p1'))),
  3, '0.13.0', 'b3000000-0000-0000-0000-000000000009'), 3::bigint, '반영 알림 뒤에도 pending 저장은 7일 안이면 받는다');
reset role;
select ok((select host_applied_at is not null from public.trade_channels where id = pg_temp.v('ch')::uuid), '아래 7일 경계 시험은 반영 알림이 있는 채로 한다');
update cloud_private.pet_ledger set done_at = now() - interval '7 days' where channel_id = pg_temp.v('ch')::uuid;
set local role authenticated;
select pg_temp.act('b3');
select throws_ok($$ select public.test_upload('d4000000-0000-0000-0000-000000000004', 3,
  jsonb_build_object('v', 3, 'pets', '[{"id":"p1","since":3001,"species":"pikachu"}]'::jsonb,
    'trade', jsonb_build_object('pending', jsonb_build_object('channelId', pg_temp.v('ch'), 'petId', 'p1'))),
  3, '0.13.0', 'b3000000-0000-0000-0000-000000000006') $$, 'P0001', 'CLOUD_PET_TRADED_OUT', '7일이 지나면 pending 이 있어도 거부');
reset role;
update cloud_private.pet_ledger set done_at = now() - interval '7 days' + interval '1 minute' where channel_id = pg_temp.v('ch')::uuid;
set local role authenticated;
select pg_temp.act('b3');
select is(public.test_upload('d4000000-0000-0000-0000-000000000004', 3,
  jsonb_build_object('v', 3, 'pets', '[{"id":"p1","since":3001,"species":"pikachu"}]'::jsonb,
    'trade', jsonb_build_object('pending', jsonb_build_object('channelId', pg_temp.v('ch'), 'petId', 'p1'))),
  3, '0.13.0', 'b3000000-0000-0000-0000-000000000007'), 4::bigint, '7일 1분 전 완료는 예외');
select is(public.test_upload('d4000000-0000-0000-0000-000000000004', 4,
  '{"v":3,"pets":[{"id":"p2","since":3002,"species":"eevee"},{"id":"p3","since":9999,"species":"mudkip"}],"trade":{"pending":null}}',
  3, '0.13.0', 'b3000000-0000-0000-0000-000000000008'), 5::bigint, '반영한 저장(보낸 개체 없음)은 받는다');

-- 다른 계정으로 복사: 남이 내보낸 지문이 지금 서버 저장에 없으면 거부
select pg_temp.act('a2');
select throws_ok($$ select public.test_upload('d6000000-0000-0000-0000-000000000006', 0,
  jsonb_set(pg_temp.fresh(), '{pets,1}', '{"id":"p1","since":4001,"species":"mudkip"}'), 3, '0.13.0', 'a2000000-0000-0000-0000-000000000001') $$,
  'P0001', 'CLOUD_PET_TRADED_OUT', '백업을 새 익명 계정 첫 저장으로 — 교환한 개체는 막힌다');
select is(public.test_upload('d6000000-0000-0000-0000-000000000006', 0, pg_temp.fresh(), 3, '0.13.0', 'a2000000-0000-0000-0000-000000000002'), 1::bigint, '교환한 개체가 없으면 들어간다');
select throws_ok($$ select public.test_upload('d6000000-0000-0000-0000-000000000006', 1,
  jsonb_set(pg_temp.fresh(), '{pets,1}', '{"id":"p1","since":4001,"species":"mudkip"}'), 3, '0.13.0', 'a2000000-0000-0000-0000-000000000003') $$,
  'P0001', 'CLOUD_PET_TRADED_OUT', '행이 있어도 남의 교환 개체를 새로 넣으면 거부');
reset role;
-- 지금 서버 저장에 이미 있던 개체면 막지 않는다(우연히 같은 지문)
update public.cloud_saves set save = jsonb_set(pg_temp.fresh(), '{pets,1}', '{"id":"p1","since":4001,"species":"mudkip"}') where user_id = pg_temp.uid('a2');
set local role authenticated;
select pg_temp.act('a2');
select is(public.test_upload('d6000000-0000-0000-0000-000000000006', 1,
  jsonb_set(pg_temp.fresh(), '{pets,1}', '{"id":"p1","since":4001,"species":"mudkip","level":3}'), 3, '0.13.0', 'a2000000-0000-0000-0000-000000000004'), 2::bigint,
  '남의 교환 지문이 이미 서버 저장에 있었으면 받는다');
select pg_temp.act('b4');
select throws_ok($$ select public.test_upload('d5000000-0000-0000-0000-000000000005', 1,
  '{"v":3,"pets":[{"id":"p1","since":4001,"species":"mudkip"}]}', 3, '0.13.0', 'b4000000-0000-0000-0000-000000000002') $$,
  'P0001', 'CLOUD_PET_TRADED_OUT', '보낸 쪽(b4)도 pending 없이 보낸 개체를 남기면 거부');

-- ── 4. 이관(handoff) ──
set local role authenticated;
select pg_temp.act('b1');
select throws_ok($$ select public.begin_handoff() $$, 'P0001', 'CLOUD_HANDOFF_INVALID', '로그인 계정은 티켓을 만들지 못한다');
select pg_temp.act('a1');
insert into kv values ('t_a1_old', public.begin_handoff());
insert into kv values ('t_a1', public.begin_handoff());
select ok(length(pg_temp.v('t_a1')) >= 40, '티켓은 32바이트(base64url 43자)');
select throws_ok($$ select * from public.adopt_anonymous(pg_temp.v('t_a1')) $$, 'P0001', 'CLOUD_LOGIN_REQUIRED', '익명은 이관을 받지 못한다');
reset role;
select is((select count(*)::int from cloud_private.handoff_tickets where anon_id = pg_temp.uid('a1')), 1, '새 티켓을 만들면 옛 티켓은 지운다');
select ok((select expires_at = now() + interval '10 minutes' from cloud_private.handoff_tickets where anon_id = pg_temp.uid('a1')), '티켓은 10분 뒤 만료');
select ok(not exists (select 1 from cloud_private.handoff_tickets where hash = convert_to(pg_temp.v('t_a1'), 'UTF8')), '티켓 원문은 저장하지 않는다');

-- moved: 로그인 계정에 행이 없다
set local role authenticated;
select pg_temp.act('b5');
select throws_ok($$ select * from public.adopt_anonymous(pg_temp.v('t_a1_old')) $$, 'P0001', 'CLOUD_HANDOFF_INVALID', '옛 티켓은 쓰지 못한다');
select throws_ok($$ select * from public.adopt_anonymous('없는티켓') $$, 'P0001', 'CLOUD_HANDOFF_INVALID', '없는 티켓');
select throws_ok($$ select * from public.adopt_anonymous(null) $$, 'P0001', 'CLOUD_HANDOFF_INVALID', '빈 티켓');
select results_eq($$ select outcome, rev from public.adopt_anonymous(pg_temp.v('t_a1')) $$,
  $$ values ('moved'::text, 1::bigint) $$, '익명 저장을 옮긴다 → moved, rev 1');
select throws_ok($$ select * from public.adopt_anonymous(pg_temp.v('t_a1')) $$, 'P0001', 'CLOUD_HANDOFF_INVALID', '같은 티켓을 다시 쓰지 못한다');
reset role;
select results_eq($$ select save -> 'pets' -> 0 ->> 'level', trust, first_saved_at = now(), active_device from public.cloud_saves where user_id = pg_temp.uid('b5') $$,
  $$ values ('10'::text, 'fresh'::text, true, null::uuid) $$, '저장·분류·첫 저장 시각이 따라간다. 활성 기기는 로그인 계정 것(없음)');
select ok(not exists (select 1 from auth.users where id = pg_temp.uid('a1')), 'security definer 함수가 익명 auth.users 를 지운다');
select ok(not exists (select 1 from public.cloud_saves where user_id = pg_temp.uid('a1')), '익명 저장 행은 함께 지워진다');
select results_eq($$ select anon_id, member_id, outcome, anon_rev, trust from cloud_private.handoffs where anon_id = pg_temp.uid('a1') $$,
  $$ values (pg_temp.uid('a1'), pg_temp.uid('b5'), 'moved'::text, 2::bigint, 'fresh'::text) $$, '이관 감사 기록');
set local role authenticated;
select pg_temp.act('a1');
select throws_ok($$ select * from public.claim_device('d1000000-0000-0000-0000-000000000001', 'PC 1', '0.13.0', 'boot', false) $$, 'P0001', 'CLOUD_LOGIN_REQUIRED', '이관 뒤 옛 익명 토큰은 LOGIN_REQUIRED(F3)');
select throws_ok($$ select public.test_upload('d1000000-0000-0000-0000-000000000001', 2, pg_temp.fresh(), 3, '0.13.0', 'a1000000-0000-0000-0000-000000000009') $$, 'P0001', 'CLOUD_LOGIN_REQUIRED', '옛 익명 토큰은 올리지 못한다');
select throws_ok($$ select public.begin_handoff() $$, 'P0001', 'CLOUD_LOGIN_REQUIRED', '옛 익명 토큰은 티켓을 만들지 못한다');
select pg_temp.act('b5');
select results_eq($$ select outcome, rev, has_save from public.claim_device('d1000000-0000-0000-0000-000000000001', 'PC 1', '0.13.0', 'boot', false) $$,
  $$ values ('claimed'::text, 1::bigint, true) $$, '로그인 계정이 옮겨 온 저장을 claim 한다');

-- moved: 로그인 계정에 행은 있고 저장이 없다 → 활성 기기 유지, rev+1
select pg_temp.act('b6');
select lives_ok($$ select * from public.claim_device('d7000000-0000-0000-0000-000000000007', 'PC 7', '0.13.0', 'boot', false) $$, 'b6 claim(저장 없음)');
select pg_temp.act('a4');
select is(public.test_upload('d8000000-0000-0000-0000-000000000008', 0, pg_temp.fresh(), 3, '0.13.0', 'a4000000-0000-0000-0000-000000000001'), 1::bigint, 'a4 첫 올리기');
insert into kv values ('t_a4', public.begin_handoff());
select pg_temp.act('b6');
select results_eq($$ select outcome, rev from public.adopt_anonymous(pg_temp.v('t_a4')) $$,
  $$ values ('moved'::text, 1::bigint) $$, '저장 없는 행으로 옮긴다 → rev 0+1');
reset role;
select results_eq($$ select active_device, trust, save is not null from public.cloud_saves where user_id = pg_temp.uid('b6') $$,
  $$ values ('d7000000-0000-0000-0000-000000000007'::uuid, 'fresh'::text, true) $$, '활성 기기는 로그인 계정 것 그대로');

-- discarded: 로그인 계정에 저장이 있다(D7)
set local role authenticated;
select pg_temp.act('a5');
select is(public.test_upload('d9000000-0000-0000-0000-000000000009', 0, pg_temp.fresh(), 3, '0.13.0', 'a5000000-0000-0000-0000-000000000001'), 1::bigint, 'a5 첫 올리기');
insert into kv values ('t_a5', public.begin_handoff());
select pg_temp.act('b1');
select results_eq($$ select outcome, rev from public.adopt_anonymous(pg_temp.v('t_a5')) $$,
  $$ values ('discarded'::text, 2::bigint) $$, '로그인 계정에 저장이 있으면 discarded, rev 그대로');
reset role;
select is((select save -> 'pets' -> 0 ->> 'level' from public.cloud_saves where user_id = pg_temp.uid('b1')), '1', '로그인 계정 저장은 그대로');
select ok(not exists (select 1 from auth.users where id = pg_temp.uid('a5')), 'discarded 도 익명 계정을 지운다');

-- discarded: 익명 저장에 교환으로 내보낸 개체가 있다(막힌 지문)
insert into public.cloud_saves (user_id, save, save_v, rev, trust, active_device)
  values (pg_temp.uid('a6'), jsonb_set(pg_temp.fresh(), '{pets,1}', '{"id":"p1","since":4001,"species":"mudkip"}'), 3, 1, 'legacy', 'da000000-0000-0000-0000-00000000000a');
set local role authenticated;
select pg_temp.act('a6');
insert into kv values ('t_a6', public.begin_handoff());
select pg_temp.act('b7');
select results_eq($$ select outcome, rev from public.adopt_anonymous(pg_temp.v('t_a6')) $$,
  $$ values ('discarded'::text, 0::bigint) $$, '막힌 지문이 있으면 discarded');
reset role;
select ok(not exists (select 1 from public.cloud_saves where user_id = pg_temp.uid('b7')), '버린 저장은 옮기지 않는다');

-- empty: 익명 저장이 없다
set local role authenticated;
select pg_temp.act('a7');
insert into kv values ('t_a7', public.begin_handoff());
select pg_temp.act('b8');
select results_eq($$ select outcome, rev from public.adopt_anonymous(pg_temp.v('t_a7')) $$,
  $$ values ('empty'::text, 0::bigint) $$, '익명 저장이 없으면 empty');
reset role;
select ok(not exists (select 1 from auth.users where id = pg_temp.uid('a7')), 'empty 도 익명 계정을 지운다');

-- 만료
set local role authenticated;
select pg_temp.act('a8');
insert into kv values ('t_a8', public.begin_handoff());
reset role;
update cloud_private.handoff_tickets set expires_at = now() where anon_id = pg_temp.uid('a8');
set local role authenticated;
select pg_temp.act('b8');
select throws_ok($$ select * from public.adopt_anonymous(pg_temp.v('t_a8')) $$, 'P0001', 'CLOUD_HANDOFF_INVALID', '만료한 티켓');
reset role;
select ok(exists (select 1 from auth.users where id = pg_temp.uid('a8')), '거절하면 익명 계정은 남는다');

-- 자기 자신: 익명 계정이 정식 계정이 된 뒤 자기 티켓을 쓴다
set local role authenticated;
select pg_temp.act('a9');
insert into kv values ('t_a9', public.begin_handoff());
reset role;
update auth.users set is_anonymous = false, email = 'anon_a9@example.com' where id = pg_temp.uid('a9');
set local role authenticated;
select pg_temp.act('a9');
select throws_ok($$ select * from public.adopt_anonymous(pg_temp.v('t_a9')) $$, 'P0001', 'CLOUD_HANDOFF_INVALID', '자기 자신에게는 이관하지 못한다');
select pg_temp.act('b8');
select throws_ok($$ select * from public.adopt_anonymous(pg_temp.v('t_a9')) $$, 'P0001', 'CLOUD_HANDOFF_INVALID', '티켓 주인이 더는 익명이 아니면 거절');

-- 익명 계정에 열린 교환이 있으면 거절
reset role;
insert into public.trade_channels (token_hash, host, guest, protocol, data_version, expires_at, status)
  values (extensions.gen_random_bytes(32), pg_temp.uid('aa'), pg_temp.uid('b2'), 1, 'dv1', now() + interval '10 minutes', 'joined');
set local role authenticated;
select pg_temp.act('aa');
insert into kv values ('t_aa', public.begin_handoff());
select pg_temp.act('b8');
select throws_ok($$ select * from public.adopt_anonymous(pg_temp.v('t_aa')) $$, 'P0001', 'CLOUD_TRADE_ACTIVE', '익명 계정의 교환이 열려 있으면 거절');

-- ── 5. 정리(7절) ──
reset role;
insert into auth.users (id, email, raw_user_meta_data, is_anonymous, aud, role, created_at) values
  ('00000000-0000-0000-0000-0000000000c1', null, '{}', true, 'authenticated', 'authenticated', now() - interval '31 days'),
  ('00000000-0000-0000-0000-0000000000c2', null, '{}', true, 'authenticated', 'authenticated', now() - interval '29 days'),
  ('00000000-0000-0000-0000-0000000000c3', null, '{}', true, 'authenticated', 'authenticated', now() - interval '400 days'),
  ('00000000-0000-0000-0000-0000000000c4', null, '{}', true, 'authenticated', 'authenticated', now() - interval '400 days'),
  ('00000000-0000-0000-0000-0000000000c5', null, '{}', true, 'authenticated', 'authenticated', now() - interval '400 days'),
  ('00000000-0000-0000-0000-0000000000c6', null, '{}', true, 'authenticated', 'authenticated', now() - interval '400 days'),
  ('00000000-0000-0000-0000-0000000000c7', null, '{}', true, 'authenticated', 'authenticated', now() - interval '31 days'),
  ('00000000-0000-0000-0000-0000000000c8', null, '{}', true, 'authenticated', 'authenticated', now() - interval '31 days'),
  ('00000000-0000-0000-0000-0000000000c9', 'old_c9@example.com', '{}', false, 'authenticated', 'authenticated', now() - interval '400 days'),
  ('00000000-0000-0000-0000-0000000000ca', null, '{}', true, 'authenticated', 'authenticated', now() - interval '400 days');
insert into public.cloud_saves (user_id, save, save_v, rev, trust, last_seen, updated_at) values
  (pg_temp.uid('c3'), pg_temp.fresh(), 3, 1, 'fresh', now() - interval '31 days', now() - interval '31 days'),
  (pg_temp.uid('c4'), pg_temp.fresh(), 3, 1, 'fresh', now() - interval '29 days', now() - interval '31 days'),
  (pg_temp.uid('c5'), pg_temp.fresh_with('{pets,0,level}', '5'), 3, 1, 'fresh', now() - interval '364 days', now() - interval '364 days'),
  (pg_temp.uid('c6'), pg_temp.fresh_with('{pets,0,level}', '5'), 3, 1, 'fresh', now() - interval '366 days', now() - interval '366 days'),
  (pg_temp.uid('ca'), pg_temp.fresh(), 3, 1, 'fresh', null, now() - interval '31 days');
insert into public.trade_channels (token_hash, host, guest, protocol, data_version, expires_at, status, done_at, host_applied_at) values
  (extensions.gen_random_bytes(32), pg_temp.uid('c7'), null, 2, 'dv1', now() + interval '5 minutes', 'open', null, null),
  (extensions.gen_random_bytes(32), pg_temp.uid('c8'), pg_temp.uid('b2'), 2, 'dv1', now() - interval '20 days', 'done', now() - interval '20 days', null);
select is(trade_private.cleanup_anonymous_users(), 4, '정리 작업이 4명을 지운다');
select results_eq($$ select right(id::text, 2) from auth.users where id::text like '00000000-0000-0000-0000-0000000000c%' order by id $$,
  $$ values ('c2'), ('c4'), ('c5'), ('c7'), ('c8'), ('c9') $$,
  '(a) c1 · (b) c3·ca · (c) c6 을 지우고, 기간 안(c2·c4·c5)·열린 채널(c7)·미반영 done(c8)·로그인 계정(c9)은 남긴다');
select ok(exists (select 1 from auth.users where id = pg_temp.uid('a2')), '방금 저장한 익명 계정은 남는다');
select ok((select count(*) = 1 from cron.job where jobname = 'anonymous-cleanup'), '정리 작업이 등록돼 있다');

-- ── 6. 권한 ──
set local role authenticated;
select pg_temp.act('b1');
select throws_ok($$ select * from cloud_private.pet_ledger $$, '42501', null, '앱 역할은 원장을 읽지 못한다');
select throws_ok($$ select * from cloud_private.handoff_tickets $$, '42501', null, '앱 역할은 티켓 표를 읽지 못한다');
select throws_ok($$ select cloud_private.is_fresh('{}') $$, '42501', null, '앱 역할은 분류 함수를 실행하지 못한다');
reset role;
select ok(not has_function_privilege('authenticated', 'cloud_private.pets_blocked(uuid, jsonb, jsonb)', 'execute'), 'authenticated 는 pets_blocked 실행 권한이 없다');
select ok(not has_function_privilege('authenticated', 'cloud_private.require_account()', 'execute'), 'authenticated 는 require_account 실행 권한이 없다');
select ok(not has_function_privilege('authenticated', 'trade_private.require_member()', 'execute'), 'authenticated 는 trade_private.require_member 실행 권한이 없다');
select ok(not has_function_privilege('authenticated', 'trade_private.cleanup_anonymous_users()', 'execute'), 'authenticated 는 정리 작업을 실행하지 못한다');
select ok(not has_function_privilege('anon', 'public.begin_handoff()', 'execute'), 'anon 은 begin_handoff 를 실행하지 못한다');
select ok(not has_function_privilege('anon', 'public.adopt_anonymous(text)', 'execute'), 'anon 은 adopt_anonymous 를 실행하지 못한다');
select ok(not has_function_privilege('anon', 'public.set_offer(uuid, jsonb, jsonb)', 'execute'), 'anon 은 3인자 set_offer 를 실행하지 못한다');
select ok(has_function_privilege('authenticated', 'public.begin_handoff()', 'execute'), 'authenticated 는 begin_handoff 를 실행한다');
select ok(has_function_privilege('authenticated', 'public.adopt_anonymous(text)', 'execute'), 'authenticated 는 adopt_anonymous 를 실행한다');
select ok(has_function_privilege('authenticated', 'public.set_offer(uuid, jsonb, jsonb)', 'execute'), 'authenticated 는 3인자 set_offer 를 실행한다');
select ok(has_function_privilege('authenticated', 'public.set_offer(uuid, jsonb)', 'execute'), '2인자 set_offer 권한은 남긴다(옛 앱이 VERSION_MISMATCH 를 받게)');

select * from finish();
rollback;
