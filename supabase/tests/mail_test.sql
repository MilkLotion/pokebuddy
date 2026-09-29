-- 우편함 검사 — npx supabase test db
-- worklog/records/post-box/record.md "구현 설계"
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 로컬 DB 에 남은 편지와 섞이지 않게 비우고 시작한다. 끝의 rollback 으로 되돌아온다
delete from public.mail_claims;
delete from public.mail_letters;

insert into auth.users (id, email, raw_user_meta_data, is_anonymous, aud, role, created_at) values
  ('00000000-0000-0000-0000-0000000000b3', 'mail_01@id.pokebuddy.invalid', '{"display_name":"편지"}', false, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000a3', null, '{}', true, 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000000b4', 'mail_02@id.pokebuddy.invalid', '{"display_name":"남"}', false, 'authenticated', 'authenticated', now());

insert into public.mail_letters (id, title, body, gifts, starts_at, ends_at) values
  ('10000000-0000-0000-0000-000000000001', '추석 맞이 선물이 왔어요', '본문', '[{"kind":"item","id":"exp-candy-m","count":3}]', now() - interval '1 day', now() + interval '7 days'),
  ('10000000-0000-0000-0000-000000000002', '놀이공간이 여러 화면을 지원해요', '공지', '[]', now() - interval '2 days', null),
  ('10000000-0000-0000-0000-000000000003', '지난 선물', '', '[{"kind":"points","count":100}]', now() - interval '10 days', now() - interval '1 day'),
  ('10000000-0000-0000-0000-000000000004', '다음 주 선물', '', '[{"kind":"points","count":100}]', now() + interval '3 days', null);

-- 받는 사람이 정해진 편지 — b3 에게만
insert into public.mail_letters (id, title, body, gifts, starts_at, ends_at, recipient) values
  ('10000000-0000-0000-0000-000000000005', '당신에게만 온 선물', '', '[{"kind":"points","count":500}]', now() - interval '1 hour', null, '00000000-0000-0000-0000-0000000000b3');

select throws_ok($$ insert into public.mail_letters (title, gifts) values ('x', '{}') $$, '23514', null, '선물은 배열이다');

-- 로그인하지 않은 앱 — 목록은 보인다. 받지는 못한다
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*) from public.list_mail()), 2::bigint, '시작했고 기간 안인 편지 둘 — 지난 편지와 다음 주 편지는 빠진다');
select throws_ok($$ select * from public.mail_letters $$, '42501', null, '표를 직접 읽지 못한다');
select throws_ok($$ select * from public.claim_mail('10000000-0000-0000-0000-000000000001') $$, '42501', null, '로그인하지 않으면 받기 함수를 부르지 못한다');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","is_anonymous":true}', true);
select throws_ok($$ select * from public.claim_mail('10000000-0000-0000-0000-000000000001') $$, 'P0001', 'MAIL_LOGIN_REQUIRED', '익명 계정은 받지 못한다');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated","is_anonymous":false}', true);
select throws_ok($$ select * from public.mail_claims $$, '42501', null, '받은 기록 표를 직접 읽지 못한다');
select is((select gifts from public.claim_mail('10000000-0000-0000-0000-000000000001')), '[{"kind":"item","id":"exp-candy-m","count":3}]'::jsonb, '선물을 받는다');
select ok((select claimed_at from public.list_mail() where id = '10000000-0000-0000-0000-000000000001') is not null, '목록에 받은 시각이 붙는다');
select is((select count(*) from public.claim_mail('10000000-0000-0000-0000-000000000001')), 1::bigint, '다시 받으면 같은 선물을 돌려준다(끊김 복구)');
select throws_ok($$ select * from public.claim_mail('10000000-0000-0000-0000-000000000002') $$, 'P0001', 'MAIL_NO_GIFTS', '공지 편지는 받을 것이 없다');
select throws_ok($$ select * from public.claim_mail('10000000-0000-0000-0000-000000000003') $$, 'P0001', 'MAIL_EXPIRED', '기간이 지난 선물은 받지 못한다');
select throws_ok($$ select * from public.claim_mail('10000000-0000-0000-0000-000000000004') $$, 'P0001', 'MAIL_NOT_FOUND', '시작 전 편지는 없는 것과 같다');
select throws_ok($$ select * from public.claim_mail('10000000-0000-0000-0000-0000000000ff') $$, 'P0001', 'MAIL_NOT_FOUND', '없는 편지');
select ok(exists (select 1 from public.list_mail() where id = '10000000-0000-0000-0000-000000000005'), '나에게 온 편지가 목록에 보인다');
select is((select gifts from public.claim_mail('10000000-0000-0000-0000-000000000005')), '[{"kind":"points","count":500}]'::jsonb, '나에게 온 편지를 받는다');

-- 다른 계정 — 남에게 온 편지는 보이지도 받지도 못한다
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated","is_anonymous":false}', true);
select is((select count(*) from public.list_mail()), 2::bigint, '남에게 온 편지는 목록에서 빠진다');
select throws_ok($$ select * from public.claim_mail('10000000-0000-0000-0000-000000000005') $$, 'P0001', 'MAIL_NOT_FOUND', '남에게 온 편지는 없는 것과 같다');

reset role;
select is((select count(*) from public.mail_claims), 2::bigint, '받은 기록은 편지당 한 줄 — 두 번 받아도 늘지 않는다');
-- 받은 편지는 기간이 지나도 목록에 남는다
update public.mail_letters set ends_at = now() - interval '1 minute', starts_at = now() - interval '2 days' where id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated","is_anonymous":false}', true);
select ok(exists (select 1 from public.list_mail() where id = '10000000-0000-0000-0000-000000000001'), '받은 편지는 기간이 지나도 남는다');
select is((select count(*) from public.claim_mail('10000000-0000-0000-0000-000000000001')), 1::bigint, '받은 편지는 기간이 지나도 다시 돌려준다');

select * from finish();
rollback;
