-- 친선 배틀 — 교환처럼 링크로 친구를 불러 한 판 싸운다
-- 규칙: docs/specs/adventure.md "친선 배틀". 2026-10-10 사용자 결정: 로그인한 계정만, 보상·쿨타임 없음, 결과는 내 전적에 넣지 않음
-- 채널 모양과 링크·만료·남용 막기는 친구 교환(20260927100000_trade.sql)을 본뜬다
--   앱은 Edge Function friendly-battle 만 부른다. 그 함수가 서비스 롤로 아래 함수를 부른다(배틀 데이터로 미리보기·판정을 만들어야 해서)
--   실시간 신호는 내용 없이 'friendly:<채널 id>' 로 보낸다. 앱은 신호를 받으면 다시 읽는다
--   판은 cloud_private.battles 에 kind 'friendly' 로 남긴다 — 밸런스용 기록에는 들고, 쿨타임·그날 첫 배틀·내 전적·받은 판 알림에서는 뺀다
-- 실패는 raise exception 의 메시지에 오류 코드를 넣는다

create schema if not exists friendly_private;
revoke all on schema friendly_private from public, anon, authenticated;

create table public.friendly_channels (
  id            uuid primary key default gen_random_uuid(),
  token_hash    bytea not null unique,                              -- 토큰의 SHA-256. 원문은 저장하지 않는다
  host          uuid references auth.users(id) on delete cascade,
  guest         uuid references auth.users(id) on delete cascade,
  status        text not null default 'open' check (status in ('open', 'joined', 'closed')),
  closed_reason text,                                               -- host_left · guest_left · expired
  protocol      int not null,
  host_ready    boolean not null default false,
  guest_ready   boolean not null default false,
  running_at    timestamptz,                                        -- 판정 중 — 둘 다 준비한 요청 하나만 판을 돌린다
  round         int not null default 0,                             -- 끝난 판 수
  battle        jsonb,                                              -- 마지막 판: { round, seed, winner, timeout, endMs, hp, maxHp, events, sides, looks, startAt }
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  joined_at     timestamptz,
  check (guest is null or host is null or guest <> host)
);
create index friendly_channels_host on public.friendly_channels (host, status);
create index friendly_channels_guest on public.friendly_channels (guest, status);
alter table public.friendly_channels enable row level security;
revoke all on public.friendly_channels from anon, authenticated;

-- 판 종류 — 랜덤 배틀만 쿨타임·보상·전적에 든다
alter table cloud_private.battles add column kind text not null default 'random' check (kind in ('random', 'friendly'));

-- ── 규칙 값 ────────────────────────────────────────────────────────────────────
-- 교환과 같다: 참가 전 10분, 참가 뒤 30분(판이 끝날 때마다 다시 30분), 1시간 20개
create function friendly_private.rule(name text) returns int
language sql immutable set search_path = '' as $$
  select case name
    when 'protocol_min' then 1
    when 'protocol_max' then 1
    when 'open_minutes' then 10
    when 'joined_minutes' then 30
    when 'create_per_hour' then 20
    when 'start_delay_ms' then 3000   -- 판정 뒤 두 앱이 함께 재생을 시작할 때까지
    when 'running_ms' then 30000      -- 판정이 멈췄다고 보는 시간 — 지나면 다른 준비 요청이 다시 돌린다
  end;
$$;

create function friendly_private.hash(token text) returns bytea
language sql immutable set search_path = '' as $$
  select extensions.digest(convert_to(token, 'UTF8'), 'sha256');
$$;

create function friendly_private.new_token() returns text
language sql volatile set search_path = '' as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_');
$$;

-- 로그인한 정식 계정. 익명 계정은 친선 배틀을 하지 못한다(2026-10-10 사용자 결정 "로그인한 계정만")
create function friendly_private.require_member(me uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  anon boolean;
begin
  select coalesce(u.is_anonymous, false) into anon from auth.users u where u.id = me;
  if not found then raise exception 'CLOUD_LOGIN_REQUIRED'; end if;
  if anon then raise exception 'FRIENDLY_LOGIN_REQUIRED'; end if;
  if cloud_private.is_held(me) then raise exception 'CLOUD_ACCOUNT_HELD'; end if;
end;
$$;

create function friendly_private.notify(ch public.friendly_channels) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('status', ch.status, 'round', ch.round), 'changed', 'friendly:' || ch.id::text, true);
end;
$$;

