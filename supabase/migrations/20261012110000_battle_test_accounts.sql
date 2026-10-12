-- 시험 계정의 배틀 파티는 시험 계정에게만 상대로 보인다 (2026-10-12 사용자 "1번만", "테스트계정은 2개로 고정해서 써")
--   settings 'battle_test_users' — 시험 계정 uuid 를 쉼표로 이은 값. 시험 계정 둘(pbtest_a·pbtest_b)과 예전 공용 시험 계정(익명 30af941a)
--   일반 계정이 받는 상대 3개에서는 시험 계정의 파티를 뺀다. 시험 계정이 받는 상대에는 시험 계정끼리도 들어간다(두 계정만으로 랜덤 배틀을 시험한다)
--   등록(battle_register)·기록은 그대로다. 보이는 쪽만 거른다

insert into cloud_private.settings (key, value) values
  ('battle_test_users', '40bcf0bc-2c0b-4c75-b591-17559b6bfc9b,a1798f1c-8108-4e48-bf0f-06409f384a80,30af941a-44f5-4467-88e9-69d9f60137fc')
  on conflict (key) do update set value = excluded.value;

create or replace function public.battle_offer_make(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prev timestamptz;
  v_picks jsonb;
  v_offer uuid := gen_random_uuid();
  v_tests uuid[] := string_to_array(cloud_private.setting('battle_test_users', ''), ',')::uuid[];
begin
  perform pg_advisory_xact_lock(hashtext('battle:' || p_user::text));
  select o.created_at into prev from cloud_private.battle_offers o where o.user_id = p_user;
  if prev is not null and now() - prev < interval '1 second' then raise exception 'BATTLE_TOO_FAST'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', e.user_id, 'party', e.party)), '[]'::jsonb) into v_picks
    from (select x.user_id, x.party from cloud_private.battle_entries x
           where x.user_id <> p_user and (p_user = any(v_tests) or not (x.user_id = any(v_tests)))
           order by random() limit 3) e;
  insert into cloud_private.battle_offers (user_id, offer_id, picks, created_at) values (p_user, v_offer, v_picks, now())
    on conflict (user_id) do update set offer_id = excluded.offer_id, picks = excluded.picks, created_at = excluded.created_at;
  return jsonb_build_object('offer_id', v_offer, 'picks', v_picks);
end;
$$;
