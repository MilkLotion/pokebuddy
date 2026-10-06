-- 친구 교환 공유 채널 검사 — npx supabase test db
-- 2026-10-02 P2: 규약 2, 3인자 set_offer(개체 지문), 익명 거부로 바꿨다 (worklog-mac/records/cloud-authority/design-p2.md 1절)
-- 2026-09-30 D31: 교환 중 예약(trade_private.pet_offers)과 TRADE_PET_BUSY 를 더했다 (같은 문서 17절)
-- 설계의 상태 전이 표와 동시에 일어나는 경우 표를 순서대로 재현한다 (docs/work/trade/trade.md "서버 설계")
-- 한 트랜잭션 안이라 now() 가 고정이다. 만료는 postgres 역할로 expires_at 을 과거로 옮겨 재현한다
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 로컬 DB 에 남은 원장·예약 행이 시험 개체 지문과 겹치지 않게 비운다 (트랜잭션 끝에 되돌린다)
delete from cloud_private.pet_ledger;
delete from trade_private.pet_offers;

-- 사용자: B 는 아이디 계정(이름 지우). A·C·D 는 이름 없는 로그인 계정(GitHub 가입 모양), E 는 익명
-- P2(2026-10-02): 교환은 로그인 계정만 한다. 예전에 익명이던 A·C·D 를 로그인 계정으로 바꿨다
insert into auth.users (id, email, raw_user_meta_data, is_anonymous, aud, role, created_at) values
  ('00000000-0000-0000-0000-00000000000a', 'trade_a@example.com', '{}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-00000000000b', 'jiwoo_01@id.pokebuddy.invalid', '{"display_name":"지우"}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-00000000000c', 'trade_c@example.com', '{}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-00000000000d', 'trade_d@example.com', '{}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-00000000000e', null, '{}', true, 'authenticated', 'authenticated', now());

-- 제안하려면 그 개체가 서버 저장에 있어야 한다(set_offer 3인자). 개체 지문은 {id, since}. 제안 값은 이 서버 저장 값으로 만든다(P5)
insert into public.cloud_saves (user_id, save, save_v, rev, trust) values
  ('00000000-0000-0000-0000-00000000000a', '{"v":3,"pets":[
     {"id":"p1","since":1000,"species":"pikachu","shiny":false,"nature":"hardy","level":99},
     {"id":"p2","since":2000,"species":"pikachu","shiny":false,"nature":"hardy","level":99},
     {"id":"p3","since":3000,"species":"pikachu","shiny":true,"nature":"bold","level":99}]}', 3, 1, 'legacy'),
  ('00000000-0000-0000-0000-00000000000b', '{"v":3,"pets":[
     {"id":"p1","since":1001,"species":"eevee","shiny":false,"nature":"calm","level":99}]}', 3, 1, 'legacy'),
  ('00000000-0000-0000-0000-00000000000c', '{"v":3,"pets":[
     {"id":"p1","since":1002,"species":"eevee","shiny":false,"nature":"calm","level":99}]}', 3, 1, 'legacy');

create temp table kv (k text primary key, v text);
grant all on kv to authenticated;

create function pg_temp.act(who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', '00000000-0000-0000-0000-00000000000' || who,
    'role', 'authenticated',
    'is_anonymous', who = 'e')::text, true);
$$;
grant execute on function pg_temp.act(text) to authenticated;
create function pg_temp.v(key text) returns text language sql as $$ select v from kv where k = key $$;
grant execute on function pg_temp.v(text) to authenticated;

-- ── 권한 ──
set local role authenticated;
select pg_temp.act('a');
select throws_ok($$ select * from public.trade_channels $$, '42501', null, '앱 역할은 테이블을 직접 읽지 못한다');
select throws_ok($$ select trade_private.new_token() $$, '42501', null, '내부 도우미는 부르지 못한다');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select * from public.create_channel(2, 'dv1') $$, 'P0001', 'TRADE_AUTH_REQUIRED', 'sub 가 없으면 거절');

-- ── 만들기·참가 (open → joined) ──
select pg_temp.act('a');
select throws_ok($$ select * from public.create_channel(3, 'dv1') $$, 'P0001', 'TRADE_VERSION_MISMATCH', '지원하지 않는 규약');
select throws_ok($$ select * from public.create_channel(1, 'dv1') $$, 'P0001', 'TRADE_VERSION_MISMATCH', '규약 1(지문 없는 옛 앱)은 거절');
with c as (select * from public.create_channel(2, 'dv1'))
insert into kv values ('ch1', (select channel_id::text from c)), ('tok1', (select token from c));
select ok(length(pg_temp.v('tok1')) >= 20, '토큰은 추측하기 어려운 길이다');
select throws_ok($$ select public.join_channel(pg_temp.v('tok1'), 2, 'dv1') $$, 'P0001', 'TRADE_OWN_LINK', '자기 링크로는 참가하지 못한다');