-- 시간이 지났으면 닫는다. 닫았으면 true
create function friendly_private.expire_if_due(ch public.friendly_channels) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  after_row public.friendly_channels;
begin
  if ch.status = 'closed' or ch.expires_at > now() then return false; end if;
  update public.friendly_channels set status = 'closed', closed_reason = 'expired' where id = ch.id returning * into after_row;
  perform friendly_private.notify(after_row);
  return true;
end;
$$;

-- 내 열린 채널을 모두 닫는다(새로 만들거나 참가할 때). except_id 는 남긴다
create function friendly_private.close_mine(me uuid, except_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  ch public.friendly_channels;
begin
  for ch in
    update public.friendly_channels c
      set status = 'closed', closed_reason = case when c.host = me then 'host_left' else 'guest_left' end
      where me in (c.host, c.guest) and c.status <> 'closed' and (except_id is null or c.id <> except_id)
      returning *
  loop
    perform friendly_private.notify(ch);
  end loop;
end;
$$;

create function friendly_private.lock_mine(p_channel uuid, me uuid) returns public.friendly_channels
language plpgsql security definer set search_path = '' as $$
declare
  ch public.friendly_channels;
begin
  select * into ch from public.friendly_channels c where c.id = p_channel for update;
  if not found or me is distinct from ch.host and me is distinct from ch.guest then raise exception 'FRIENDLY_NOT_FOUND'; end if;
  return ch;
end;
$$;

-- 앱에 주는 채널 모양 — 상대 계정 id 는 Edge Function 만 쓰고 앱에는 주지 않는다(friendly-battle 이 뺀다)
create function friendly_private.view(ch public.friendly_channels, me uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', ch.id,
    'role', case when me = ch.host then 'host' else 'guest' end,
    'status', ch.status,
    'closedReason', ch.closed_reason,
    'friendJoined', ch.guest is not null,
    'friendId', case when me = ch.host then ch.guest else ch.host end,
    'friendName', (select nullif(left(btrim(regexp_replace(u.raw_user_meta_data ->> 'display_name', '[[:cntrl:]]', '', 'g')), 12), '')
                     from auth.users u where u.id = case when me = ch.host then ch.guest else ch.host end),
    'myReady', case when me = ch.host then ch.host_ready else ch.guest_ready end,
    'friendReady', case when me = ch.host then ch.guest_ready else ch.host_ready end,
    'running', ch.running_at is not null,
    'round', ch.round,
    'battle', ch.battle,
    'expiresAt', ch.expires_at,
    'serverNow', now());
$$;

-- ── 서비스 롤 함수 (Edge Function friendly-battle 이 부른다) ─────────────────────

-- 채널을 만든다. 토큰 원문은 여기서 한 번만 돌려준다
create function public.friendly_create(p_user uuid, p_protocol int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := friendly_private.new_token();
  ch public.friendly_channels;
begin
  perform friendly_private.require_member(p_user);
  if p_protocol is null or p_protocol < friendly_private.rule('protocol_min') or p_protocol > friendly_private.rule('protocol_max') then
    raise exception 'FRIENDLY_VERSION_MISMATCH';
  end if;
  if (select count(*) from public.friendly_channels c where c.host = p_user and c.created_at > now() - interval '1 hour')
     >= friendly_private.rule('create_per_hour') then
    raise exception 'FRIENDLY_RATE_LIMITED';
  end if;
  perform friendly_private.close_mine(p_user, null);
  insert into public.friendly_channels (token_hash, host, protocol, expires_at)
    values (friendly_private.hash(v_token), p_user, p_protocol, now() + make_interval(mins => friendly_private.rule('open_minutes')))
    returning * into ch;
  return friendly_private.view(ch, p_user) || jsonb_build_object('token', v_token);
end;
$$;

-- 링크로 참가한다
create function public.friendly_join(p_user uuid, p_token text, p_protocol int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ch public.friendly_channels;
begin
  perform friendly_private.require_member(p_user);
  select * into ch from public.friendly_channels c where c.token_hash = friendly_private.hash(coalesce(p_token, '')) for update;
  if not found then raise exception 'FRIENDLY_LINK_INVALID'; end if;
  if ch.host = p_user then raise exception 'FRIENDLY_OWN_LINK'; end if;
  if ch.status = 'joined' then raise exception 'FRIENDLY_LINK_USED'; end if;
  if ch.status = 'closed' or ch.expires_at <= now() then raise exception 'FRIENDLY_LINK_EXPIRED'; end if;
  if p_protocol is distinct from ch.protocol then raise exception 'FRIENDLY_VERSION_MISMATCH'; end if;
  perform friendly_private.close_mine(p_user, ch.id);
  update public.friendly_channels c
    set guest = p_user, status = 'joined', joined_at = now(),
        expires_at = now() + make_interval(mins => friendly_private.rule('joined_minutes'))
    where c.id = ch.id
    returning * into ch;
  perform friendly_private.notify(ch);
  return friendly_private.view(ch, p_user);
end;
$$;

-- 채널 보기 — 시간이 지났으면 닫고 본다
create function public.friendly_get(p_user uuid, p_channel uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ch public.friendly_channels := friendly_private.lock_mine(p_channel, p_user);
begin
  if friendly_private.expire_if_due(ch) then
    select * into ch from public.friendly_channels c where c.id = p_channel;
  end if;
  return friendly_private.view(ch, p_user);
end;
$$;

-- 내 열린 채널 — 앱을 다시 켰을 때 이어 붙는다. 없으면 null
create function public.friendly_mine(p_user uuid)
returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.friendly_channels c
    where p_user in (c.host, c.guest) and c.status <> 'closed' and c.expires_at > now()
    order by c.created_at desc limit 1;
$$;

-- 준비·준비 취소. 둘 다 준비했고 판정 중이 아니면 이 요청이 판을 맡는다(go). 판정이 멈춘 채 오래되면 다시 맡는다
create function public.friendly_ready(p_user uuid, p_channel uuid, p_ready boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ch public.friendly_channels := friendly_private.lock_mine(p_channel, p_user);
  go boolean := false;
begin
  if friendly_private.expire_if_due(ch) then raise exception 'FRIENDLY_CLOSED' using detail = 'expired'; end if;
  if ch.status <> 'joined' then raise exception 'FRIENDLY_CLOSED' using detail = coalesce(ch.closed_reason, ch.status); end if;
  if ch.running_at is not null and ch.running_at > now() - make_interval(secs => friendly_private.rule('running_ms') / 1000) then
    raise exception 'FRIENDLY_RUNNING';
  end if;
  update public.friendly_channels c
    set host_ready = case when p_user = c.host then p_ready else c.host_ready end,
        guest_ready = case when p_user = c.guest then p_ready else c.guest_ready end
    where c.id = ch.id
    returning * into ch;
  if ch.host_ready and ch.guest_ready then
    update public.friendly_channels c set running_at = now() where c.id = ch.id returning * into ch;
    go := true;
  end if;
  perform friendly_private.notify(ch);
  return jsonb_build_object('go', go, 'round', ch.round, 'host', ch.host, 'guest', ch.guest, 'view', friendly_private.view(ch, p_user));
end;
$$;

-- 판정을 못 했다 — 준비를 푼다(파티가 비었거나 출전 불가). who 는 문제가 된 쪽
create function public.friendly_abort(p_channel uuid, p_round int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  ch public.friendly_channels;
begin
  update public.friendly_channels c set running_at = null, host_ready = false, guest_ready = false
    where c.id = p_channel and c.round = p_round
    returning * into ch;
  if found then perform friendly_private.notify(ch); end if;
end;
$$;

-- 판을 남긴다 — 채널에 마지막 판을 적고(준비는 풀린다), 밸런스용 판 기록에 kind 'friendly' 로 넣는다. 보상은 0
create function public.friendly_record(p_channel uuid, p_round int, p_battle jsonb, p_seed bigint, p_winner smallint,
                                       p_timeout boolean, p_end_ms int, p_data_hash text, p_sides jsonb, p_events jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ch public.friendly_channels;
  v_id uuid;
  v_battle jsonb;
begin
  select * into ch from public.friendly_channels c where c.id = p_channel for update;
  if not found or ch.round <> p_round or ch.running_at is null then raise exception 'FRIENDLY_RUNNING'; end if;
  insert into cloud_private.battles (user_id, opponent_id, kst_day, seed, winner, timeout, end_ms, reward, data_hash, sides, kind)
    values (ch.host, ch.guest, (now() at time zone 'Asia/Seoul')::date, p_seed, p_winner, p_timeout, p_end_ms, 0, p_data_hash, p_sides, 'friendly')
    returning id into v_id;
  insert into cloud_private.battle_events (battle_id, events) values (v_id, p_events);
  v_battle := p_battle || jsonb_build_object('round', p_round + 1,
    'startAt', now() + make_interval(secs => friendly_private.rule('start_delay_ms')::double precision / 1000));
  update public.friendly_channels c
    set battle = v_battle, round = p_round + 1, running_at = null, host_ready = false, guest_ready = false,
        expires_at = greatest(c.expires_at, now() + make_interval(mins => friendly_private.rule('joined_minutes')))
    where c.id = ch.id
    returning * into ch;
  perform friendly_private.notify(ch);
  return v_battle;
end;
$$;

-- 나가기 — 채널을 닫는다
create function public.friendly_leave(p_user uuid, p_channel uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ch public.friendly_channels := friendly_private.lock_mine(p_channel, p_user);
begin
  if ch.status <> 'closed' then
    update public.friendly_channels c
      set status = 'closed', closed_reason = case when p_user = c.host then 'host_left' else 'guest_left' end, running_at = null
      where c.id = ch.id
      returning * into ch;
    perform friendly_private.notify(ch);
  end if;
  return friendly_private.view(ch, p_user);
end;
$$;

-- ── 랜덤 배틀 함수에서 친선 판 빼기 ─────────────────────────────────────────────
-- 쿨타임 — 랜덤 배틀 판만 본다 (20261009100000_battle.sql 과 같고 kind 조건만 더한다)
create or replace function public.battle_context(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  last_at timestamptz;
  cool int := cloud_private.setting('battle_cooldown_sec', '300')::int;
begin
  select max(b.created_at) into last_at from cloud_private.battles b where b.user_id = p_user and b.kind = 'random';
  return jsonb_build_object(
    'held', cloud_private.is_held(p_user),
    'save', (select c.save from public.cloud_saves c where c.user_id = p_user),
    'cooldown_ms', case when last_at is null then 0
                        else greatest(0, floor(extract(epoch from (last_at + make_interval(secs => cool) - now())) * 1000)) end);
end;
$$;

-- 판 기록 — 쿨타임·그날 첫 배틀은 랜덤 배틀 판만 본다 (20261010100000_battle_archive.sql 과 같고 kind 조건만 더한다)
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
  select max(b.created_at) into last_at from cloud_private.battles b where b.user_id = p_user and b.kind = 'random';
  if last_at is not null and now() < last_at + make_interval(secs => cool) then raise exception 'BATTLE_COOLDOWN'; end if;
  if public.battle_offer_get(p_user, p_offer, p_pick) is null then raise exception 'BATTLE_OFFER_GONE'; end if;
  if not exists (select 1 from cloud_private.battles b where b.user_id = p_user and b.kst_day = day and b.kind = 'random') then v_reward := 500;
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

-- 내 배틀 기록 — 랜덤 배틀 판만 (20261010110000_battle_record_view.sql 과 같고 kind 조건만 더한다, 2026-10-10 사용자 결정 "넣지 않는다")
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
      select x.at, jsonb_build_object('at', x.at, 'mine', x.mine, 'result', x.result, 'reward', x.reward, 'endMs', x.end_ms) as j
        from (
          (select b.created_at as at, true as mine,
                  case when b.winner = 0 then 'win' when b.winner = 1 then 'lose' else 'draw' end as result, b.reward, b.end_ms
             from cloud_private.battles b where b.user_id = me and b.kind = 'random' order by b.created_at desc limit 8)
          union all
          (select b.created_at, false,
                  case when b.winner = 1 then 'win' when b.winner = 0 then 'lose' else 'draw' end, null::int, b.end_ms
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

-- 관리자 받기 — 판 종류도 싣는다 (20261010100000_battle_archive.sql 과 같고 kind 만 더한다)
create or replace function public.admin_battle_archive_take(p_limit int default 200)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.row order by x.created_at, x.id), '[]'::jsonb)
    from (
      select b.created_at, b.id, jsonb_build_object(
        'id', b.id, 'kind', b.kind, 'user_id', b.user_id, 'opponent_id', b.opponent_id, 'kst_day', b.kst_day, 'seed', b.seed,
        'winner', b.winner, 'timeout', b.timeout, 'end_ms', b.end_ms, 'reward', b.reward, 'data_hash', b.data_hash,
        'sides', b.sides, 'created_at', b.created_at, 'events', e.events) as row
      from cloud_private.battles b
      left join cloud_private.battle_events e on e.battle_id = b.id
      where b.archived_at is null
      order by b.created_at, b.id
      limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    ) x;
$$;

-- ── 실시간 권한 ────────────────────────────────────────────────────────────────
create function public.is_friendly_participant(topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendly_channels c
    where topic = 'friendly:' || c.id::text and (select auth.uid()) in (c.host, c.guest)
  );
$$;
create policy "friendly participants receive"
on realtime.messages for select to authenticated
using (realtime.messages.extension = 'broadcast' and public.is_friendly_participant((select realtime.topic())));

-- ── 실행 권한 ──────────────────────────────────────────────────────────────────
revoke execute on all functions in schema friendly_private from public, anon, authenticated;
revoke execute on function
  public.friendly_create(uuid, int), public.friendly_join(uuid, text, int), public.friendly_get(uuid, uuid), public.friendly_mine(uuid),
  public.friendly_ready(uuid, uuid, boolean), public.friendly_abort(uuid, int),
  public.friendly_record(uuid, int, jsonb, bigint, smallint, boolean, int, text, jsonb, jsonb), public.friendly_leave(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.friendly_create(uuid, int), public.friendly_join(uuid, text, int), public.friendly_get(uuid, uuid), public.friendly_mine(uuid),
  public.friendly_ready(uuid, uuid, boolean), public.friendly_abort(uuid, int),
  public.friendly_record(uuid, int, jsonb, bigint, smallint, boolean, int, text, jsonb, jsonb), public.friendly_leave(uuid, uuid)
  to service_role;
revoke execute on function public.is_friendly_participant(text) from public, anon;
grant execute on function public.is_friendly_participant(text) to authenticated;

-- ── 정리 ───────────────────────────────────────────────────────────────────────
-- 시간이 지난 채널을 닫고, 닫힌 지 하루가 지난 채널을 지운다. 판 기록은 battles 에 남아 있다
create function friendly_private.cleanup() returns int
language plpgsql security definer set search_path = '' as $$
declare
  ch public.friendly_channels;
  n int;
begin
  for ch in select * from public.friendly_channels c where c.status <> 'closed' and c.expires_at <= now() for update skip locked loop
    perform friendly_private.expire_if_due(ch);
  end loop;
  delete from public.friendly_channels c where c.status = 'closed' and c.expires_at < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function friendly_private.cleanup() from public, anon, authenticated;
select cron.schedule('friendly-cleanup', '*/5 * * * *', 'select friendly_private.cleanup()');
