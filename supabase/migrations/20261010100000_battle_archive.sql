-- 배틀 기록 보관 — 계정별 승무패는 서버에 계속 남기고, 판의 무거운 내용(이벤트·양쪽 파티)은 관리자가 로컬로 받은 뒤 정리한다
-- 규칙: docs/specs/adventure.md "배틀 기록". 2026-10-09 사용자 "계정마다 승무패는 기록하게 하고, 배틀데이터는 서버에 저장했다가 이 로컬pc로 마이그레이션 할게"
--   정리한 판도 장부 줄(id·계정·상대·승패·보상·시각)은 남는다 — 쿨타임·그날 첫 배틀(battle_context·battle_record)과 저장 검증(save_verify_context)이 이 줄을 읽는다
--   받기·정리는 관리자 CLI(admin/admin.cjs battle migrate)만 한다

-- 계정별 승무패 — 건 판(내가 상대를 고른 판)과 받은 판(남이 내 배틀 파티를 고른 판)을 나눈다
create table cloud_private.battle_stats (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  wins       int not null default 0,
  losses     int not null default 0,
  draws      int not null default 0,
  def_wins   int not null default 0,
  def_losses int not null default 0,
  def_draws  int not null default 0,
  updated_at timestamptz not null default now()
);
alter table cloud_private.battle_stats enable row level security;
revoke all on table cloud_private.battle_stats from public, anon, authenticated;

-- 정리한 판 — 양쪽 파티를 비우고 정리 시각을 적는다. 이벤트 목록(battle_events)은 지운다
alter table cloud_private.battles alter column sides drop not null;
alter table cloud_private.battles add column archived_at timestamptz;
create index battles_unarchived on cloud_private.battles (created_at) where archived_at is null;

-- 판 하나를 승무패에 더한다 — 건 쪽은 winner 0 이 승, 받은 쪽은 winner 1 이 승. 상대 계정이 지워졌으면 건 쪽만
create function cloud_private.battle_tally(p_user uuid, p_opponent uuid, p_winner smallint)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into cloud_private.battle_stats (user_id, wins, losses, draws)
    values (p_user, (p_winner = 0)::int, (p_winner = 1)::int, (p_winner is null)::int)
    on conflict (user_id) do update set
      wins = cloud_private.battle_stats.wins + excluded.wins,
      losses = cloud_private.battle_stats.losses + excluded.losses,
      draws = cloud_private.battle_stats.draws + excluded.draws,
      updated_at = now();
  if p_opponent is not null and exists (select 1 from auth.users u where u.id = p_opponent) then
    insert into cloud_private.battle_stats (user_id, def_wins, def_losses, def_draws)
      values (p_opponent, (p_winner = 1)::int, (p_winner = 0)::int, (p_winner is null)::int)
      on conflict (user_id) do update set
        def_wins = cloud_private.battle_stats.def_wins + excluded.def_wins,
        def_losses = cloud_private.battle_stats.def_losses + excluded.def_losses,
        def_draws = cloud_private.battle_stats.def_draws + excluded.def_draws,
        updated_at = now();
  end if;
end;
$$;
revoke all on function cloud_private.battle_tally(uuid, uuid, smallint) from public, anon, authenticated;

-- 처음 값 — 이미 있는 판으로 채운다
insert into cloud_private.battle_stats (user_id, wins, losses, draws)
  select b.user_id, count(*) filter (where b.winner = 0), count(*) filter (where b.winner = 1), count(*) filter (where b.winner is null)
    from cloud_private.battles b group by b.user_id;
insert into cloud_private.battle_stats (user_id, def_wins, def_losses, def_draws)
  select b.opponent_id, count(*) filter (where b.winner = 1), count(*) filter (where b.winner = 0), count(*) filter (where b.winner is null)
    from cloud_private.battles b
    where b.opponent_id is not null and exists (select 1 from auth.users u where u.id = b.opponent_id)
    group by b.opponent_id
  on conflict (user_id) do update set
    def_wins = excluded.def_wins, def_losses = excluded.def_losses, def_draws = excluded.def_draws;

