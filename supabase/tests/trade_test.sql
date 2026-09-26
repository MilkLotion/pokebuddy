-- 친구 교환 공유 채널 검사 — npx supabase test db
-- 설계의 상태 전이 표와 동시에 일어나는 경우 표를 순서대로 재현한다 (docs/work/trade/record.md "서버 설계")
-- 한 트랜잭션 안이라 now() 가 고정이다. 만료는 postgres 역할로 expires_at 을 과거로 옮겨 재현한다
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 사용자: A·C·D 는 익명, B 는 아이디 계정(이름 지우)
insert into auth.users (id, email, raw_user_meta_data, is_anonymous, aud, role, created_at) values
  ('00000000-0000-0000-0000-00000000000a', null, '{}', true, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-00000000000b', 'jiwoo_01@id.pokebuddy.invalid', '{"display_name":"지우"}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-00000000000c', null, '{}', true, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-00000000000d', null, '{}', true, 'authenticated', 'authenticated', now());

create temp table kv (k text primary key, v text);
grant all on kv to authenticated;

create function pg_temp.act(who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', '00000000-0000-0000-0000-00000000000' || who,
    'role', 'authenticated',
    'is_anonymous', who <> 'b')::text, true);
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
select throws_ok($$ select * from public.create_channel(1, 'dv1') $$, 'P0001', 'TRADE_AUTH_REQUIRED', 'sub 가 없으면 거절');

-- ── 만들기·참가 (open → joined) ──
select pg_temp.act('a');
select throws_ok($$ select * from public.create_channel(2, 'dv1') $$, 'P0001', 'TRADE_VERSION_MISMATCH', '지원하지 않는 규약');
with c as (select * from public.create_channel(1, 'dv1'))
insert into kv values ('ch1', (select channel_id::text from c)), ('tok1', (select token from c));
select ok(length(pg_temp.v('tok1')) >= 20, '토큰은 추측하기 어려운 길이다');
select throws_ok($$ select public.join_channel(pg_temp.v('tok1'), 1, 'dv1') $$, 'P0001', 'TRADE_OWN_LINK', '자기 링크로는 참가하지 못한다');

select pg_temp.act('c');
select throws_ok($$ select public.join_channel(pg_temp.v('tok1'), 1, 'dv2') $$, 'P0001', 'TRADE_VERSION_MISMATCH', '데이터 버전이 다르면 거절');
select throws_ok($$ select public.join_channel('없는토큰', 1, 'dv1') $$, 'P0001', 'TRADE_LINK_INVALID', '없는 링크');
select throws_ok($$ select * from public.get_channel(pg_temp.v('ch1')::uuid) $$, 'P0001', 'TRADE_NOT_FOUND', '참가자가 아니면 채널이 없는 것으로 본다');

select pg_temp.act('b');
select is(public.join_channel(pg_temp.v('tok1'), 1, 'dv1')::text, pg_temp.v('ch1'), 'B 가 참가한다');
select is((public.get_channel(pg_temp.v('ch1')::uuid)) ->> 'status', 'joined', '참가하면 joined');

select pg_temp.act('c');
select throws_ok($$ select public.join_channel(pg_temp.v('tok1'), 1, 'dv1') $$, 'P0001', 'TRADE_LINK_USED', '세 번째 사람은 사용됨');

-- ── 제안과 확정 ──
select pg_temp.act('a');
select throws_ok($$ select public.set_offer(pg_temp.v('ch1')::uuid, '{"level":1}') $$, 'P0001', 'TRADE_OFFER_INVALID', '종이 없는 제안은 거절');
select is(public.set_offer(pg_temp.v('ch1')::uuid, '{"species":"pikachu","level":12}'), 1, 'A 제안 → 판 1');
select throws_ok($$ select public.set_ready(pg_temp.v('ch1')::uuid, 1) $$, 'P0001', 'TRADE_OFFER_MISSING', '친구 제안이 없으면 확정하지 못한다');

select pg_temp.act('b');
select is(public.set_offer(pg_temp.v('ch1')::uuid, '{"species":"eevee","level":20}'), 2, 'B 제안 → 판 2');

-- 동시에 일어나는 경우 2: A 가 옛 판으로 확정 → 판이 바뀌었다고 거절
select pg_temp.act('a');
select throws_ok($$ select public.set_ready(pg_temp.v('ch1')::uuid, 1) $$, 'P0001', 'TRADE_OFFER_CHANGED', '판이 바뀐 뒤의 확정은 거절');
select is(public.set_ready(pg_temp.v('ch1')::uuid, 2)::text, 'joined', 'A 가 판 2 에 확정');

