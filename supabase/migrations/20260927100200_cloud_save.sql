-- 클라우드 저장 — 로그인한 계정만 save.json 사본을 둔다
-- 설계: docs/work/trade/record.md "클라우드 저장"
--   게임은 PC 에서 돌고 로컬 save.json 이 정본이다
--   한 계정은 한 번에 한 PC 만 활성이다. 나중에 켜진 PC 가 활성이 되고 먼저 켜진 PC 는 올리지 못한다
--   끊긴 세션의 접속 토큰은 만료 시각까지 유효하므로, 올리기·받기는 활성 기기를 직접 확인한다

create schema if not exists cloud_private;
revoke all on schema cloud_private from public, anon, authenticated;

create table public.cloud_saves (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  save          jsonb,                        -- 로그인만 하고 아직 올리지 않았으면 비어 있다
  save_v        int,                          -- save.json 의 v
  rev           bigint not null default 0,    -- 올릴 때마다 1 올린다
  active_device uuid,                         -- 지금 활성인 PC
  device_label  text,                         -- 안내 문구용 PC 이름
  app_version   text,
  updated_at    timestamptz not null default now(),
  check (save is null or pg_column_size(save) < 262144) -- 256KB
);

alter table public.cloud_saves enable row level security;
revoke all on public.cloud_saves from anon, authenticated;
-- 정책을 두지 않는다. 읽기·쓰기는 아래 함수만 한다

-- 로그인한 정식 계정만. 익명 계정은 서버에 저장하지 않는다
create function cloud_private.require_member() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'CLOUD_LOGIN_REQUIRED';
  end if;
  return me;
end;
$$;

-- 이 PC 를 활성 기기로 만든다. 앞 기기에는 kicked 신호를 보낸다
create function public.claim_device(p_device uuid, p_label text)
returns table (rev bigint, updated_at timestamptz, has_save boolean)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := cloud_private.require_member();
  row_before public.cloud_saves;
  row_after public.cloud_saves;
begin
  if p_device is null then
    raise exception 'CLOUD_BAD_ARGS';
  end if;
  select * into row_before from public.cloud_saves s where s.user_id = me for update;
  -- 다른 PC 가 교환 중이면 넘겨받지 않는다. 같은 PC 가 다시 켜진 것은 막지 않는다
  if found and row_before.active_device is not null and row_before.active_device <> p_device
     and exists (select 1 from public.trade_channels c where me in (c.host, c.guest) and c.status in ('open', 'joined') and c.expires_at > now()) then
    raise exception 'CLOUD_TRADE_ACTIVE';
  end if;

  insert into public.cloud_saves as s (user_id, active_device, device_label)
    values (me, p_device, left(p_label, 64))
    on conflict (user_id) do update
      set active_device = excluded.active_device, device_label = excluded.device_label
    returning * into row_after;

  if row_before.active_device is not null and row_before.active_device <> p_device then
    perform realtime.send(jsonb_build_object('device', p_device), 'kicked', 'account:' || me::text, true);
  end if;
  return query select row_after.rev, row_after.updated_at, row_after.save is not null;
end;
$$;

-- 서버 저장을 받는다. 활성 기기만
create function public.download_save(p_device uuid)
returns table (save jsonb, rev bigint, save_v int)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := cloud_private.require_member();
  s public.cloud_saves;
begin
  select * into s from public.cloud_saves c where c.user_id = me;
  if not found or s.active_device is distinct from p_device then
    raise exception 'CLOUD_NOT_ACTIVE';
  end if;
  return query select s.save, s.rev, s.save_v;
end;
$$;

-- 저장을 올린다. 활성 기기이고 base_rev 가 서버 rev 와 같을 때만 쓴다
create function public.upload_save(p_device uuid, p_base_rev bigint, p_save jsonb, p_save_v int, p_app_version text)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := cloud_private.require_member();
  s public.cloud_saves;
begin
  select * into s from public.cloud_saves c where c.user_id = me for update;
  if not found or s.active_device is distinct from p_device then
    raise exception 'CLOUD_NOT_ACTIVE';
  end if;
  if p_base_rev is distinct from s.rev then
    raise exception 'CLOUD_REV_CONFLICT';
  end if;
  if p_save is null or jsonb_typeof(p_save) <> 'object' then
    raise exception 'CLOUD_BAD_ARGS';
  end if;
  if pg_column_size(p_save) >= 262144 then
    raise exception 'CLOUD_TOO_LARGE';
  end if;
  update public.cloud_saves c
    set save = p_save, save_v = p_save_v, app_version = left(p_app_version, 32),
        rev = c.rev + 1, updated_at = now()
    where c.user_id = me
    returning c.rev into s.rev;
  return s.rev;
end;
$$;

-- 내 계정 주제의 신호(kicked)만 받는다
create policy "account owner receives"
on realtime.messages for select to authenticated
using (realtime.messages.extension = 'broadcast'
       and (select realtime.topic()) = 'account:' || (select auth.uid())::text);

revoke execute on all functions in schema cloud_private from public, anon, authenticated;
revoke execute on function
  public.claim_device(uuid, text), public.download_save(uuid), public.upload_save(uuid, bigint, jsonb, int, text)
  from public, anon;
grant execute on function
  public.claim_device(uuid, text), public.download_save(uuid), public.upload_save(uuid, bigint, jsonb, int, text)
  to authenticated;

-- 채널이 없고 90일 동안 로그인하지 않은 익명 사용자를 지운다
create function trade_private.cleanup_anonymous_users() returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  delete from auth.users u
  where coalesce(u.is_anonymous, false)
    and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '90 days'
    and not exists (select 1 from public.trade_channels c where u.id in (c.host, c.guest))
    and not exists (select 1 from public.cloud_saves s where s.user_id = u.id);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function trade_private.cleanup_anonymous_users() from public, anon, authenticated;
select cron.schedule('anonymous-cleanup', '37 3 * * *', 'select trade_private.cleanup_anonymous_users()');
