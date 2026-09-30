-- 두 PC 규칙 검사 — npx supabase test db
-- worklog-mac/records/cloud-authority/design-p1.md 1절·10절
-- 한 트랜잭션 안이라 now() 가 고정이다. 시간 경과는 postgres 역할로 last_seen·done_at 을 옮겨 재현한다
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 사용자: e1·e2 는 아이디 계정, e3 은 익명
insert into auth.users (id, email, raw_user_meta_data, is_anonymous, aud, role, created_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'jiwoo_03@id.pokebuddy.invalid', '{"display_name":"지우"}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000e2', 'woong_03@id.pokebuddy.invalid', '{"display_name":"웅이"}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000e3', null, '{}', true, 'authenticated', 'authenticated', now());

create function pg_temp.act(who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', '00000000-0000-0000-0000-0000000000' || who,
    'role', 'authenticated',
    'is_anonymous', who = 'e3')::text, true);
$$;
grant execute on function pg_temp.act(text) to authenticated;

-- 기기: A·B·C
--   A = aaaaaaaa-…, B = bbbbbbbb-…, C = cccccccc-…

-- ── presence 판정 6종 ──
select is(cloud_private.presence_of(null::public.cloud_saves), 'none', '행이 없으면 none');
select is(cloud_private.presence_of(jsonb_populate_record(null::public.cloud_saves,
  '{"user_id":"00000000-0000-0000-0000-0000000000e1","presence":"active"}')), 'none', '활성 기기가 없으면 none');
select is(cloud_private.presence_of(jsonb_populate_record(null::public.cloud_saves,
  '{"user_id":"00000000-0000-0000-0000-0000000000e1","active_device":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","presence":"active"}')), 'unknown', 'last_seen 이 비면 unknown(옛 앱 행)');