-- 동시에 일어나는 경우 2(반대 순서): A 확정 뒤 B 가 제안을 바꾸면 A 확정이 풀린다
select pg_temp.act('b');
select is(public.set_offer(pg_temp.v('ch1')::uuid, '{"species":"eevee","level":21}'), 3, 'B 가 바꿈 → 판 3');
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
select is((public.get_channel(pg_temp.v('ch1')::uuid)) ->> 'friend_name', null, '익명 상대는 이름이 없다(앱은 친구로 보인다)');
-- 동시에 일어나는 경우 4: 완료 뒤 나가기는 ALREADY_DONE → 앱은 반영한다
select throws_ok($$ select public.cancel_channel(pg_temp.v('ch1')::uuid) $$, 'P0001', 'TRADE_ALREADY_DONE', '완료 뒤 나가기');
select throws_ok($$ select public.set_offer(pg_temp.v('ch1')::uuid, '{"species":"eevee","level":1}') $$, 'P0001', 'TRADE_CLOSED', '완료 뒤 제안 변경은 거절');

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
with c as (select * from public.create_channel(1, 'dv1'))
insert into kv values ('ch2', (select channel_id::text from c)), ('tok2', (select token from c));
reset role;
update public.trade_channels set expires_at = now() - interval '1 minute' where id = pg_temp.v('ch2')::uuid;
set local role authenticated;
select pg_temp.act('c');
select throws_ok($$ select public.join_channel(pg_temp.v('tok2'), 1, 'dv1') $$, 'P0001', 'TRADE_LINK_EXPIRED', '참가 전 10분이 지나면 만료');
select pg_temp.act('a');
select is((public.get_channel(pg_temp.v('ch2')::uuid)) ->> 'status', 'expired', '확인하면 expired 로 바뀐다');
select is((public.get_channel(pg_temp.v('ch2')::uuid)) ->> 'closed_reason', 'expired', '닫힌 이유 expired');

with c as (select * from public.create_channel(1, 'dv1'))
insert into kv values ('ch3', (select channel_id::text from c)), ('tok3', (select token from c));
select pg_temp.act('c');
select is(public.join_channel(pg_temp.v('tok3'), 1, 'dv1')::text, pg_temp.v('ch3'), 'C 참가');
reset role;
update public.trade_channels set expires_at = now() - interval '1 minute' where id = pg_temp.v('ch3')::uuid;
set local role authenticated;
select throws_ok($$ select public.set_offer(pg_temp.v('ch3')::uuid, '{"species":"eevee","level":1}') $$, 'P0001', 'TRADE_CLOSED', '참가 후 30분이 지나면 닫힌다');
-- 동시에 일어나는 경우 3: 만료가 먼저면 확정은 거절
select throws_ok($$ select public.set_ready(pg_temp.v('ch3')::uuid, 0) $$, 'P0001', 'TRADE_CLOSED', '만료 뒤 확정은 거절');
select is((public.get_channel(pg_temp.v('ch3')::uuid)) ->> 'status', 'expired', 'joined 도 만료된다');

-- ── 나가기와 이미 교환 중 ──
select pg_temp.act('a');
with c as (select * from public.create_channel(1, 'dv1'))
insert into kv values ('ch4', (select channel_id::text from c)), ('tok4', (select token from c));
select pg_temp.act('c');
select is(public.join_channel(pg_temp.v('tok4'), 1, 'dv1')::text, pg_temp.v('ch4'), 'C 참가');
select pg_temp.act('a');
select throws_ok($$ select * from public.create_channel(1, 'dv1') $$, 'P0001', 'TRADE_ALREADY_ACTIVE', '교환 중이면 새 채널을 만들지 못한다');
select public.set_offer(pg_temp.v('ch4')::uuid, '{"species":"pikachu","level":1}');
select pg_temp.act('c');
select public.set_offer(pg_temp.v('ch4')::uuid, '{"species":"eevee","level":1}');
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
with c as (select * from public.create_channel(1, 'dv1')) insert into kv values ('ch5', (select channel_id::text from c));
with c as (select * from public.create_channel(1, 'dv1')) insert into kv values ('ch6', (select channel_id::text from c));
select is((public.get_channel(pg_temp.v('ch5')::uuid)) ->> 'status', 'cancelled', '새 채널을 만들면 앞 open 채널은 닫힌다');
select is((public.get_channel(pg_temp.v('ch5')::uuid)) ->> 'closed_reason', 'host_left', '닫힌 이유 host_left');

-- 다른 링크로 참가하면 내 open 채널은 닫힌다
select pg_temp.act('d');
with c as (select * from public.create_channel(1, 'dv1'))
insert into kv values ('ch7', (select channel_id::text from c)), ('tok7', (select token from c));
select pg_temp.act('c');
with c as (select * from public.create_channel(1, 'dv1')) insert into kv values ('ch8', (select channel_id::text from c));
select is(public.join_channel(pg_temp.v('tok7'), 1, 'dv1')::text, pg_temp.v('ch7'), 'C 가 D 의 링크로 참가');
select is((public.get_channel(pg_temp.v('ch8')::uuid)) ->> 'status', 'cancelled', 'C 의 open 채널은 닫혔다');

-- ── 생성 제한 ──
reset role;
insert into public.trade_channels (token_hash, host, protocol, data_version, expires_at, status)
  select extensions.gen_random_bytes(32), '00000000-0000-0000-0000-00000000000b', 1, 'dv1', now(), 'cancelled'
  from generate_series(1, 20);
set local role authenticated;
select pg_temp.act('b');
select throws_ok($$ select * from public.create_channel(1, 'dv1') $$, 'P0001', 'TRADE_RATE_LIMITED', '1시간에 20개를 넘으면 거절');

-- ── 정리 작업 ──
reset role;
select ok(trade_private.expire_due() >= 0, '만료 작업이 돈다');
select ok(trade_private.cleanup() >= 0, '삭제 작업이 돈다');
select ok((select count(*) from cron.job where jobname in ('trade-expire', 'trade-cleanup')) = 2, '정리 작업 두 개가 등록돼 있다');

select * from finish();
rollback;
