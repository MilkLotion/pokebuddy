-- 아이디 로그인 검사 — npx supabase test db
-- docs/work/trade/trade.md "계정과 로그인 > 아이디와 비밀번호"
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data, is_anonymous, aud, role, created_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'jiwoo_01@id.pokebuddy.invalid', '{"display_name":"지우"}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000a1', null, '{}', true, 'authenticated', 'authenticated', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":true}', true);
select is(public.is_username_available('jiwoo_01'), false, '이미 쓰는 아이디');
select is(public.is_username_available('JIWOO_01'), false, '대문자로 넣어도 같은 아이디');
select is(public.is_username_available('newbie_1'), true, '쓸 수 있는 아이디');
select is(public.is_username_available('admin'), false, '예약 아이디');
select throws_ok($$ select public.is_username_available('ab') $$, 'P0001', 'AUTH_USERNAME_INVALID', '4자 미만');
select throws_ok($$ select public.is_username_available('1abc') $$, 'P0001', 'AUTH_USERNAME_INVALID', '숫자로 시작');
select throws_ok($$ select public.is_username_available('지우지우') $$, 'P0001', 'AUTH_USERNAME_INVALID', '한글 아이디는 받지 않는다');
select throws_ok($$ select public.is_username_available('abcdefghijklmnopq') $$, 'P0001', 'AUTH_USERNAME_INVALID', '16자 초과');

-- 가입 전 검사(트리거) — 인증 서버의 가입 요청을 흉내 낸다
reset role;
select throws_ok($$ insert into auth.users (id, email, raw_user_meta_data, aud, role) values (gen_random_uuid(), 'admin@id.pokebuddy.invalid', '{"display_name":"관리"}', 'authenticated', 'authenticated') $$,
  'P0001', 'AUTH_USERNAME_RESERVED', '예약 아이디로는 가입하지 못한다');
select throws_ok($$ insert into auth.users (id, email, raw_user_meta_data, aud, role) values (gen_random_uuid(), '9abc@id.pokebuddy.invalid', '{"display_name":"구"}', 'authenticated', 'authenticated') $$,
  'P0001', 'AUTH_USERNAME_INVALID', '규칙 밖 아이디로는 가입하지 못한다');
select throws_ok($$ insert into auth.users (id, email, raw_user_meta_data, aud, role) values (gen_random_uuid(), 'newbie_1@id.pokebuddy.invalid', '{}', 'authenticated', 'authenticated') $$,
  'P0001', 'AUTH_NAME_INVALID', '이름 없이는 가입하지 못한다');
select throws_ok($$ insert into auth.users (id, email, raw_user_meta_data, aud, role) values (gen_random_uuid(), 'newbie_1@id.pokebuddy.invalid', '{"display_name":"열세글자이름을넣어봅니다아"}', 'authenticated', 'authenticated') $$,
  'P0001', 'AUTH_NAME_INVALID', '이름이 12자를 넘으면 가입하지 못한다');
select lives_ok($$ insert into auth.users (id, email, raw_user_meta_data, aud, role) values (gen_random_uuid(), 'newbie_1@id.pokebuddy.invalid', '{"display_name":"새내기"}', 'authenticated', 'authenticated') $$,
  '규칙에 맞으면 가입한다');
select lives_ok($$ insert into auth.users (id, email, raw_user_meta_data, aud, role) values (gen_random_uuid(), 'someone@example.com', '{"user_name":"someone"}', 'authenticated', 'authenticated') $$,
  'GitHub 가입(내부 주소가 아님)은 검사하지 않는다');
select throws_ok($$ insert into auth.users (id, email, raw_user_meta_data, aud, role) values (gen_random_uuid(), 'newbie_1@id.pokebuddy.invalid', '{"display_name":"또"}', 'authenticated', 'authenticated') $$,
  '23505', null, '같은 아이디는 두 번 가입하지 못한다(인증 서버는 주소를 소문자로 저장한다)');

select * from finish();
rollback;