select pg_temp.act('c');
select throws_ok($$ select public.join_channel(pg_temp.v('tok1'), 2, 'dv2') $$, 'P0001', 'TRADE_VERSION_MISMATCH', '데이터 버전이 다르면 거절');
select throws_ok($$ select public.join_channel('없는토큰', 2, 'dv1') $$, 'P0001', 'TRADE_LINK_INVALID', '없는 링크');
select throws_ok($$ select * from public.get_channel(pg_temp.v('ch1')::uuid) $$, 'P0001', 'TRADE_NOT_FOUND', '참가자가 아니면 채널이 없는 것으로 본다');

select pg_temp.act('b');
select is(public.join_channel(pg_temp.v('tok1'), 2, 'dv1')::text, pg_temp.v('ch1'), 'B 가 참가한다');
select is((public.get_channel(pg_temp.v('ch1')::uuid)) ->> 'status', 'joined', '참가하면 joined');

select pg_temp.act('c');
select throws_ok($$ select public.join_channel(pg_temp.v('tok1'), 2, 'dv1') $$, 'P0001', 'TRADE_LINK_USED', '세 번째 사람은 사용됨');

-- ── 제안과 확정 ──
select pg_temp.act('a');
select throws_ok($$ select public.set_offer(pg_temp.v('ch1')::uuid, '{"level":1}', '{"id":"p1","since":1000}') $$, 'P0001', 'TRADE_OFFER_INVALID', '종이 없는 제안은 거절');
select throws_ok($$ select public.set_offer(pg_temp.v('ch1')::uuid, '{"species":"pikachu","level":12,"shiny":false,"nature":"hardy"}') $$, 'P0001', 'TRADE_VERSION_MISMATCH', '지문 없는 2인자 제안(옛 앱)은 거절');
select throws_ok($$ select public.set_offer(pg_temp.v('ch1')::uuid, '{"species":"pikachu","level":12,"shiny":false,"nature":"hardy"}', '{"id":"p1"}') $$, 'P0001', 'TRADE_OFFER_INVALID', 'since 없는 지문은 거절');
select throws_ok($$ select public.set_offer(pg_temp.v('ch1')::uuid, '{"species":"pikachu","level":12,"shiny":false,"nature":"hardy"}', '{"id":"p9","since":1000}') $$, 'P0001', 'TRADE_PET_NOT_SYNCED', '서버 저장에 없는 개체는 거절');
select throws_ok($$ select public.set_offer(pg_temp.v('ch1')::uuid, '{"species":"eevee","level":12,"shiny":false,"nature":"hardy"}', '{"id":"p1","since":1000}') $$, 'P0001', 'TRADE_PET_NOT_SYNCED', '종이 서버 저장과 다르면 거절');
select throws_ok($$ select public.set_offer(pg_temp.v('ch1')::uuid, '{"species":"pikachu","level":12,"shiny":true,"nature":"hardy"}', '{"id":"p1","since":1000}') $$, 'P0001', 'TRADE_PET_NOT_SYNCED', '이로치가 서버 저장과 다르면 거절');
select throws_ok($$ select public.set_offer(pg_temp.v('ch1')::uuid, '{"species":"pikachu","level":12,"shiny":false,"nature":"bold"}', '{"id":"p1","since":1000}') $$, 'P0001', 'TRADE_PET_NOT_SYNCED', '성격이 서버 저장과 다르면 거절');
-- P5 H1: 검증받지 않은 저장(unverified)은 제안의 근거가 되지 못한다
reset role;
update public.cloud_saves set trust = 'unverified' where user_id = '00000000-0000-0000-0000-00000000000a';
set local role authenticated;
select pg_temp.act('a');
select throws_ok($$ select public.set_offer(pg_temp.v('ch1')::uuid, '{"species":"pikachu","level":12,"shiny":false,"nature":"hardy"}', '{"id":"p1","since":1000}') $$, 'P0001', 'TRADE_SAVE_UNVERIFIED', 'P5 unverified 저장은 제안하지 못한다');
reset role;
update public.cloud_saves set trust = 'legacy' where user_id = '00000000-0000-0000-0000-00000000000a';
set local role authenticated;
select pg_temp.act('a');
select is(public.set_offer(pg_temp.v('ch1')::uuid, '{"species":"pikachu","level":12,"shiny":false,"nature":"hardy"}', '{"id":"p1","since":1000}'), 1, 'A 제안 → 판 1 (앱 레벨이 서버 이하면 받는다)');
select throws_ok($$ select public.set_ready(pg_temp.v('ch1')::uuid, 1) $$, 'P0001', 'TRADE_OFFER_MISSING', '친구 제안이 없으면 확정하지 못한다');

