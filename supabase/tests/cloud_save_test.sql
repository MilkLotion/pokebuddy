-- 클라우드 저장 검사 — npx supabase test db
-- docs/work/trade/record.md "클라우드 저장"
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data, is_anonymous, aud, role, created_at) values
  ('00000000-0000-0000-0000-0000000000b2', 'jiwoo_02@id.pokebuddy.invalid', '{"display_name":"지우"}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000a2', null, '{}', true, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000c2', null, '{}', true, 'authenticated', 'authenticated', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","is_anonymous":true}', true);
select throws_ok($$ select * from public.claim_device('11111111-1111-1111-1111-111111111111', 'PC') $$, 'P0001', 'CLOUD_LOGIN_REQUIRED', '익명 계정은 서버에 저장하지 않는다');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated","is_anonymous":false}', true);
select throws_ok($$ select * from public.cloud_saves $$, '42501', null, '앱 역할은 테이블을 직접 읽지 못한다');
select is((select has_save from public.claim_device('11111111-1111-1111-1111-111111111111', 'PC A')), false, '처음 로그인하면 저장이 없다');
select is(public.upload_save('11111111-1111-1111-1111-111111111111', 0, '{"v":3,"pets":[]}', 3, '0.3.1'), 1::bigint, 'PC A 가 올린다 → rev 1');
select is((select rev from public.download_save('11111111-1111-1111-1111-111111111111')), 1::bigint, 'PC A 가 받는다');
select throws_ok($$ select public.upload_save('11111111-1111-1111-1111-111111111111', 0, '{"v":3}', 3, '0.3.1') $$, 'P0001', 'CLOUD_REV_CONFLICT', '옛 rev 로는 올리지 못한다');

-- 나중에 켜진 PC B 가 활성이 된다. PC A 는 올리지도 받지도 못한다
select is((select rev from public.claim_device('22222222-2222-2222-2222-222222222222', 'PC B')), 1::bigint, 'PC B 가 넘겨받는다');
select throws_ok($$ select public.upload_save('11111111-1111-1111-1111-111111111111', 1, '{"v":3}', 3, '0.3.1') $$, 'P0001', 'CLOUD_NOT_ACTIVE', '밀려난 PC A 는 올리지 못한다');
select throws_ok($$ select * from public.download_save('11111111-1111-1111-1111-111111111111') $$, 'P0001', 'CLOUD_NOT_ACTIVE', '밀려난 PC A 는 받지 못한다');
select is(public.upload_save('22222222-2222-2222-2222-222222222222', 1, '{"v":3,"pets":[1]}', 3, '0.3.1'), 2::bigint, 'PC B 가 올린다 → rev 2');
select throws_ok($$ select public.upload_save('22222222-2222-2222-2222-222222222222', 2, jsonb_build_object('big', (select string_agg(md5(i::text), '') from generate_series(1, 9000) i)), 3, '0.3.1') $$,
  'P0001', 'CLOUD_TOO_LARGE', '256KB 를 넘으면 올리지 못한다');

reset role;
select ok(exists (select 1 from realtime.messages where topic = 'account:00000000-0000-0000-0000-0000000000b2' and event = 'kicked'), '앞 PC 에 kicked 신호를 보낸다');

-- 다른 PC 가 교환 중이면 넘겨받지 않는다. 같은 PC 는 막지 않는다
insert into public.trade_channels (token_hash, host, guest, protocol, data_version, expires_at, status)
  values (extensions.gen_random_bytes(32), '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', 1, 'dv1', now() + interval '10 minutes', 'joined');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated","is_anonymous":false}', true);
select throws_ok($$ select * from public.claim_device('11111111-1111-1111-1111-111111111111', 'PC A') $$, 'P0001', 'CLOUD_TRADE_ACTIVE', '다른 PC 가 교환 중이면 넘겨받지 못한다');
select lives_ok($$ select * from public.claim_device('22222222-2222-2222-2222-222222222222', 'PC B') $$, '같은 PC 가 다시 켜진 것은 막지 않는다');

select * from finish();
rollback;
