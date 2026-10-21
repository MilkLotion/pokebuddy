-- 바로 랜덤 배틀과 샘플 파티 (2026-10-22 사용자 "모험-배틀에서 이제 상대방 고르지 않고 랜덤으로 할거야", "배틀용 파티 상/중/하 로 해서 배틀데이터 수집용")
-- 규칙은 docs/specs/adventure.md "상대 고르기"·"샘플 파티"·"서버"
--   battle_random_pick   실제 후보 하나 — 자기·6칸 미만·(일반 계정에게) 시험 계정을 뺀다. 직전 상대는 다른 후보가 있으면 뺀다
--                        샘플을 섞는 확률(설정 battle_sample_rate)과 직전 판의 샘플 id 를 함께 준다. 샘플 고르기는 battle-start 함수가 한다
--   battles.opponent_sample  샘플 판의 샘플 id(`hard-03` 등). 샘플 판은 opponent_id 가 null 이다
--   battle_record        p_offer 가 null 이면 바로 랜덤 판이다 — offer 대조를 건너뛴다(서비스 롤만 부르고, 상대는 함수가 골랐다). 끝 인자 p_sample
--   battle_record_view·battle_detail  상대 이름 — 계정 표시 이름이 없으면 판 요약의 foe.name(샘플 이름)
--   admin_battle_archive_take  관리자 받기에 opponent_sample 을 싣는다
-- 상대 고르기(battle-offer·battle_offer_make·battle_offers)는 지우지 않는다. 앱은 쓰지 않게 된다(사용자 "일단 안쓸예정")

alter table cloud_private.battles add column opponent_sample text;

-- 실제 후보가 있으면 샘플 50%(2026-10-22 사용자 결정 "권장대로 다 진행해"). 0~1. 실제 후보가 없으면 늘 샘플이다
insert into cloud_private.settings (key, value) values ('battle_sample_rate', '0.5')
  on conflict (key) do nothing;

