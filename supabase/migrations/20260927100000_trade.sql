-- 친구 교환 공유 채널
-- 설계: docs/work/trade/record.md "서버 설계"
--   서버는 교환 순서만 판정한다. 개체 값의 정본은 각자의 save.json 이다
--   앱은 테이블을 직접 읽거나 쓰지 않는다. 아래 public 함수(RPC)로만 다룬다
--   실시간 알림은 신호만 보낸다. 앱은 신호를 받으면 get_channel 로 다시 읽는다
--   시각은 DB 의 now() 하나로 판정한다
-- 실패는 raise exception 의 메시지에 오류 코드를 넣는다. 닫힌 이유는 detail 에 넣는다

create extension if not exists pgcrypto with schema extensions;

-- 내부 도우미는 API 로 노출하지 않는 스키마에 둔다
create schema if not exists trade_private;
revoke all on schema trade_private from public, anon, authenticated;

create type public.trade_status as enum ('open', 'joined', 'done', 'cancelled', 'expired');

create table public.trade_channels (
  id               uuid primary key default gen_random_uuid(),
  token_hash       bytea not null unique,                              -- 토큰의 SHA-256. 원문은 저장하지 않는다
  host             uuid references auth.users(id) on delete set null,  -- 계정 삭제 뒤에도 상대의 반영을 위해 남긴다
  guest            uuid references auth.users(id) on delete set null,
  status           public.trade_status not null default 'open',
  protocol         int not null,
  data_version     text not null,
  host_offer       jsonb,
  guest_offer      jsonb,
  offer_rev        int not null default 0,                             -- 어느 쪽 제안이든 바뀌면 1 올린다
  host_ready_rev   int,                                                -- 확정한 offer_rev. null 이면 미확정
  guest_ready_rev  int,
  closed_reason    text,                                               -- host_left · guest_left · expired
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  joined_at        timestamptz,
  done_at          timestamptz,
  host_applied_at  timestamptz,
  guest_applied_at timestamptz,
  check (guest is null or host is null or guest <> host)
);

create index trade_channels_host_status on public.trade_channels (host, status);
create index trade_channels_guest_status on public.trade_channels (guest, status);
create index trade_channels_due on public.trade_channels (expires_at) where status in ('open', 'joined');

alter table public.trade_channels enable row level security;
-- 정책을 두지 않는다. 앱 역할은 행을 읽거나 쓸 수 없다. 함수만 접근한다
revoke all on public.trade_channels from anon, authenticated;

-- ── 규칙 값 ────────────────────────────────────────────────────────────────────
-- 2026-09-27 사용자 확정: 참가 전 10분, 참가 후 30분, 사용자당 1시간 20개
create function trade_private.rule(name text) returns int
language sql immutable set search_path = '' as $$
  select case name
    when 'protocol_min' then 1
    when 'protocol_max' then 1
    when 'open_minutes' then 10
    when 'joined_minutes' then 30
    when 'create_per_hour' then 20
    when 'offer_max_bytes' then 4096
  end;
$$;

-- 로그인한 사용자. 없으면 거절한다
create function trade_private.require_uid() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'TRADE_AUTH_REQUIRED';
  end if;
  return v;
end;
$$;

-- 채널이 바뀌었다는 신호. 내용은 상태와 제안 판 번호뿐이다. 제안 값은 보내지 않는다
create function trade_private.notify(ch public.trade_channels) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    jsonb_build_object('status', ch.status, 'offer_rev', ch.offer_rev),
    'changed',
    'trade:' || ch.id::text,
    true
  );
end;
$$;

