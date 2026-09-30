-- 서버 저장 검증 P4a 검사 — npx supabase test db
-- 20261003100000_save_verify.sql: accept_save·save_verify_context·reject_save(service_role 전용), 관찰·거부 모드, 옛 upload_save 닫기
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data, is_anonymous, aud, role, created_at) values
  ('00000000-0000-0000-0000-0000000000e1', null, '{}', true, 'authenticated', 'authenticated', now());

-- 권한 — 앱(authenticated)은 검증을 거치지 않는 길을 부르지 못한다
select ok(not has_function_privilege('authenticated', 'public.accept_save(uuid, uuid, bigint, bigint, jsonb, int, text, uuid, jsonb)', 'execute'), 'authenticated 는 accept_save 를 못 부른다');
select ok(not has_function_privilege('anon', 'public.accept_save(uuid, uuid, bigint, bigint, jsonb, int, text, uuid, jsonb)', 'execute'), 'anon 은 accept_save 를 못 부른다');
select ok(not has_function_privilege('authenticated', 'public.save_verify_context(uuid)', 'execute'), 'authenticated 는 문맥을 못 읽는다');
select ok(not has_function_privilege('authenticated', 'public.reject_save(uuid, jsonb, text)', 'execute'), 'authenticated 는 거부 기록을 못 쓴다');
select ok(has_function_privilege('service_role', 'public.accept_save(uuid, uuid, bigint, bigint, jsonb, int, text, uuid, jsonb)', 'execute'), 'service_role 은 accept_save');
select ok(has_function_privilege('service_role', 'public.save_verify_context(uuid)', 'execute'), 'service_role 은 문맥');
select ok(not has_function_privilege('authenticated', 'public.admin_save_violations(uuid, int)', 'execute'), 'authenticated 는 위반 목록을 못 본다');
select ok(not has_function_privilege('authenticated', 'public.admin_verify_settings(text, double precision)', 'execute'), 'authenticated 는 검증 설정을 못 바꾼다');
select throws_ok($$ select public.admin_verify_settings('lenient', null) $$, 'P0001', 'CLOUD_BAD_ARGS', '모르는 모드는 거절');
select is(public.admin_verify_settings(null, 1.2)->>'margin', '1.2', '여유를 바꾼다');
select is(public.admin_verify_settings(null, 1.1)->>'mode', 'observe', '모드는 그대로');

-- 옛 upload_save 는 업데이트 안내만
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated","is_anonymous":true}', true);
select throws_ok($$ select public.upload_save('11111111-1111-1111-1111-1111111111e1', 0, '{"v":3,"pets":[{"id":"p1","since":1}]}', 3, '0.13.0', '0e000000-0000-0000-0000-000000000001') $$,
  'P0001', 'CLOUD_UPDATE_REQUIRED', '옛 upload_save 는 닫혔다');
reset role;

-- 첫 저장 — 없는 사용자
select throws_ok($$ select public.accept_save('00000000-0000-0000-0000-0000000000ff', '11111111-1111-1111-1111-1111111111e1', 0, null, '{"v":3,"pets":[{"id":"p1","since":1}]}', 3, '0.13.0', '0e000000-0000-0000-0000-000000000009', '[]') $$,
  'P0001', 'CLOUD_LOGIN_REQUIRED', '없는 사용자');
select is(public.accept_save('00000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-1111111111e1', 0, null,
  '{"v":3,"pets":[{"id":"p1","since":1}],"points":{"balance":10}}', 3, '0.13.0', '0e000000-0000-0000-0000-000000000002', '[]'), 1::bigint, '익명 첫 저장 → rev 1');
select ok((select last_accepted_at is not null from public.cloud_saves where user_id = '00000000-0000-0000-0000-0000000000e1'), '받은 시각을 적는다');

-- 문맥 — 직전 저장·rev·틈·설정·그사이 우편
update public.cloud_saves set last_accepted_at = now() - interval '1 hour' where user_id = '00000000-0000-0000-0000-0000000000e1';
insert into public.mail_letters (id, title, gifts) values
  ('0e000000-0000-0000-0000-0000000000a1', '선물', '[{"kind":"points","count":500},{"kind":"item","id":"exp-candy-m","count":3},{"kind":"pokemon","species":"pikachu","count":1}]'),
  ('0e000000-0000-0000-0000-0000000000a2', '옛 선물', '[{"kind":"points","count":9000}]');
insert into public.mail_claims (letter_id, user_id, claimed_at) values
  ('0e000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', now()),
  ('0e000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1', now() - interval '2 hours');