select pg_temp.act('b');
select is(public.set_offer(pg_temp.v('ch1')::uuid, '{"species":"eevee","level":20,"shiny":false,"nature":"calm"}', '{"id":"p1","since":1001}'), 2, 'B 제안 → 판 2');

-- 동시에 일어나는 경우 2: A 가 옛 판으로 확정 → 판이 바뀌었다고 거절
select pg_temp.act('a');
select throws_ok($$ select public.set_ready(pg_temp.v('ch1')::uuid, 1) $$, 'P0001', 'TRADE_OFFER_CHANGED', '판이 바뀐 뒤의 확정은 거절');
select is(public.set_ready(pg_temp.v('ch1')::uuid, 2)::text, 'joined', 'A 가 판 2 에 확정');

-- 동시에 일어나는 경우 2(반대 순서): A 확정 뒤 B 가 제안을 바꾸면 A 확정이 풀린다
select pg_temp.act('b');
select is(public.set_offer(pg_temp.v('ch1')::uuid, '{"species":"eevee","level":21,"shiny":false,"nature":"calm"}', '{"id":"p1","since":1001}'), 3, 'B 가 바꿈 → 판 3');
select is(public.set_ready(pg_temp.v('ch1')::uuid, 3)::text, 'joined', 'B 만 판 3 에 확정 — 아직 완료가 아니다');
select pg_temp.act('a');
select is((public.get_channel(pg_temp.v('ch1')::uuid)) ->> 'my_ready', 'false', 'A 의 판 2 확정은 풀렸다');
select is((public.get_channel(pg_temp.v('ch1')::uuid)) ->> 'friend_ready', 'true', 'B 는 확정 상태');
select is((public.get_channel(pg_temp.v('ch1')::uuid)) ->> 'friend_name', '지우', '로그인한 상대의 이름');
select is((public.get_channel(pg_temp.v('ch1')::uuid)) -> 'friend_offer' ->> 'species', 'eevee', '친구 제안을 본다');
select ok(not (public.get_channel(pg_temp.v('ch1')::uuid) ? 'token_hash'), '토큰 해시는 돌려주지 않는다');

-- 동시에 일어나는 경우 1: 뒤에 확정한 쪽이 완료를 쓴다
select is(public.set_ready(pg_temp.v('ch1')::uuid, 3)::text, 'done', '같은 판에 둘 다 확정 → done');
select is(public.set_ready(pg_temp.v('ch1')::uuid, 3)::text, 'done', '같은 확정을 다시 보내도 done');
select pg_temp.act('b');
select is((public.get_channel(pg_temp.v('ch1')::uuid)) ->> 'friend_name', null, '이름이 없는 상대는 null(앱은 친구로 보인다)');
reset role;
select results_eq($$ select pet_id, pet_since, from_user, species from cloud_private.pet_ledger where channel_id = pg_temp.v('ch1')::uuid order by pet_since $$,
  $$ values ('p1'::text, 1000::bigint, '00000000-0000-0000-0000-00000000000a'::uuid, 'pikachu'::text),
            ('p1'::text, 1001::bigint, '00000000-0000-0000-0000-00000000000b'::uuid, 'eevee'::text) $$, '완료하면 양쪽 지문을 원장에 남긴다');
select is((select host_ref from public.trade_channels where id = pg_temp.v('ch1')::uuid), '{"id":"p1","since":1000}'::jsonb, '채널에 제안 지문을 남긴다');
set local role authenticated;
select pg_temp.act('b');
-- 동시에 일어나는 경우 4: 완료 뒤 나가기는 ALREADY_DONE → 앱은 반영한다
select throws_ok($$ select public.cancel_channel(pg_temp.v('ch1')::uuid) $$, 'P0001', 'TRADE_ALREADY_DONE', '완료 뒤 나가기');
select throws_ok($$ select public.set_offer(pg_temp.v('ch1')::uuid, '{"species":"eevee","level":1,"shiny":false,"nature":"calm"}', '{"id":"p1","since":1001}') $$, 'P0001', 'TRADE_CLOSED', '완료 뒤 제안 변경은 거절');

-- 반영 알림: 양쪽이 반영하면 제안 값을 지운다
select pg_temp.act('a');
select lives_ok($$ select public.ack_applied(pg_temp.v('ch1')::uuid) $$, 'A 반영');
select lives_ok($$ select public.ack_applied(pg_temp.v('ch1')::uuid) $$, '같은 반영을 다시 보내도 된다');
select pg_temp.act('b');
select lives_ok($$ select public.ack_applied(pg_temp.v('ch1')::uuid) $$, 'B 반영');
reset role;
select is((select host_offer from public.trade_channels where id = pg_temp.v('ch1')::uuid), null, '양쪽 반영 뒤 제안 값 삭제');
select ok((select count(*) from realtime.messages where topic = 'trade:' || pg_temp.v('ch1')) > 0, '바뀔 때마다 신호를 보낸다');
select ok((select bool_and(payload ? 'status' and not payload ? 'host_offer') from realtime.messages where topic = 'trade:' || pg_temp.v('ch1')), '신호에는 제안 값이 없다');