create function public.battle_random_pick(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tests uuid[] := string_to_array(cloud_private.setting('battle_test_users', ''), ',')::uuid[];
  v_rate numeric := coalesce(nullif(cloud_private.setting('battle_sample_rate', '0.5'), '')::numeric, 0.5);
  v_last_user uuid;
  v_last_sample text;
  v_pick jsonb;
begin
  select b.opponent_id, b.opponent_sample into v_last_user, v_last_sample
    from cloud_private.battles b where b.user_id = p_user and b.kind = 'random' order by b.created_at desc limit 1;
  -- 직전 상대를 맨 뒤로 — 다른 후보가 없을 때만 다시 나온다
  select jsonb_build_object('user_id', x.user_id, 'party', x.party, 'name', cloud_private.display_name_of(x.user_id)) into v_pick
    from cloud_private.battle_entries x
   where x.user_id <> p_user
     and (p_user = any(v_tests) or not (x.user_id = any(v_tests)))
     and (select count(*) from jsonb_array_elements(x.party) s where jsonb_typeof(s) = 'object') = 6
   order by (x.user_id is not distinct from v_last_user), random()
   limit 1;
  return jsonb_build_object('pick', v_pick, 'rate', greatest(0, least(1, v_rate)), 'last_sample', v_last_sample);
end;
$$;
revoke all on function public.battle_random_pick(uuid) from public, anon, authenticated;
grant execute on function public.battle_random_pick(uuid) to service_role;

-- 판 기록 — 20261012100000_battle_history.sql 과 같고, p_offer null(바로 랜덤)과 끝 인자 p_sample 을 받는다
drop function public.battle_record(uuid, uuid, int, uuid, bigint, smallint, boolean, int, text, jsonb, jsonb, jsonb);
create function public.battle_record(p_user uuid, p_offer uuid, p_pick int, p_opponent uuid, p_seed bigint, p_winner smallint,
                                     p_timeout boolean, p_end_ms int, p_data_hash text, p_sides jsonb, p_events jsonb,
                                     p_summary jsonb default null, p_sample text default null)
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
  if p_offer is not null and public.battle_offer_get(p_user, p_offer, p_pick) is null then raise exception 'BATTLE_OFFER_GONE'; end if;
  -- 보상은 샘플 판도 같다(2026-10-22 사용자 결정)
  if not exists (select 1 from cloud_private.battles b where b.user_id = p_user and b.kst_day = day and b.kind = 'random') then v_reward := 500;
  elsif p_winner = 0 then v_reward := 50;
  else v_reward := 10;
  end if;
  insert into cloud_private.battles (user_id, opponent_id, opponent_sample, kst_day, seed, winner, timeout, end_ms, reward, data_hash, sides, summary)
    values (p_user, p_opponent, p_sample, day, p_seed, p_winner, p_timeout, p_end_ms, v_reward, p_data_hash, p_sides, p_summary)
    returning id into v_id;
  insert into cloud_private.battle_events (battle_id, events) values (v_id, p_events);
  delete from cloud_private.battle_offers where user_id = p_user;
  perform cloud_private.battle_tally(p_user, p_opponent, p_winner); -- 샘플 판은 p_opponent 가 null 이라 받은 판을 올리지 않는다
  return jsonb_build_object('battle_id', v_id, 'reward', v_reward);
end;
$$;
revoke all on function public.battle_record(uuid, uuid, int, uuid, bigint, smallint, boolean, int, text, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.battle_record(uuid, uuid, int, uuid, bigint, smallint, boolean, int, text, jsonb, jsonb, jsonb, text) to service_role;

-- 내 배틀 기록 — 20261012100000_battle_history.sql 과 같고, 건 판의 상대 이름이 없으면 판 요약의 foe.name(샘플 이름)을 쓴다
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
                                      'name', coalesce(cloud_private.display_name_of(x.other), x.foe_name), 'detail', x.detail) as j
        from (
          (select b.id, b.created_at as at, true as mine, b.opponent_id as other, b.summary -> 'foe' ->> 'name' as foe_name,
                  case when b.winner = 0 then 'win' when b.winner = 1 then 'lose' else 'draw' end as result, b.reward, b.end_ms,
                  b.summary is not null as detail
             from cloud_private.battles b where b.user_id = me and b.kind = 'random' order by b.created_at desc limit 8)
          union all
          (select b.id, b.created_at, false, b.user_id, null::text,
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

-- 배틀 상세 — 20261012100000_battle_history.sql 과 같고, 상대 이름이 없으면 판 요약의 foe.name(샘플 이름)을 쓴다
create or replace function public.battle_detail(p_battle uuid)
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
    'name', coalesce(cloud_private.display_name_of(case when mine then b.opponent_id else b.user_id end),
                     case when mine then b.summary -> 'foe' ->> 'name' end),
    'sides', v_sides);
end;
$$;

-- 관리자 받기 — 샘플 id 도 싣는다 (20261010120000_friendly_battle.sql 과 같고 opponent_sample 만 더한다)
-- 받은 뒤 샘플별 승률은 opponent_sample 로 묶어 본다
create or replace function public.admin_battle_archive_take(p_limit int default 200)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.row order by x.created_at, x.id), '[]'::jsonb)
    from (
      select b.created_at, b.id, jsonb_build_object(
        'id', b.id, 'kind', b.kind, 'user_id', b.user_id, 'opponent_id', b.opponent_id, 'opponent_sample', b.opponent_sample,
        'kst_day', b.kst_day, 'seed', b.seed,
        'winner', b.winner, 'timeout', b.timeout, 'end_ms', b.end_ms, 'reward', b.reward, 'data_hash', b.data_hash,
        'sides', b.sides, 'created_at', b.created_at, 'events', e.events) as row
      from cloud_private.battles b
      left join cloud_private.battle_events e on e.battle_id = b.id
      where b.archived_at is null
      order by b.created_at, b.id
      limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    ) x;
$$;