-- 판 기록 — 20261009100000_battle.sql 과 같고, 끝에 승무패를 더한다
create or replace function public.battle_record(p_user uuid, p_offer uuid, p_pick int, p_opponent uuid, p_seed bigint, p_winner smallint,
                                                p_timeout boolean, p_end_ms int, p_data_hash text, p_sides jsonb, p_events jsonb)
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
  select max(b.created_at) into last_at from cloud_private.battles b where b.user_id = p_user;
  if last_at is not null and now() < last_at + make_interval(secs => cool) then raise exception 'BATTLE_COOLDOWN'; end if;
  if public.battle_offer_get(p_user, p_offer, p_pick) is null then raise exception 'BATTLE_OFFER_GONE'; end if;
  if not exists (select 1 from cloud_private.battles b where b.user_id = p_user and b.kst_day = day) then v_reward := 500;
  elsif p_winner = 0 then v_reward := 50;
  else v_reward := 10;
  end if;
  insert into cloud_private.battles (user_id, opponent_id, kst_day, seed, winner, timeout, end_ms, reward, data_hash, sides)
    values (p_user, p_opponent, day, p_seed, p_winner, p_timeout, p_end_ms, v_reward, p_data_hash, p_sides)
    returning id into v_id;
  insert into cloud_private.battle_events (battle_id, events) values (v_id, p_events);
  delete from cloud_private.battle_offers where user_id = p_user;
  perform cloud_private.battle_tally(p_user, p_opponent, p_winner);
  return jsonb_build_object('battle_id', v_id, 'reward', v_reward);
end;
$$;

-- 관리자: 승무패 목록 — 판 수가 많은 계정부터
create function public.admin_battle_stats(p_limit int default 50)
returns table (user_id uuid, wins int, losses int, draws int, def_wins int, def_losses int, def_draws int, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.user_id, s.wins, s.losses, s.draws, s.def_wins, s.def_losses, s.def_draws, s.updated_at
    from cloud_private.battle_stats s
    order by (s.wins + s.losses + s.draws + s.def_wins + s.def_losses + s.def_draws) desc, s.updated_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 1000);
$$;

-- 관리자: 아직 받지 않은 판 수와 기간, 정리한 판 수
create function public.admin_battle_archive_info()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pending', count(*) filter (where b.archived_at is null),
    'archived', count(*) filter (where b.archived_at is not null),
    'oldest', min(b.created_at) filter (where b.archived_at is null),
    'newest', max(b.created_at) filter (where b.archived_at is null))
  from cloud_private.battles b;
$$;

-- 관리자: 아직 받지 않은 판을 오래된 것부터 p_limit 개 — 판 머리와 이벤트 목록을 함께
create function public.admin_battle_archive_take(p_limit int default 200)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.row order by x.created_at, x.id), '[]'::jsonb)
    from (
      select b.created_at, b.id, jsonb_build_object(
        'id', b.id, 'user_id', b.user_id, 'opponent_id', b.opponent_id, 'kst_day', b.kst_day, 'seed', b.seed,
        'winner', b.winner, 'timeout', b.timeout, 'end_ms', b.end_ms, 'reward', b.reward, 'data_hash', b.data_hash,
        'sides', b.sides, 'created_at', b.created_at, 'events', e.events) as row
      from cloud_private.battles b
      left join cloud_private.battle_events e on e.battle_id = b.id
      where b.archived_at is null
      order by b.created_at, b.id
      limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    ) x;
$$;

-- 관리자: 받은 판을 정리한다 — 양쪽 파티를 비우고 이벤트 목록을 지운다. 장부 줄은 남는다. 정리한 판 수를 돌려준다
create function public.admin_battle_archive_done(p_ids uuid[])
returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  update cloud_private.battles b set sides = null, archived_at = now()
    where b.id = any(p_ids) and b.archived_at is null;
  get diagnostics n = row_count;
  delete from cloud_private.battle_events e where e.battle_id = any(p_ids);
  return n;
end;
$$;

revoke all on function public.admin_battle_stats(int), public.admin_battle_archive_info(),
  public.admin_battle_archive_take(int), public.admin_battle_archive_done(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_battle_stats(int), public.admin_battle_archive_info(),
  public.admin_battle_archive_take(int), public.admin_battle_archive_done(uuid[]) to service_role;