select is(cloud_private.presence_of(jsonb_populate_record(null::public.cloud_saves,
  jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000e1', 'active_device', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'presence', 'released', 'last_seen', now()))), 'released', '정상 종료는 released');
select is(cloud_private.presence_of(jsonb_populate_record(null::public.cloud_saves,
  jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000e1', 'active_device', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'presence', 'asleep', 'last_seen', now() - interval '1 day'))), 'asleep', '잠듦은 오래돼도 asleep');
select is(cloud_private.presence_of(jsonb_populate_record(null::public.cloud_saves,
  jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000e1', 'active_device', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'presence', 'active', 'last_seen', now() - interval '149 seconds'))), 'online', '149초 전이면 online');
select is(cloud_private.presence_of(jsonb_populate_record(null::public.cloud_saves,
  jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000e1', 'active_device', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'presence', 'active', 'last_seen', now() - interval '150 seconds'))), 'disconnected', '150초 전이면 disconnected');

-- ── 버전 판정(설정 표 기준) ──
select is(cloud_private.min_app_version(), '0.13.0', '초기 최소 버전은 0.13.0');
select ok(cloud_private.version_ok('0.13.0'), '최소 버전과 같으면 통과');
select ok(cloud_private.version_ok('0.13'), '빠진 칸은 0 으로 본다');
select ok(cloud_private.version_ok('0.14.0-beta.1'), '- 뒤는 버린다');
select ok(cloud_private.version_ok('1.0.0'), '큰 버전은 통과');
select ok(not cloud_private.version_ok('0.12.9'), '낮은 버전은 거부');
select ok(not cloud_private.version_ok('abc'), '형식이 틀리면 거부');
select ok(not cloud_private.version_ok(null), '버전이 없으면 거부');
select ok(not cloud_private.version_ok('99999999999.0.0'), '정수 범위를 넘으면 거부');

-- ── 권한 ──
set local role authenticated;
select pg_temp.act('e1');
select throws_ok($$ select cloud_private.presence_of(null::public.cloud_saves) $$, '42501', null, '앱 역할은 cloud_private 함수를 실행하지 못한다');
select throws_ok($$ select cloud_private.min_app_version() $$, '42501', null, '앱 역할은 최소 버전 함수를 실행하지 못한다');
select throws_ok($$ select * from cloud_private.settings $$, '42501', null, '앱 역할은 설정 표를 읽지 못한다');
reset role;
select ok(not has_function_privilege('authenticated', 'cloud_private.trade_unsynced(uuid, public.cloud_saves)', 'execute'), 'authenticated 는 trade_unsynced 실행 권한이 없다');
select ok(not has_function_privilege('authenticated', 'cloud_private.version_ok(text)', 'execute'), 'authenticated 는 version_ok 실행 권한이 없다');
select ok(not has_function_privilege('anon', 'public.claim_device(uuid, text, text, text, boolean)', 'execute'), 'anon 은 claim_device 를 실행하지 못한다');
select ok(not has_function_privilege('anon', 'public.touch_device(uuid, text, text)', 'execute'), 'anon 은 touch_device 를 실행하지 못한다');
select ok(not has_function_privilege('anon', 'public.upload_save(uuid, bigint, jsonb, int, text, uuid)', 'execute'), 'anon 은 upload_save 를 실행하지 못한다');
select ok(has_function_privilege('authenticated', 'public.touch_device(uuid, text, text)', 'execute'), 'authenticated 는 touch_device 를 실행한다');

-- ── 옛 시그니처 ──
set local role authenticated;
select pg_temp.act('e1');
select throws_ok($$ select * from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A') $$, 'P0001', 'CLOUD_UPDATE_REQUIRED', '옛 claim_device 는 업데이트 안내만 한다');
select throws_ok($$ select public.upload_save('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0, '{"v":3}', 3, '0.12.0') $$, 'P0001', 'CLOUD_UPDATE_REQUIRED', '옛 upload_save 는 업데이트 안내만 한다');

-- ── claim 기본 ──
select pg_temp.act('e3');
-- P2(2026-10-02): 익명 계정도 claim 한다. 행이 없으면 만들지 않고 빈 결과만 준다(anonymous_save_test.sql)
select results_eq($$ select outcome, rev, updated_at, has_save, other_label, other_seen from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A', '0.13.0', 'boot', false) $$,
  $$ values ('claimed'::text, 0::bigint, null::timestamptz, false, null::text, null::timestamptz) $$, '익명 계정의 첫 claim 은 행 없이 claimed');
select pg_temp.act('e1');
select throws_ok($$ select * from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A', '0.12.0', 'boot', false) $$, 'P0001', 'CLOUD_UPDATE_REQUIRED', '낮은 버전은 claim 하지 못한다');
select throws_ok($$ select * from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A', '0.13.0', 'wake', false) $$, 'P0001', 'CLOUD_BAD_ARGS', 'mode 는 boot·late 만');
select results_eq($$ select outcome, has_save, other_label from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A', '0.13.0', 'boot', false) $$,
  $$ values ('claimed'::text, false, null::text) $$, '처음 claim 은 claimed, 저장 없음, 상대 없음');

-- ── 멱등 올리기 ──
select is(public.upload_save('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0, '{"v":3,"pets":[]}', 3, '0.13.0', '0e000000-0000-0000-0000-000000000001'), 1::bigint, 'PC A 가 올린다 → rev 1');
select is(public.upload_save('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0, '{"v":3,"pets":[]}', 3, '0.13.0', '0e000000-0000-0000-0000-000000000001'), 1::bigint, '같은 op 를 다시 보내면 쓰지 않고 rev 1');
select throws_ok($$ select public.upload_save('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0, '{"v":3}', 3, '0.13.0', '0e000000-0000-0000-0000-000000000002') $$, 'P0001', 'CLOUD_REV_CONFLICT', '다른 op 는 옛 rev 로 올리지 못한다');
select throws_ok($$ select public.upload_save('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, '{"v":3}', 3, '0.13.0', null) $$, 'P0001', 'CLOUD_BAD_ARGS', 'op 는 비울 수 없다');
select throws_ok($$ select public.upload_save('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, '{"v":3}', 3, '0.12.0', '0e000000-0000-0000-0000-000000000003') $$, 'P0001', 'CLOUD_UPDATE_REQUIRED', '낮은 버전은 올리지 못한다');
reset role;
select results_eq($$ select rev, last_op, last_op_rev, presence from public.cloud_saves where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  $$ values (1::bigint, '0e000000-0000-0000-0000-000000000001'::uuid, 1::bigint, 'active'::text) $$, '멱등 키와 그 rev 를 남긴다');

-- ── touch ──
set local role authenticated;
select pg_temp.act('e1');
select throws_ok($$ select * from public.touch_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '0.13.0', 'gone') $$, 'P0001', 'CLOUD_BAD_ARGS', 'presence 는 active·asleep·released 만');
select throws_ok($$ select * from public.touch_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '0.12.0', 'active') $$, 'P0001', 'CLOUD_UPDATE_REQUIRED', '낮은 버전은 touch 하지 못한다');
select results_eq($$ select active, rev from public.touch_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '0.13.0', 'asleep') $$,
  $$ values (true, 1::bigint) $$, '활성 PC 의 touch 는 active=true');
reset role;
select is((select presence from public.cloud_saves where user_id = '00000000-0000-0000-0000-0000000000e1'), 'asleep', 'touch 가 presence 를 바꾼다');

-- ── boot: 잠든 PC 는 바로 넘겨받는다(D17) ──
set local role authenticated;
select pg_temp.act('e1');
select results_eq($$ select outcome, rev, has_save, other_label from public.claim_device('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PC B', '0.13.0', 'boot', false) $$,
  $$ values ('claimed'::text, 1::bigint, true, 'PC A'::text) $$, 'boot 는 잠든 PC A 를 바로 넘겨받는다');
select results_eq($$ select active, rev from public.touch_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '0.13.0', 'active') $$,
  $$ values (false, 1::bigint) $$, '밀려난 PC A 의 touch 는 active=false');
select throws_ok($$ select public.upload_save('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, '{"v":3}', 3, '0.13.0', '0e000000-0000-0000-0000-000000000004') $$, 'P0001', 'CLOUD_NOT_ACTIVE', '밀려난 PC A 는 올리지 못한다');
reset role;
select ok(exists (select 1 from realtime.messages where topic = 'account:00000000-0000-0000-0000-0000000000e1' and event = 'kicked'
  and payload ->> 'label' = 'PC B' and payload ->> 'device' = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 'kicked 신호에 새 PC 의 이름이 있다');
select results_eq($$ select active_device, presence from public.cloud_saves where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  $$ values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'active'::text) $$, 'claim 이 presence 를 active 로 되돌린다');

-- ── late: 상대가 온라인이면 물러난다(D20). force 여도 같다 ──
update public.cloud_saves set last_seen = now() - interval '149 seconds' where user_id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select pg_temp.act('e1');
select results_eq($$ select outcome, other_label, other_seen from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A', '0.13.0', 'late', false) $$,
  $$ values ('yield'::text, 'PC B'::text, now() - interval '149 seconds') $$, 'late 는 온라인인 PC B 에 양보한다');
select is((select outcome from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A', '0.13.0', 'late', true)), 'yield', 'force 여도 상대가 온라인이면 양보한다');
reset role;
select is((select active_device from public.cloud_saves where user_id = '00000000-0000-0000-0000-0000000000e1'), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, '양보하면 활성 기기가 그대로다');

-- ── 연결 끊김: 확인(confirm) 뒤 force 로 넘겨받는다(G2) ──
update public.cloud_saves set last_seen = now() - interval '150 seconds' where user_id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select pg_temp.act('e1');
select results_eq($$ select outcome, other_label, other_seen from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A', '0.13.0', 'boot', false) $$,
  $$ values ('confirm'::text, 'PC B'::text, now() - interval '150 seconds') $$, 'boot 도 끊긴 PC B 는 확인을 받는다');
select is((select outcome from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A', '0.13.0', 'late', false)), 'confirm', 'late 도 끊긴 PC B 는 확인을 받는다');
select is((select outcome from public.claim_device('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PC B', '0.13.0', 'boot', false)), 'claimed', '끊겼던 같은 PC 가 다시 켜지면 확인 없이 claimed');
reset role;
update public.cloud_saves set last_seen = now() - interval '10 minutes' where user_id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select pg_temp.act('e1');
select results_eq($$ select outcome, other_label from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A', '0.13.0', 'late', true) $$,
  $$ values ('claimed'::text, 'PC B'::text) $$, 'force 면 끊긴 PC B 를 넘겨받는다');

-- ── boot: 온라인 PC 도 바로 넘겨받는다(D17) ──
select is((select outcome from public.claim_device('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PC B', '0.13.0', 'boot', false)), 'claimed', 'boot 는 온라인 PC A 를 바로 넘겨받는다');

-- ── late: 정상 종료·옛 앱 행은 바로 넘겨받는다 ──
select results_eq($$ select active from public.touch_device('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '0.13.0', 'released') $$, $$ values (true) $$, 'PC B 가 정상 종료를 알린다');
select is((select outcome from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A', '0.13.0', 'late', false)), 'claimed', 'late 는 정상 종료한 PC B 를 넘겨받는다');
reset role;
update public.cloud_saves set last_seen = null where user_id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select pg_temp.act('e1');
select is((select outcome from public.claim_device('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PC B', '0.13.0', 'late', false)), 'claimed', 'late 는 옛 앱 행(unknown)을 넘겨받는다');
select results_eq($$ select active from public.touch_device('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '0.13.0', 'asleep') $$, $$ values (true) $$, 'PC B 가 잠듦을 알린다');
select is((select outcome from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A', '0.13.0', 'late', false)), 'claimed', 'late 는 잠든 PC B 를 넘겨받는다');
-- 지금 활성: PC A

-- ── 설정 표의 최소 버전을 따른다 ──
reset role;
update cloud_private.settings set value = '0.14.0' where key = 'min_app_version';
set local role authenticated;
select pg_temp.act('e1');
select throws_ok($$ select * from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A', '0.13.9', 'boot', false) $$, 'P0001', 'CLOUD_UPDATE_REQUIRED', '설정 표를 올리면 0.13.9 는 거부');
select is((select outcome from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A', '0.14.0', 'boot', false)), 'claimed', '설정 표의 버전과 같으면 통과');
reset role;
update cloud_private.settings set value = '0.13.0' where key = 'min_app_version';

-- ── 교환 ──
-- 교환이 열려 있으면 다른 PC 는 넘겨받지 못한다
insert into public.trade_channels (id, token_hash, host, guest, protocol, data_version, expires_at, status)
  values ('0e0000cc-0000-0000-0000-000000000001', extensions.gen_random_bytes(32), '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2', 1, 'dv1', now() + interval '10 minutes', 'joined');
set local role authenticated;
select pg_temp.act('e1');
select throws_ok($$ select * from public.claim_device('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PC B', '0.13.0', 'boot', false) $$, 'P0001', 'CLOUD_TRADE_ACTIVE', '교환이 열려 있으면 넘겨받지 못한다');
select is((select outcome from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A', '0.13.0', 'boot', false)), 'claimed', '같은 PC 는 교환 중에도 막지 않는다');

-- 끝났지만 서버 저장에 반영되지 않은 교환
reset role;
update public.trade_channels set status = 'done', done_at = now() - interval '1 day' where id = '0e0000cc-0000-0000-0000-000000000001';
-- 서버 저장은 교환 완료 전에 올라왔다 — 반영 알림(applied_at)도 없다
update public.cloud_saves set updated_at = now() - interval '2 days' where user_id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select pg_temp.act('e1');
select throws_ok($$ select * from public.claim_device('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PC B', '0.13.0', 'boot', false) $$, 'P0001', 'CLOUD_TRADE_UNSYNCED', '반영하지 않은 교환이 있으면 넘겨받지 못한다');
select is((select outcome from public.claim_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PC A', '0.13.0', 'boot', false)), 'claimed', '같은 PC 는 반영 전이어도 막지 않는다');
select throws_ok($$ select * from public.claim_device('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PC B', '0.13.0', 'late', true) $$, 'P0001', 'CLOUD_TRADE_UNSYNCED', 'force 여도 반영 전 교환은 막는다');

-- 서버 저장의 pending 이 그 채널이면 받는 PC 가 반영하므로 막지 않는다
reset role;
update public.cloud_saves set save = '{"v":3,"trade":{"pending":{"channelId":"0e0000cc-0000-0000-0000-000000000001"}}}'
  where user_id = '00000000-0000-0000-0000-0000000000e1';
select ok(not cloud_private.trade_unsynced('00000000-0000-0000-0000-0000000000e1', (select s from public.cloud_saves s where s.user_id = '00000000-0000-0000-0000-0000000000e1')), '서버 저장 pending 에 있으면 반영 전이 아니다');
update public.cloud_saves set save = '{"v":3,"trade":{"pending":null}}', updated_at = now()
  where user_id = '00000000-0000-0000-0000-0000000000e1';
-- 반영 시각이 서버 저장보다 앞이면 반영분이 올라간 것이다
update public.trade_channels set host_applied_at = now() - interval '1 minute' where id = '0e0000cc-0000-0000-0000-000000000001';
select ok(not cloud_private.trade_unsynced('00000000-0000-0000-0000-0000000000e1', (select s from public.cloud_saves s where s.user_id = '00000000-0000-0000-0000-0000000000e1')), '반영 뒤 올렸으면 막지 않는다');
update public.trade_channels set host_applied_at = now() + interval '1 minute' where id = '0e0000cc-0000-0000-0000-000000000001';
select ok(cloud_private.trade_unsynced('00000000-0000-0000-0000-0000000000e1', (select s from public.cloud_saves s where s.user_id = '00000000-0000-0000-0000-0000000000e1')), '반영 뒤 올리지 않았으면 막는다');
-- 반영 알림(applied_at)이 비었어도 done 뒤에 pending 없이 올라온 저장이면 반영분이 올라간 것이다
update public.trade_channels set host_applied_at = null where id = '0e0000cc-0000-0000-0000-000000000001';
select ok(not cloud_private.trade_unsynced('00000000-0000-0000-0000-0000000000e1', (select s from public.cloud_saves s where s.user_id = '00000000-0000-0000-0000-0000000000e1')), 'applied_at 이 비어도 done 뒤에 올린 저장이면 막지 않는다');
update public.cloud_saves set updated_at = now() - interval '1 day' where user_id = '00000000-0000-0000-0000-0000000000e1';
select ok(cloud_private.trade_unsynced('00000000-0000-0000-0000-0000000000e1', (select s from public.cloud_saves s where s.user_id = '00000000-0000-0000-0000-0000000000e1')), 'applied_at 이 비고 저장 시각이 done_at 과 같으면 막는다');
update public.cloud_saves set updated_at = now() - interval '2 days' where user_id = '00000000-0000-0000-0000-0000000000e1';
select ok(cloud_private.trade_unsynced('00000000-0000-0000-0000-0000000000e1', (select s from public.cloud_saves s where s.user_id = '00000000-0000-0000-0000-0000000000e1')), 'applied_at 이 비고 done 전에 올린 저장이면 막는다');
-- 서버 저장이 없으면 반영 시각과 무관하게 막는다
update public.trade_channels set host_applied_at = now() - interval '1 minute' where id = '0e0000cc-0000-0000-0000-000000000001';
update public.cloud_saves set save = null, updated_at = now() where user_id = '00000000-0000-0000-0000-0000000000e1';
select ok(cloud_private.trade_unsynced('00000000-0000-0000-0000-0000000000e1', (select s from public.cloud_saves s where s.user_id = '00000000-0000-0000-0000-0000000000e1')), '서버 저장이 없으면 반영 뒤여도 막는다');
update public.cloud_saves set save = '{"v":3,"trade":{"pending":null}}', updated_at = now() - interval '8 days'
  where user_id = '00000000-0000-0000-0000-0000000000e1';
-- 7일 경계. done_at 이 7일 이내일 때만 막는다 (저장 시각은 done_at 보다 앞)
update public.trade_channels set host_applied_at = null, done_at = now() - interval '7 days' + interval '1 minute' where id = '0e0000cc-0000-0000-0000-000000000001';
select ok(cloud_private.trade_unsynced('00000000-0000-0000-0000-0000000000e1', (select s from public.cloud_saves s where s.user_id = '00000000-0000-0000-0000-0000000000e1')), '7일 1분 전 완료는 막는다');
update public.trade_channels set done_at = now() - interval '7 days' where id = '0e0000cc-0000-0000-0000-000000000001';
select ok(not cloud_private.trade_unsynced('00000000-0000-0000-0000-0000000000e1', (select s from public.cloud_saves s where s.user_id = '00000000-0000-0000-0000-0000000000e1')), '정확히 7일 전 완료는 막지 않는다');
set local role authenticated;
select pg_temp.act('e1');
select results_eq($$ select outcome, other_label from public.claim_device('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PC B', '0.13.0', 'boot', false) $$,
  $$ values ('claimed'::text, 'PC A'::text) $$, '7일이 지난 교환은 넘겨받기를 막지 않는다');

-- ── 받기는 그대로 ──
select results_eq($$ select rev from public.download_save('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$, $$ values (1::bigint) $$, '활성 PC 는 받는다');
select throws_ok($$ select * from public.download_save('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$, 'P0001', 'CLOUD_NOT_ACTIVE', '밀려난 PC 는 받지 못한다');

select * from finish();
rollback;
