-- 배틀 기록 보이기 — 앱이 자기 승무패·최근 판·받은 판 알림 값을 읽는다
-- 규칙: docs/specs/adventure.md "배틀 기록" 의 "앱에서 보이기"(2026-10-10 사용자 확정 "이렇게 진행"), Figma 05 `15 모험` `Adventure / Battle Record` 1870:13392
--   앱은 로그인한 계정(익명 포함)의 값만 읽는다. 상대 계정 id 는 주지 않는다

-- 고침: 승무패 더하기의 무승부 — winner 가 null 이면 (null = 0) 이 null 이라 승·패 칸에 null 을 넣으려다 판 기록(battle_record)이 통째로 실패했다
--   (20261010100000_battle_archive.sql battle_tally, 2026-10-10 실기에서 찾음). is not distinct from 으로 늘 참·거짓을 낸다
create or replace function cloud_private.battle_tally(p_user uuid, p_opponent uuid, p_winner smallint)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  w int := (p_winner is not distinct from 0::smallint)::int; -- 건 쪽 승
  l int := (p_winner is not distinct from 1::smallint)::int; -- 건 쪽 패
  d int := (p_winner is null)::int;
begin
  insert into cloud_private.battle_stats (user_id, wins, losses, draws)
    values (p_user, w, l, d)
    on conflict (user_id) do update set
      wins = cloud_private.battle_stats.wins + excluded.wins,
      losses = cloud_private.battle_stats.losses + excluded.losses,
      draws = cloud_private.battle_stats.draws + excluded.draws,
      updated_at = now();
  if p_opponent is not null and exists (select 1 from auth.users u where u.id = p_opponent) then
    insert into cloud_private.battle_stats (user_id, def_wins, def_losses, def_draws)
      values (p_opponent, l, w, d)
      on conflict (user_id) do update set
        def_wins = cloud_private.battle_stats.def_wins + excluded.def_wins,
        def_losses = cloud_private.battle_stats.def_losses + excluded.def_losses,
        def_draws = cloud_private.battle_stats.def_draws + excluded.def_draws,
        updated_at = now();
  end if;
end;
$$;

-- 받은 판 알림을 어디까지 보였는가 — 이 시각 뒤의 받은 판만 배너로 센다
alter table cloud_private.battle_stats add column def_seen_at timestamptz;
create index battles_opponent on cloud_private.battles (opponent_id, created_at desc);

-- 내 배틀 기록 — 승무패 둘, 최근 8판(건 판과 받은 판, 내 쪽에서 본 결과), 지난 알림 뒤 받은 판의 승패 수
create function public.battle_record_view()
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
      select x.at, jsonb_build_object('at', x.at, 'mine', x.mine, 'result', x.result, 'reward', x.reward, 'endMs', x.end_ms) as j
        from (
          (select b.created_at as at, true as mine,
                  case when b.winner = 0 then 'win' when b.winner = 1 then 'lose' else 'draw' end as result, b.reward, b.end_ms
             from cloud_private.battles b where b.user_id = me order by b.created_at desc limit 8)
          union all
          (select b.created_at, false,
                  case when b.winner = 1 then 'win' when b.winner = 0 then 'lose' else 'draw' end, null::int, b.end_ms
             from cloud_private.battles b where b.opponent_id = me order by b.created_at desc limit 8)
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
    where b.opponent_id = me and (seen is null or b.created_at > seen);
  return jsonb_build_object(
    'mine', jsonb_build_object('wins', coalesce(s.wins, 0), 'losses', coalesce(s.losses, 0), 'draws', coalesce(s.draws, 0)),
    'def', jsonb_build_object('wins', coalesce(s.def_wins, 0), 'losses', coalesce(s.def_losses, 0), 'draws', coalesce(s.def_draws, 0)),
    'recent', v_recent,
    'unseen', v_unseen);
end;
$$;

-- 받은 판 알림을 보였다 — 보인 값의 마지막 판 시각까지. 늦게 온 요청이 앞으로 당기지 않게 큰 쪽만 남긴다
create function public.battle_record_seen(p_until timestamptz)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'CLOUD_LOGIN_REQUIRED'; end if;
  if p_until is null then return; end if;
  insert into cloud_private.battle_stats (user_id, def_seen_at) values (me, p_until)
    on conflict (user_id) do update set def_seen_at = greatest(coalesce(cloud_private.battle_stats.def_seen_at, p_until), p_until);
end;
$$;

revoke all on function public.battle_record_view(), public.battle_record_seen(timestamptz) from public, anon;
grant execute on function public.battle_record_view(), public.battle_record_seen(timestamptz) to authenticated;