-- ── 실시간 권한 ──
set local role authenticated;
select pg_temp.act('a');
select ok(public.is_trade_participant('trade:' || pg_temp.v('ch1')), '참가자는 신호를 받는다');
select pg_temp.act('c');
select ok(not public.is_trade_participant('trade:' || pg_temp.v('ch1')), '참가자가 아니면 받지 못한다');

-- ── 만료 (open → expired, joined → expired) ──
select pg_temp.act('a');
with c as (select * from public.create_channel(2, 'dv1'))
insert into kv values ('ch2', (select channel_id::text from c)), ('tok2', (select token from c));
reset role;
update public.trade_channels set expires_at = now() - interval '1 minute' where id = pg_temp.v('ch2')::uuid;
set local role authenticated;
select pg_temp.act('c');
select throws_ok($$ select public.join_channel(pg_temp.v('tok2'), 2, 'dv1') $$, 'P0001', 'TRADE_LINK_EXPIRED', '참가 전 10분이 지나면 만료');
select pg_temp.act('a');
select is((public.get_channel(pg_temp.v('ch2')::uuid)) ->> 'status', 'expired', '확인하면 expired 로 바뀐다');
select is((public.get_channel(pg_temp.v('ch2')::uuid)) ->> 'closed_reason', 'expired', '닫힌 이유 expired');

with c as (select * from public.create_channel(2, 'dv1'))
insert into kv values ('ch3', (select channel_id::text from c)), ('tok3', (select token from c));
select pg_temp.act('c');
select is(public.join_channel(pg_temp.v('tok3'), 2, 'dv1')::text, pg_temp.v('ch3'), 'C 참가');
reset role;
update public.trade_channels set expires_at = now() - interval '1 minute' where id = pg_temp.v('ch3')::uuid;
set local role authenticated;
select throws_ok($$ select public.set_offer(pg_temp.v('ch3')::uuid, '{"species":"eevee","level":1,"shiny":false,"nature":"calm"}', '{"id":"p1","since":1002}') $$, 'P0001', 'TRADE_CLOSED', '참가 후 30분이 지나면 닫힌다');
-- 동시에 일어나는 경우 3: 만료가 먼저면 확정은 거절
select throws_ok($$ select public.set_ready(pg_temp.v('ch3')::uuid, 0) $$, 'P0001', 'TRADE_CLOSED', '만료 뒤 확정은 거절');
select is((public.get_channel(pg_temp.v('ch3')::uuid)) ->> 'status', 'expired', 'joined 도 만료된다');

-- ── 나가기와 이미 교환 중 ──
select pg_temp.act('a');
with c as (select * from public.create_channel(2, 'dv1'))
insert into kv values ('ch4', (select channel_id::text from c)), ('tok4', (select token from c));
select pg_temp.act('c');
select is(public.join_channel(pg_temp.v('tok4'), 2, 'dv1')::text, pg_temp.v('ch4'), 'C 참가');
select pg_temp.act('a');
select throws_ok($$ select * from public.create_channel(2, 'dv1') $$, 'P0001', 'TRADE_ALREADY_ACTIVE', '교환 중이면 새 채널을 만들지 못한다');
select throws_ok($$ select public.set_offer(pg_temp.v('ch4')::uuid, '{"species":"pikachu","level":1,"shiny":false,"nature":"hardy"}', '{"id":"p1","since":1000}') $$, 'P0001', 'TRADE_PET_TRADED', '교환으로 내보낸 개체는 다시 제안하지 못한다');
select public.set_offer(pg_temp.v('ch4')::uuid, '{"species":"pikachu","level":1,"shiny":false,"nature":"hardy"}', '{"id":"p2","since":2000}');
select pg_temp.act('c');
select public.set_offer(pg_temp.v('ch4')::uuid, '{"species":"eevee","level":1,"shiny":false,"nature":"calm"}', '{"id":"p1","since":1002}');
select pg_temp.act('a');
select is(public.set_ready(pg_temp.v('ch4')::uuid, 2)::text, 'joined', 'A 확정');
select is(public.set_ready(pg_temp.v('ch4')::uuid, null)::text, 'joined', '확정을 푼다');
select is((public.get_channel(pg_temp.v('ch4')::uuid)) ->> 'my_ready', 'false', '확정이 풀렸다');
select is(public.set_ready(pg_temp.v('ch4')::uuid, 2)::text, 'joined', '다시 확정');
-- 동시에 일어나는 경우 4(반대 순서): 나가기가 먼저면 확정은 거절
select pg_temp.act('c');
select is(public.cancel_channel(pg_temp.v('ch4')::uuid)::text, 'cancelled', 'C 가 나간다');
select throws_ok($$ select public.set_ready(pg_temp.v('ch4')::uuid, 2) $$, 'P0001', 'TRADE_CLOSED', '나간 뒤 확정은 거절');
select pg_temp.act('a');
select is((public.get_channel(pg_temp.v('ch4')::uuid)) ->> 'closed_reason', 'guest_left', '친구 나감');