-- 표시 이름 — 로그인한 상대만. 제어 문자를 지우고 12자로 자른다
create function trade_private.display_name(user_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select nullif(left(btrim(regexp_replace(u.raw_user_meta_data ->> 'display_name', '[[:cntrl:]]', '', 'g')), 12), '')
  from auth.users u
  where u.id = user_id and coalesce(u.is_anonymous, false) = false;
$$;

-- 16바이트 무작위 토큰. URL 에 그대로 쓸 수 있게 base64url 로 만든다
create function trade_private.new_token() returns text
language sql volatile set search_path = '' as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_');
$$;

create function trade_private.hash(token text) returns bytea
language sql immutable set search_path = '' as $$
  select extensions.digest(convert_to(token, 'UTF8'), 'sha256');
$$;

-- 시간이 지난 채널을 만료로 바꾼다. 바꿨으면 true
create function trade_private.expire_if_due(ch public.trade_channels) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  row_after public.trade_channels;
begin
  if ch.status not in ('open', 'joined') or ch.expires_at > now() then
    return false;
  end if;
  update public.trade_channels
    set status = 'expired', closed_reason = 'expired'
    where id = ch.id
    returning * into row_after;
  perform trade_private.notify(row_after);
  return true;
end;
$$;

-- 내 채널 가운데 시간이 지난 것을 만료로 바꾼다
create function trade_private.expire_mine(me uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  ch public.trade_channels;
begin
  for ch in
    select * from public.trade_channels c
    where me in (c.host, c.guest) and c.status in ('open', 'joined') and c.expires_at <= now()
    for update
  loop
    perform trade_private.expire_if_due(ch);
  end loop;
end;
$$;

-- 내가 만든 open 채널을 닫는다. except_id 는 남긴다
create function trade_private.cancel_my_open(me uuid, except_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  ch public.trade_channels;
begin
  for ch in
    update public.trade_channels c
      set status = 'cancelled', closed_reason = 'host_left'
      where c.host = me and c.status = 'open' and (except_id is null or c.id <> except_id)
      returning *
  loop
    perform trade_private.notify(ch);
  end loop;
end;
$$;

-- 참가자로서 채널을 잠근다. 참가자가 아니면 없는 채널로 본다
create function trade_private.lock_mine(channel uuid, me uuid) returns public.trade_channels
language plpgsql security definer set search_path = '' as $$
declare
  ch public.trade_channels;
begin
  select * into ch from public.trade_channels c where c.id = channel for update;
  if not found or me is distinct from ch.host and me is distinct from ch.guest then
    raise exception 'TRADE_NOT_FOUND';
  end if;
  return ch;
end;
$$;

-- joined 가 아니면 닫힌 채널로 거절한다. 시간이 지났으면 만료 이유를 준다
create function trade_private.require_joined(ch public.trade_channels) returns void
language plpgsql set search_path = '' as $$
begin
  if ch.status in ('open', 'joined') and ch.expires_at <= now() then
    raise exception 'TRADE_CLOSED' using detail = 'expired';
  end if;
  if ch.status <> 'joined' then
    raise exception 'TRADE_CLOSED' using detail = coalesce(ch.closed_reason, ch.status::text);
  end if;
end;
$$;

-- ── 공개 함수 ──────────────────────────────────────────────────────────────────

-- 채널을 만든다. 토큰 원문은 여기서 한 번만 돌려준다
create function public.create_channel(p_protocol int, p_data_version text)
returns table (channel_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := trade_private.require_uid();
  v_token text;
  v_id uuid;
  v_exp timestamptz;
begin
  if p_protocol is null or p_protocol < trade_private.rule('protocol_min') or p_protocol > trade_private.rule('protocol_max') then
    raise exception 'TRADE_VERSION_MISMATCH';
  end if;
  if p_data_version is null or length(p_data_version) = 0 or length(p_data_version) > 64 then
    raise exception 'TRADE_BAD_ARGS';
  end if;
  if (select count(*) from public.trade_channels c where c.host = me and c.created_at > now() - interval '1 hour')
     >= trade_private.rule('create_per_hour') then
    raise exception 'TRADE_RATE_LIMITED';
  end if;
  perform trade_private.expire_mine(me);
  if exists (select 1 from public.trade_channels c where me in (c.host, c.guest) and c.status = 'joined') then
    raise exception 'TRADE_ALREADY_ACTIVE';
  end if;
  perform trade_private.cancel_my_open(me, null);

  v_token := trade_private.new_token();
  v_exp := now() + make_interval(mins => trade_private.rule('open_minutes'));
  insert into public.trade_channels (token_hash, host, protocol, data_version, expires_at)
    values (trade_private.hash(v_token), me, p_protocol, p_data_version, v_exp)
    returning id into v_id;
  return query select v_id, v_token, v_exp;
end;
$$;

-- 링크로 참가한다
create function public.join_channel(p_token text, p_protocol int, p_data_version text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := trade_private.require_uid();
  ch public.trade_channels;
begin
  select * into ch from public.trade_channels c where c.token_hash = trade_private.hash(coalesce(p_token, '')) for update;
  if not found then
    raise exception 'TRADE_LINK_INVALID';
  end if;
  if ch.status = 'open' and ch.expires_at <= now() then
    raise exception 'TRADE_LINK_EXPIRED';
  end if;
  if ch.status in ('joined', 'done') then
    raise exception 'TRADE_LINK_USED';
  end if;
  if ch.status in ('cancelled', 'expired') then
    raise exception 'TRADE_LINK_EXPIRED';
  end if;
  if ch.host = me then
    raise exception 'TRADE_OWN_LINK';
  end if;
  if p_protocol is distinct from ch.protocol or p_data_version is distinct from ch.data_version then
    raise exception 'TRADE_VERSION_MISMATCH';
  end if;
  perform trade_private.expire_mine(me);
  if exists (select 1 from public.trade_channels c where me in (c.host, c.guest) and c.status = 'joined') then
    raise exception 'TRADE_ALREADY_ACTIVE';
  end if;
  perform trade_private.cancel_my_open(me, ch.id);

  update public.trade_channels c
    set guest = me, status = 'joined', joined_at = now(),
        expires_at = now() + make_interval(mins => trade_private.rule('joined_minutes'))
    where c.id = ch.id
    returning * into ch;
  perform trade_private.notify(ch);
  return ch.id;
end;
$$;

-- 내 제안을 바꾼다. 판 번호가 올라 양쪽 확정이 저절로 풀린다
create function public.set_offer(p_channel uuid, p_pet jsonb)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := trade_private.require_uid();
  ch public.trade_channels := trade_private.lock_mine(p_channel, me);
begin
  perform trade_private.require_joined(ch);
  if p_pet is null or jsonb_typeof(p_pet) <> 'object'
     or octet_length(p_pet::text) > trade_private.rule('offer_max_bytes')
     or jsonb_typeof(p_pet -> 'species') is distinct from 'string'
     or jsonb_typeof(p_pet -> 'level') is distinct from 'number' then
    raise exception 'TRADE_OFFER_INVALID';
  end if;

  update public.trade_channels c
    set host_offer = case when me = c.host then p_pet else c.host_offer end,
        guest_offer = case when me = c.guest then p_pet else c.guest_offer end,
        offer_rev = c.offer_rev + 1
    where c.id = ch.id
    returning * into ch;
  perform trade_private.notify(ch);
  return ch.offer_rev;
end;
$$;

-- 확정한다. p_rev 가 null 이면 확정을 푼다. 둘 다 같은 판에 확정하면 완료다
create function public.set_ready(p_channel uuid, p_rev int)
returns public.trade_status
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := trade_private.require_uid();
  ch public.trade_channels := trade_private.lock_mine(p_channel, me);
  other_rev int;
begin
  if ch.status = 'done' then
    return ch.status; -- 같은 확정을 다시 보내도 결과가 같다
  end if;
  perform trade_private.require_joined(ch);

  if p_rev is null then
    update public.trade_channels c
      set host_ready_rev = case when me = c.host then null else c.host_ready_rev end,
          guest_ready_rev = case when me = c.guest then null else c.guest_ready_rev end
      where c.id = ch.id
      returning * into ch;
    perform trade_private.notify(ch);
    return ch.status;
  end if;

  if ch.host_offer is null or ch.guest_offer is null then
    raise exception 'TRADE_OFFER_MISSING';
  end if;
  if p_rev <> ch.offer_rev then
    raise exception 'TRADE_OFFER_CHANGED';
  end if;

  other_rev := case when me = ch.host then ch.guest_ready_rev else ch.host_ready_rev end;
  update public.trade_channels c
    set host_ready_rev = case when me = c.host then p_rev else c.host_ready_rev end,
        guest_ready_rev = case when me = c.guest then p_rev else c.guest_ready_rev end,
        status = case when other_rev = c.offer_rev then 'done'::public.trade_status else c.status end,
        done_at = case when other_rev = c.offer_rev then now() else c.done_at end
    where c.id = ch.id
    returning * into ch;
  perform trade_private.notify(ch);
  return ch.status;
end;
$$;

-- 확정 전이면 채널을 닫는다
create function public.cancel_channel(p_channel uuid)
returns public.trade_status
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := trade_private.require_uid();
  ch public.trade_channels := trade_private.lock_mine(p_channel, me);
begin
  if ch.status = 'done' then
    raise exception 'TRADE_ALREADY_DONE';
  end if;
  if ch.status in ('open', 'joined') then
    update public.trade_channels c
      set status = 'cancelled', closed_reason = case when me = c.host then 'host_left' else 'guest_left' end
      where c.id = ch.id
      returning * into ch;
    perform trade_private.notify(ch);
  end if;
  return ch.status;
end;
$$;

-- 채널 보기. 토큰 해시와 사용자 ID 는 돌려주지 않는다
create function public.get_channel(p_channel uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := trade_private.require_uid();
  ch public.trade_channels := trade_private.lock_mine(p_channel, me);
  is_host boolean;
begin
  if trade_private.expire_if_due(ch) then
    select * into ch from public.trade_channels c where c.id = p_channel;
  end if;
  is_host := me = ch.host;
  return jsonb_build_object(
    'id', ch.id,
    'role', case when is_host then 'host' else 'guest' end,
    'status', ch.status,
    'offer_rev', ch.offer_rev,
    'my_offer', case when is_host then ch.host_offer else ch.guest_offer end,
    'friend_offer', case when is_host then ch.guest_offer else ch.host_offer end,
    'my_ready', coalesce((case when is_host then ch.host_ready_rev else ch.guest_ready_rev end) = ch.offer_rev, false),
    'friend_ready', coalesce((case when is_host then ch.guest_ready_rev else ch.host_ready_rev end) = ch.offer_rev, false),
    'friend_joined', ch.guest is not null or ch.status not in ('open'),
    'friend_name', trade_private.display_name(case when is_host then ch.guest else ch.host end),
    'expires_at', ch.expires_at,
    'done_at', ch.done_at,
    'closed_reason', ch.closed_reason
  );
end;
$$;

-- 내 앱이 로컬 저장에 반영했다. 양쪽이 모두 반영하면 제안 값을 지운다
create function public.ack_applied(p_channel uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := trade_private.require_uid();
  ch public.trade_channels := trade_private.lock_mine(p_channel, me);
begin
  if ch.status <> 'done' then
    raise exception 'TRADE_NOT_DONE';
  end if;
  update public.trade_channels c
    set host_applied_at = case when me = c.host then coalesce(c.host_applied_at, now()) else c.host_applied_at end,
        guest_applied_at = case when me = c.guest then coalesce(c.guest_applied_at, now()) else c.guest_applied_at end
    where c.id = ch.id
    returning * into ch;
  if ch.host_applied_at is not null and ch.guest_applied_at is not null then
    update public.trade_channels c set host_offer = null, guest_offer = null where c.id = ch.id;
  end if;
end;
$$;

-- ── 실시간 권한 ────────────────────────────────────────────────────────────────
-- 두 참가자만 자기 채널 주제의 신호를 받는다. 앱은 이 주제에 메시지를 보낼 수 없다(insert 정책 없음)
create function public.is_trade_participant(topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trade_channels c
    where topic = 'trade:' || c.id::text
      and (select auth.uid()) in (c.host, c.guest)
  );
$$;

create policy "trade participants receive"
on realtime.messages for select to authenticated
using (realtime.messages.extension = 'broadcast'
       and public.is_trade_participant((select realtime.topic())));

-- ── 실행 권한 ──────────────────────────────────────────────────────────────────
revoke execute on all functions in schema trade_private from public, anon, authenticated;
revoke execute on function
  public.create_channel(int, text), public.join_channel(text, int, text), public.set_offer(uuid, jsonb),
  public.set_ready(uuid, int), public.cancel_channel(uuid), public.get_channel(uuid), public.ack_applied(uuid),
  public.is_trade_participant(text)
  from public, anon;
grant execute on function
  public.create_channel(int, text), public.join_channel(text, int, text), public.set_offer(uuid, jsonb),
  public.set_ready(uuid, int), public.cancel_channel(uuid), public.get_channel(uuid), public.ack_applied(uuid),
  public.is_trade_participant(text)
  to authenticated;

-- ── 정리 ───────────────────────────────────────────────────────────────────────
-- 만료 판정은 함수에서도 하므로 이 작업은 늦어도 된다
create function trade_private.expire_due() returns int
language plpgsql security definer set search_path = '' as $$
declare
  ch public.trade_channels;
  n int := 0;
begin
  for ch in
    select * from public.trade_channels c
    where c.status in ('open', 'joined') and c.expires_at <= now()
    for update skip locked
  loop
    if trade_private.expire_if_due(ch) then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- 끝난 채널을 지운다. 반영하지 않은 done 은 30일 남긴다(2026-09-27 사용자 확정)
create function trade_private.cleanup() returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  delete from public.trade_channels c
  where (c.status in ('cancelled', 'expired') and coalesce(c.joined_at, c.created_at) < now() - interval '1 day' and c.expires_at < now() - interval '1 day')
     or (c.status = 'done' and c.host_applied_at is not null and c.guest_applied_at is not null
         and greatest(c.host_applied_at, c.guest_applied_at) < now() - interval '1 day')
     or (c.status = 'done' and c.done_at < now() - interval '30 days');
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function trade_private.expire_due(), trade_private.cleanup() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('trade-expire', '*/5 * * * *', 'select trade_private.expire_due()');
select cron.schedule('trade-cleanup', '17 3 * * *', 'select trade_private.cleanup()');
