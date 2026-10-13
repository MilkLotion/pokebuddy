-- 랜덤 배틀 상대 — 6칸이 다 찬 배틀 파티만 후보, 새로고침은 판마다 1번, 새로고침은 이미 보인 상대를 뺀다
-- (2026-10-14 사용자 "6마리 다 스쿼드를 안채우면 랜덤배틀에 안나오게. 리롤은 1번만 할 수 있게. 리롤하면 이전 파티들은 제외하고 나머지에서 랜덤으로 나오게.")
-- 규칙은 docs/specs/adventure.md "상대 고르기", "서버"
--   battle_offers.rerolled  이 offer 에서 새로고침을 썼는가. 판을 기록하면 offer 를 지우므로 다음 판에 다시 1번 생긴다
--   battle_offers.seen      이 offer 에서 지금까지 보인 상대 계정. 새로고침은 이 계정들을 뺀다
--   열기(p_reroll false)    남은 offer 가 있으면 같은 3개를 다시 준다 — 모달을 닫았다 열어 다시 뽑지 못하게
--                           새로고침 전 offer 가 3개보다 적으면(그때 후보가 모자랐다) 다시 채운다. 새로고침한 offer 는 채우지 않는다
--   6칸 검사는 등록(upload-save)과 여기 둘 다 한다. 이 마이그레이션 전에 등록된 5칸 이하 파티도 여기서 걸러진다

alter table cloud_private.battle_offers
  add column rerolled boolean not null default false,
  add column seen uuid[] not null default '{}';

drop function public.battle_offer_make(uuid);

create function public.battle_offer_make(p_user uuid, p_reroll boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cur cloud_private.battle_offers;
  v_picks jsonb;
  v_offer uuid := gen_random_uuid();
  v_tests uuid[] := string_to_array(cloud_private.setting('battle_test_users', ''), ',')::uuid[];
  v_skip uuid[] := '{}';
  v_rerolled boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('battle:' || p_user::text));
  select * into cur from cloud_private.battle_offers o where o.user_id = p_user;
  if cur.user_id is not null then
    if p_reroll and cur.rerolled then raise exception 'BATTLE_REROLL_USED'; end if;
    if not p_reroll and (cur.rerolled or jsonb_array_length(cur.picks) >= 3) then
      return jsonb_build_object('offer_id', cur.offer_id, 'picks', cur.picks, 'rerolled', cur.rerolled);
    end if;
    if now() - cur.created_at < interval '1 second' then raise exception 'BATTLE_TOO_FAST'; end if;
    v_rerolled := cur.rerolled or p_reroll;
    if p_reroll then v_skip := cur.seen; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', e.user_id, 'party', e.party)), '[]'::jsonb) into v_picks
    from (select x.user_id, x.party from cloud_private.battle_entries x
           where x.user_id <> p_user
             and not (x.user_id = any(v_skip))
             and (p_user = any(v_tests) or not (x.user_id = any(v_tests)))
             and (select count(*) from jsonb_array_elements(x.party) s where jsonb_typeof(s) = 'object') = 6
           order by random() limit 3) e;
  insert into cloud_private.battle_offers (user_id, offer_id, picks, created_at, rerolled, seen)
    values (p_user, v_offer, v_picks, now(), v_rerolled,
            coalesce(cur.seen, '{}') || array(select (p ->> 'user_id')::uuid from jsonb_array_elements(v_picks) p))
    on conflict (user_id) do update set offer_id = excluded.offer_id, picks = excluded.picks, created_at = excluded.created_at,
                                        rerolled = excluded.rerolled, seen = excluded.seen;
  return jsonb_build_object('offer_id', v_offer, 'picks', v_picks, 'rerolled', v_rerolled);
end;
$$;

revoke all on function public.battle_offer_make(uuid, boolean) from public, anon, authenticated;
grant execute on function public.battle_offer_make(uuid, boolean) to service_role;