-- 같은 사람의 새 채널은 open 채널을 닫는다
with c as (select * from public.create_channel(2, 'dv1')) insert into kv values ('ch5', (select channel_id::text from c));
with c as (select * from public.create_channel(2, 'dv1')) insert into kv values ('ch6', (select channel_id::text from c));
select is((public.get_channel(pg_temp.v('ch5')::uuid)) ->> 'status', 'cancelled', '새 채널을 만들면 앞 open 채널은 닫힌다');
select is((public.get_channel(pg_temp.v('ch5')::uuid)) ->> 'closed_reason', 'host_left', '닫힌 이유 host_left');

-- 다른 링크로 참가하면 내 open 채널은 닫힌다
select pg_temp.act('d');
with c as (select * from public.create_channel(2, 'dv1'))
insert into kv values ('ch7', (select channel_id::text from c)), ('tok7', (select token from c));
select pg_temp.act('c');
with c as (select * from public.create_channel(2, 'dv1')) insert into kv values ('ch8', (select channel_id::text from c));
select is(public.join_channel(pg_temp.v('tok7'), 2, 'dv1')::text, pg_temp.v('ch7'), 'C 가 D 의 링크로 참가');
select is((public.get_channel(pg_temp.v('ch8')::uuid)) ->> 'status', 'cancelled', 'C 의 open 채널은 닫혔다');

-- ── 익명 계정은 교환하지 못한다(P2) ──
select pg_temp.act('b');
with c as (select * from public.create_channel(2, 'dv1'))
insert into kv values ('ch9', (select channel_id::text from c)), ('tok9', (select token from c));
select pg_temp.act('e');
select throws_ok($$ select * from public.create_channel(2, 'dv1') $$, 'P0001', 'TRADE_LOGIN_REQUIRED', '익명은 채널을 만들지 못한다');
select throws_ok($$ select public.join_channel(pg_temp.v('tok9'), 2, 'dv1') $$, 'P0001', 'TRADE_LOGIN_REQUIRED', '익명은 참가하지 못한다');
select throws_ok($$ select public.set_offer(pg_temp.v('ch9')::uuid, '{"species":"eevee","level":1}', '{"id":"p1","since":1}') $$, 'P0001', 'TRADE_LOGIN_REQUIRED', '익명은 제안하지 못한다');
select throws_ok($$ select public.set_ready(pg_temp.v('ch9')::uuid, 1) $$, 'P0001', 'TRADE_LOGIN_REQUIRED', '익명은 확정하지 못한다');
select throws_ok($$ select * from public.get_channel(pg_temp.v('ch9')::uuid) $$, 'P0001', 'TRADE_NOT_FOUND', '익명도 보기는 require_uid 그대로(참가자가 아니면 없는 채널)');

-- ── 교환 중 예약(D31, design-p2.md 17절) ──
-- 1·2 는 같은 개체 사본(p7, 7000)을 가진 로그인 계정, 3·4 는 상대. 1 은 다른 개체 p8 도 가진다. 3 은 p8 사본을 가진다
-- 제안 단계에서 지문 하나에 활성 채널 하나만 둔다. 계정과 무관하다
reset role;
insert into auth.users (id, email, raw_user_meta_data, is_anonymous, aud, role, created_at) values
  ('00000000-0000-0000-0000-000000000001', 'trade_1@example.com', '{}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-000000000002', 'trade_2@example.com', '{}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-000000000003', 'trade_3@example.com', '{}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-000000000004', 'trade_4@example.com', '{}', false, 'authenticated', 'authenticated', now());
