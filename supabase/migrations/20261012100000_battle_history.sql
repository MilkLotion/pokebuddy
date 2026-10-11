-- 내 전적·배틀 상세 — 판 요약을 남기고, 최근 판에 판 id·상대 이름을 싣고, 판 하나의 상세를 읽는다
-- (docs/specs/adventure.md "배틀 기록", 2026-10-12 사용자 결정 "작은 요약을 남김", 상대 이름 "그렇게 진행해도돼")
--   요약(summary)은 양쪽 칸의 종·모습·이로치와 준 피해·받은 피해·싸운 시간이다. 관리자 정리(sides·battle_events 지움) 뒤에도 남긴다
--   상대 이름은 계정의 표시 이름이다. 익명 계정은 null — 앱이 `익명 트레이너` 로 보인다. 계정 식별자는 주지 않는다

alter table cloud_private.battles add column summary jsonb;

-- 계정의 표시 이름 — 친선 배틀의 친구 이름과 같은 정리(제어 문자 빼기, 12자). 없으면 null
create function cloud_private.display_name_of(p_user uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select nullif(left(btrim(regexp_replace(u.raw_user_meta_data ->> 'display_name', '[[:cntrl:]]', '', 'g')), 12), '')
    from auth.users u where u.id = p_user;
$$;
revoke all on function cloud_private.display_name_of(uuid) from public, anon, authenticated;

-- 판 기록 — 20261010120000_friendly_battle.sql 과 같고, 끝 인자 p_summary 를 판 줄에 넣는다
drop function public.battle_record(uuid, uuid, int, uuid, bigint, smallint, boolean, int, text, jsonb, jsonb);
create function public.battle_record(p_user uuid, p_offer uuid, p_pick int, p_opponent uuid, p_seed bigint, p_winner smallint,
                                     p_timeout boolean, p_end_ms int, p_data_hash text, p_sides jsonb, p_events jsonb,
                                     p_summary jsonb default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cool int := cloud_private.setting('battle_cooldown_sec', '300')::int;
  last_at timestamptz;
  day date := (now() at time zone 'Asia/Seoul')::date;
  v_reward int;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('battle:' || p_user::text));
  if cloud_private.is_held(p_user) then raise exception 'CLOUD_ACCOUNT_HELD'; end if;
  select max(b.created_at) into last_at from cloud_private.battles b where b.user_id = p_user and b.kind = 'random';
  if last_at is not null and now() < last_at + make_interval(secs => cool) then raise exception 'BATTLE_COOLDOWN'; end if;
  if public.battle_offer_get(p_user, p_offer, p_pick) is null then raise exception 'BATTLE_OFFER_GONE'; end if;
  if not exists (select 1 from cloud_private.battles b where b.user_id = p_user and b.kst_day = day and b.kind = 'random') then v_reward := 500;
  elsif p_winner = 0 then v_reward := 50;
  else v_reward := 10;
  end if;
  insert into cloud_private.battles (user_id, opponent_id, kst_day, seed, winner, timeout, end_ms, reward, data_hash, sides, summary)
    values (p_user, p_opponent, day, p_seed, p_winner, p_timeout, p_end_ms, v_reward, p_data_hash, p_sides, p_summary)
    returning id into v_id;
  insert into cloud_private.battle_events (battle_id, events) values (v_id, p_events);
  delete from cloud_private.battle_offers where user_id = p_user;
  perform cloud_private.battle_tally(p_user, p_opponent, p_winner);
  return jsonb_build_object('battle_id', v_id, 'reward', v_reward);
end;
$$;
revoke all on function public.battle_record(uuid, uuid, int, uuid, bigint, smallint, boolean, int, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.battle_record(uuid, uuid, int, uuid, bigint, smallint, boolean, int, text, jsonb, jsonb, jsonb) to service_role;

-- 내 배틀 기록 — 20261010120000_friendly_battle.sql 과 같고, 최근 판에 id(판 식별자)·name(상대 표시 이름)·detail(요약이 있는가)을 더한다
create or replace function public.battle_record_view()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  s cloud_private.battle_stats;
  seen timestamptz;
  v_recent jsonb;
  v_unseen jsonb;
begin
  if me is null then raise exception 'CLOUD_LOGIN_REQUIRED'; end if;
  select * into s from cloud_private.battle_stats x where x.user_id = me;
  seen := s.def_seen_at;
  select coalesce(jsonb_agg(r.j order by r.at desc), '[]'::jsonb) into v_recent
    from (
      select x.at, jsonb_build_object('id', x.id, 'at', x.at, 'mine', x.mine, 'result', x.result, 'reward', x.reward, 'endMs', x.end_ms,
                                      'name', cloud_private.display_name_of(x.other), 'detail', x.detail) as j
        from (
          (select b.id, b.created_at as at, true as mine, b.opponent_id as other,
                  case when b.winner = 0 then 'win' when b.winner = 1 then 'lose' else 'draw' end as result, b.reward, b.end_ms,
                  b.summary is not null as detail
             from cloud_private.battles b where b.user_id = me and b.kind = 'random' order by b.created_at desc limit 8)
          union all
          (select b.id, b.created_at, false, b.user_id,
                  case when b.winner = 1 then 'win' when b.winner = 0 then 'lose' else 'draw' end, null::int, b.end_ms,
                  b.summary is not null
             from cloud_private.battles b where b.opponent_id = me and b.kind = 'random' order by b.created_at desc limit 8)
        ) x
        order by x.at desc
        limit 8
    ) r;
  select jsonb_build_object(
      'wins', count(*) filter (where b.winner = 1),
      'losses', count(*) filter (where b.winner = 0),
      'draws', count(*) filter (where b.winner is null),
      'until', max(b.created_at))
    into v_unseen
    from cloud_private.battles b
    where b.opponent_id = me and b.kind = 'random' and (seen is null or b.created_at > seen);
  return jsonb_build_object(
    'mine', jsonb_build_object('wins', coalesce(s.wins, 0), 'losses', coalesce(s.losses, 0), 'draws', coalesce(s.draws, 0)),
    'def', jsonb_build_object('wins', coalesce(s.def_wins, 0), 'losses', coalesce(s.def_losses, 0), 'draws', coalesce(s.def_draws, 0)),
    'recent', v_recent,
    'unseen', v_unseen);
end;
$$;

-- 배틀 상세 — 내가 건 판이나 받은 판 하나. 요약의 양쪽은 내 쪽을 앞에 둔다. 남의 판·친선 판·없는 판은 null
create function public.battle_detail(p_battle uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  b cloud_private.battles;
  mine boolean;
  v_sides jsonb;
begin
  if me is null then raise exception 'CLOUD_LOGIN_REQUIRED'; end if;
  select * into b from cloud_private.battles x where x.id = p_battle and x.kind = 'random' and (x.user_id = me or x.opponent_id = me);
  if not found then return null; end if;
  mine := b.user_id = me;
  v_sides := case when b.summary is null then null
                  when mine then b.summary -> 'sides'
                  else jsonb_build_array(b.summary -> 'sides' -> 1, b.summary -> 'sides' -> 0) end;
  return jsonb_build_object(
    'id', b.id, 'at', b.created_at, 'mine', mine,
    'result', case when b.winner is null then 'draw' when (b.winner = 0) = mine then 'win' else 'lose' end,
    'reward', case when mine then b.reward else null end,
    'endMs', b.end_ms,
    'name', cloud_private.display_name_of(case when mine then b.opponent_id else b.user_id end),
    'sides', v_sides);
end;
$$;
revoke all on function public.battle_detail(uuid) from public, anon;
grant execute on function public.battle_detail(uuid) to authenticated;