select is((public.save_verify_context('00000000-0000-0000-0000-0000000000e1')->>'rev')::bigint, 1::bigint, '문맥 rev');
select ok((public.save_verify_context('00000000-0000-0000-0000-0000000000e1')->>'gap_ms')::double precision between 3590000 and 3700000, '틈은 서버 시각 기준 한 시간');
select is(public.save_verify_context('00000000-0000-0000-0000-0000000000e1')->>'mode', 'observe', '기본은 관찰 모드');
select is((public.save_verify_context('00000000-0000-0000-0000-0000000000e1')->>'margin')::double precision, 1.1::double precision, '여유 1.1');
select is(public.save_verify_context('00000000-0000-0000-0000-0000000000e1')->'letters'->'0e000000-0000-0000-0000-0000000000a1'->0->>'count', '500', '받은 편지는 id 로 — 선물 그대로');
select ok(public.save_verify_context('00000000-0000-0000-0000-0000000000e1')->'letters' ? '0e000000-0000-0000-0000-0000000000a2', '받은 시각과 상관없이 받은 편지 전부');
select is(public.save_verify_context('00000000-0000-0000-0000-0000000000f0')->>'found', 'false', '행 없는 사용자');
select is((public.save_verify_context('00000000-0000-0000-0000-0000000000e1')->>'trades')::int, 0, '끝난 교환 없음');
select is(public.save_verify_context('00000000-0000-0000-0000-0000000000e1')->'trades_before', '[]'::jsonb, '직전 저장 전에 끝난 교환 없음');

-- 관찰 모드 — 위반이 있어도 받는다. 적고 unverified
select throws_ok($$ select public.accept_save('00000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-1111111111e1', 1, null,
  '{"v":3,"pets":[{"id":"p1","since":1}],"points":{"balance":99999}}', 3, '0.13.0', '0e000000-0000-0000-0000-000000000013', '[]') $$,
  'P0001', 'CLOUD_REV_CONFLICT', '비교하지 않은 요청(비교한 rev 없음)은 기존 행에 쓰지 못한다');
select throws_ok($$ select public.accept_save('00000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-1111111111e1', 1, 0,
  '{"v":3,"pets":[{"id":"p1","since":1}],"points":{"balance":99999}}', 3, '0.13.0', '0e000000-0000-0000-0000-000000000014', '[]') $$,
  'P0001', 'CLOUD_REV_CONFLICT', '다른 rev 로 비교한 요청은 쓰지 못한다');
select is(public.accept_save('00000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-1111111111e1', 1, 1,
  '{"v":3,"pets":[{"id":"p1","since":1}],"points":{"balance":99999}}', 3, '0.13.0', '0e000000-0000-0000-0000-000000000003',
  '[{"rule":"points","value":99989,"limit":793}]'), 2::bigint, '관찰 모드는 받는다 → rev 2');
select is((select trust from public.cloud_saves where user_id = '00000000-0000-0000-0000-0000000000e1'), 'unverified', '위반 저장은 unverified');
select results_eq($$ select rule, value, lim, rev, rejected from cloud_private.save_violations where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  $$ values ('points'::text, 99989::double precision, 793::double precision, 2::bigint, false) $$, '위반을 적는다');
select ok((select last_accepted_at > now() - interval '1 minute' from public.cloud_saves where user_id = '00000000-0000-0000-0000-0000000000e1'), '받은 시각을 새로 적는다');

-- 거부 모드 — 위반이면 쓰지 않는다
update cloud_private.settings set value = 'enforce' where key = 'verify_mode';
select throws_ok($$ select public.accept_save('00000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-1111111111e1', 2, 2,
  '{"v":3,"pets":[]}', 3, '0.13.0', '0e000000-0000-0000-0000-000000000004', '[{"rule":"new-pets","value":9,"limit":0}]') $$,
  'P0001', 'CLOUD_SAVE_REJECTED', '거부 모드는 위반 저장을 받지 않는다');
select is((select rev from public.cloud_saves where user_id = '00000000-0000-0000-0000-0000000000e1'), 2::bigint, '거부하면 rev 그대로');
select is(public.reject_save('00000000-0000-0000-0000-0000000000e1', '[{"rule":"new-pets","value":9,"limit":0},{"rule":"shiny","value":2,"limit":0}]', '0.13.0'), 2, '거부 기록 둘');
select is((select count(*)::int from cloud_private.save_violations where user_id = '00000000-0000-0000-0000-0000000000e1' and rejected and rev is null), 2, '거부 기록은 rev 없음');
select is(public.accept_save('00000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-1111111111e1', 2, 2,
  '{"v":3,"pets":[{"id":"p1","since":1}]}', 3, '0.13.0', '0e000000-0000-0000-0000-000000000005', '[]'), 3::bigint, '위반 없는 저장은 거부 모드에서도 받는다');
select is((select trust from public.cloud_saves where user_id = '00000000-0000-0000-0000-0000000000e1'), 'unverified', '한 번 unverified 면 남는다');

select * from finish();
rollback;