insert into public.cloud_saves (user_id, save, save_v, rev, trust) values
  ('00000000-0000-0000-0000-000000000001', '{"v":3,"pets":[{"id":"p7","since":7000,"species":"mew","shiny":true,"nature":"timid","level":99},
     {"id":"p8","since":7001,"species":"ditto","shiny":false,"nature":"calm","level":99}]}', 3, 1, 'legacy'),
  ('00000000-0000-0000-0000-000000000002', '{"v":3,"pets":[{"id":"p7","since":7000,"species":"mew","shiny":true,"nature":"timid","level":99}]}', 3, 1, 'legacy'),
  ('00000000-0000-0000-0000-000000000003', '{"v":3,"pets":[{"id":"p1","since":7003,"species":"eevee","shiny":false,"nature":"calm","level":99},
     {"id":"p8","since":7001,"species":"ditto","shiny":false,"nature":"calm","level":99}]}', 3, 1, 'legacy'),
  ('00000000-0000-0000-0000-000000000004', '{"v":3,"pets":[{"id":"p1","since":7004,"species":"eevee","shiny":false,"nature":"calm","level":99}]}', 3, 1, 'legacy');
create function pg_temp.held(since bigint, id text) returns text language sql as $$
  select coalesce((select channel_id::text from trade_private.pet_offers o where o.pet_since = since and o.pet_id = id), 'none')
$$;
set local role authenticated;
select pg_temp.act('1');
with c as (select * from public.create_channel(2, 'dv1'))
insert into kv values ('chx', (select channel_id::text from c)), ('tokx', (select token from c));
select pg_temp.act('2');
with c as (select * from public.create_channel(2, 'dv1'))
insert into kv values ('chy', (select channel_id::text from c)), ('toky', (select token from c));
select pg_temp.act('3');
select is(public.join_channel(pg_temp.v('tokx'), 2, 'dv1')::text, pg_temp.v('chx'), '3 이 1 의 채널에 참가');
select public.set_offer(pg_temp.v('chx')::uuid, '{"species":"eevee","level":5,"shiny":false,"nature":"calm"}', '{"id":"p1","since":7003}');
select pg_temp.act('4');
select is(public.join_channel(pg_temp.v('toky'), 2, 'dv1')::text, pg_temp.v('chy'), '4 가 2 의 채널에 참가');
select public.set_offer(pg_temp.v('chy')::uuid, '{"species":"eevee","level":5,"shiny":false,"nature":"calm"}', '{"id":"p1","since":7004}');
select pg_temp.act('1');
select is(public.set_offer(pg_temp.v('chx')::uuid, '{"species":"mew","level":30,"shiny":true,"nature":"timid"}', '{"id":"p7","since":7000}'), 2, '1 이 사본 p7 을 제안');
select pg_temp.act('2');
select throws_ok($$ select public.set_offer(pg_temp.v('chy')::uuid, '{"species":"mew","level":30,"shiny":true,"nature":"timid"}', '{"id":"p7","since":7000}') $$,
  'P0001', 'TRADE_PET_BUSY', '다른 계정이 다른 활성 채널에 올린 지문은 거절');
select is((public.get_channel(pg_temp.v('chy')::uuid)) ->> 'my_offer', null, '거절된 제안은 채널에 남지 않는다');
reset role;
select is(pg_temp.held(7000, 'p7'), pg_temp.v('chx'), '예약은 먼저 올린 채널이 가진다');
select is((select count(*)::int from trade_private.pet_offers where channel_id = pg_temp.v('chy')::uuid), 1, '2 의 채널에는 상대 예약만 있다');

-- 같은 채널에서 다른 개체로 바꾸면 이전 예약을 푼다
set local role authenticated;
select pg_temp.act('1');
select is(public.set_offer(pg_temp.v('chx')::uuid, '{"species":"ditto","level":10,"shiny":false,"nature":"calm"}', '{"id":"p8","since":7001}'), 3, '1 이 p8 로 바꾼다');
reset role;
select is(pg_temp.held(7000, 'p7'), 'none', '바꾸면 p7 예약이 풀린다');
select is(pg_temp.held(7001, 'p8'), pg_temp.v('chx'), 'p8 을 예약한다');
set local role authenticated;
select pg_temp.act('1');
select is(public.set_offer(pg_temp.v('chx')::uuid, '{"species":"ditto","level":11,"shiny":false,"nature":"calm"}', '{"id":"p8","since":7001}'), 4, '같은 개체를 다시 올려도 된다(레벨만 바뀜)');
-- 같은 채널이라도 상대가 가진 지문은 거절
select pg_temp.act('3');
select throws_ok($$ select public.set_offer(pg_temp.v('chx')::uuid, '{"species":"ditto","level":10,"shiny":false,"nature":"calm"}', '{"id":"p8","since":7001}') $$,
  'P0001', 'TRADE_PET_BUSY', '같은 채널의 상대가 올린 지문도 거절');
reset role;
select is(pg_temp.held(7003, 'p1'), pg_temp.v('chx'), '거절되면 3 의 이전 예약이 그대로 남는다');
set local role authenticated;
select pg_temp.act('2');
select is(public.set_offer(pg_temp.v('chy')::uuid, '{"species":"mew","level":30,"shiny":true,"nature":"timid"}', '{"id":"p7","since":7000}'), 2, '풀린 p7 은 2 가 올린다');
select pg_temp.act('1');
select throws_ok($$ select public.set_offer(pg_temp.v('chx')::uuid, '{"species":"mew","level":30,"shiny":true,"nature":"timid"}', '{"id":"p7","since":7000}') $$,
  'P0001', 'TRADE_PET_BUSY', '이제는 1 이 p7 을 올리지 못한다');
select is((public.get_channel(pg_temp.v('chx')::uuid)) -> 'my_offer' ->> 'species', 'ditto', 'BUSY 로 거절되면 이전 제안이 남는다');
reset role;
select is(pg_temp.held(7001, 'p8'), pg_temp.v('chx'), 'BUSY 로 거절되면 이전 예약이 남는다');

-- 취소하면 푼다
set local role authenticated;
select pg_temp.act('2');
select is(public.cancel_channel(pg_temp.v('chy')::uuid)::text, 'cancelled', '2 가 나간다');
reset role;
select is((select count(*)::int from trade_private.pet_offers where channel_id = pg_temp.v('chy')::uuid), 0, '취소한 채널의 예약은 모두 풀린다(상대 예약 포함)');
set local role authenticated;
select pg_temp.act('1');
select is(public.set_offer(pg_temp.v('chx')::uuid, '{"species":"mew","level":30,"shiny":true,"nature":"timid"}', '{"id":"p7","since":7000}'), 5, '취소 뒤에는 1 이 다시 올린다');

-- 만료 시각이 지난 채널의 예약은 덮어쓴다(아직 expired 로 바뀌지 않았어도)
select pg_temp.act('2');
with c as (select * from public.create_channel(2, 'dv1'))
insert into kv values ('chz', (select channel_id::text from c)), ('tokz', (select token from c));
select pg_temp.act('4');
select is(public.join_channel(pg_temp.v('tokz'), 2, 'dv1')::text, pg_temp.v('chz'), '4 가 2 의 새 채널에 참가');
reset role;
update public.trade_channels set expires_at = now() - interval '1 minute' where id = pg_temp.v('chx')::uuid;
select is((select status::text from public.trade_channels where id = pg_temp.v('chx')::uuid), 'joined', '앞 채널은 시각만 지났고 아직 joined');
set local role authenticated;
select pg_temp.act('2');
select is(public.set_offer(pg_temp.v('chz')::uuid, '{"species":"mew","level":30,"shiny":true,"nature":"timid"}', '{"id":"p7","since":7000}'), 1, '만료 시각이 지난 채널의 예약은 덮어쓴다');
reset role;
select is(pg_temp.held(7000, 'p7'), pg_temp.v('chz'), '예약이 새 채널로 옮겨졌다');
-- 만료 작업이 앞 채널을 닫으면 그 채널의 남은 예약만 푼다
select ok(trade_private.expire_due() >= 1, '만료 작업이 앞 채널을 닫는다');
select is((select count(*)::int from trade_private.pet_offers where channel_id = pg_temp.v('chx')::uuid), 0, '만료한 채널의 예약은 풀린다');
select is(pg_temp.held(7000, 'p7'), pg_temp.v('chz'), '옮겨 간 예약은 남는다');
-- 만료 확인(get_channel → expire_if_due)도 푼다
update public.trade_channels set expires_at = now() - interval '1 minute' where id = pg_temp.v('chz')::uuid;
set local role authenticated;
select pg_temp.act('4');
select is((public.get_channel(pg_temp.v('chz')::uuid)) ->> 'status', 'expired', '확인하면 expired');
reset role;
select is(pg_temp.held(7000, 'p7'), 'none', '만료를 확인하면 예약이 풀린다');

-- ── 예약을 우회해 두 채널이 같은 지문으로 확정(검수 C1 마지막 안전장치) ──
-- 예약 행을 postgres 로 지워 두 채널 모두 같은 지문을 올린 상태를 만든다
-- 먼저 끝난 채널만 done 이고, 뒤 채널의 확정은 TRADE_PET_TRADED 로 완료 전체가 되돌아간다
set local role authenticated;
select pg_temp.act('1');
with c as (select * from public.create_channel(2, 'dv1'))
insert into kv values ('chx2', (select channel_id::text from c)), ('tokx2', (select token from c));
select pg_temp.act('2');
with c as (select * from public.create_channel(2, 'dv1'))
insert into kv values ('chy2', (select channel_id::text from c)), ('toky2', (select token from c));
select pg_temp.act('3');
select is(public.join_channel(pg_temp.v('tokx2'), 2, 'dv1')::text, pg_temp.v('chx2'), '3 이 1 의 새 채널에 참가');
select public.set_offer(pg_temp.v('chx2')::uuid, '{"species":"eevee","level":5,"shiny":false,"nature":"calm"}', '{"id":"p1","since":7003}');
select pg_temp.act('4');
select is(public.join_channel(pg_temp.v('toky2'), 2, 'dv1')::text, pg_temp.v('chy2'), '4 가 2 의 새 채널에 참가');
select public.set_offer(pg_temp.v('chy2')::uuid, '{"species":"eevee","level":5,"shiny":false,"nature":"calm"}', '{"id":"p1","since":7004}');
select pg_temp.act('1');
select is(public.set_offer(pg_temp.v('chx2')::uuid, '{"species":"mew","level":30,"shiny":true,"nature":"timid"}', '{"id":"p7","since":7000}'), 2, '1 이 p7 을 제안');
reset role;
delete from trade_private.pet_offers where pet_since = 7000 and pet_id = 'p7';
set local role authenticated;
select pg_temp.act('2');
select is(public.set_offer(pg_temp.v('chy2')::uuid, '{"species":"mew","level":30,"shiny":true,"nature":"timid"}', '{"id":"p7","since":7000}'), 2, '예약을 지운 뒤라 2 도 같은 지문을 제안');
select is(public.set_ready(pg_temp.v('chy2')::uuid, 2)::text, 'joined', '2 가 먼저 확정');
select pg_temp.act('3');
select is(public.set_ready(pg_temp.v('chx2')::uuid, 2)::text, 'joined', '3 확정');
select pg_temp.act('1');
select is(public.set_ready(pg_temp.v('chx2')::uuid, 2)::text, 'done', '앞 채널이 먼저 끝난다');
reset role;
select is((select count(*)::int from trade_private.pet_offers where channel_id = pg_temp.v('chx2')::uuid), 0, '완료한 채널의 예약은 풀린다(원장으로 넘어간다)');
set local role authenticated;
select pg_temp.act('4');
select throws_ok($$ select public.set_ready(pg_temp.v('chy2')::uuid, 2) $$, 'P0001', 'TRADE_PET_TRADED', '같은 지문의 두 번째 확정은 거부');
select is((public.get_channel(pg_temp.v('chy2')::uuid)) ->> 'status', 'joined', '거부된 확정은 done 을 남기지 않는다');
select is((public.get_channel(pg_temp.v('chy2')::uuid)) ->> 'my_ready', 'false', '거부된 확정은 확정 표시도 되돌린다');
reset role;
select is((select count(*)::int from cloud_private.pet_ledger where channel_id = pg_temp.v('chy2')::uuid), 0, '거부된 채널은 원장에 아무것도 남기지 않는다(상대 개체 포함)');
select results_eq($$ select from_user, channel_id::text from cloud_private.pet_ledger where pet_id = 'p7' and pet_since = 7000 $$,
  $$ values ('00000000-0000-0000-0000-000000000001'::uuid, pg_temp.v('chx2')) $$, '원장의 p7 은 앞 채널 한 줄뿐');
select is(pg_temp.held(7000, 'p7'), pg_temp.v('chy2'), '거부된 채널의 예약은 되돌아가 남는다');
set local role authenticated;
select pg_temp.act('2');
select throws_ok($$ select public.set_offer(pg_temp.v('chy2')::uuid, '{"species":"mew","level":30,"shiny":true,"nature":"timid"}', '{"id":"p7","since":7000}') $$,
  'P0001', 'TRADE_PET_TRADED', '원장에 오른 지문은 다시 제안하지 못한다');

-- 계정을 지우면 그 계정의 예약을, 채널을 지우면 그 채널의 예약을 FK 로 지운다
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-000000000004';
select is(pg_temp.held(7004, 'p1'), 'none', '계정을 지우면 예약도 지운다');
delete from public.trade_channels where id = pg_temp.v('chy2')::uuid;
select is(pg_temp.held(7000, 'p7'), 'none', '채널을 지우면 예약도 지운다');

-- ── 생성 제한 ──
reset role;
insert into public.trade_channels (token_hash, host, protocol, data_version, expires_at, status)
  select extensions.gen_random_bytes(32), '00000000-0000-0000-0000-00000000000b', 2, 'dv1', now(), 'cancelled'
  from generate_series(1, 20);
set local role authenticated;
select pg_temp.act('b');
select throws_ok($$ select * from public.create_channel(2, 'dv1') $$, 'P0001', 'TRADE_RATE_LIMITED', '1시간에 20개를 넘으면 거절');

-- ── 정리 작업 ──
reset role;
select ok(trade_private.expire_due() >= 0, '만료 작업이 돈다');
select ok(trade_private.cleanup() >= 0, '삭제 작업이 돈다');
select ok((select count(*) from cron.job where jobname in ('trade-expire', 'trade-cleanup')) = 2, '정리 작업 두 개가 등록돼 있다');

select * from finish();
rollback;
