-- 두 PC 규칙 — 기기 상태(presence)·하트비트·버전 검사·멱등 올리기
-- 설계: worklog-mac/records/cloud-authority/design-p1.md 1절, 10절 결정
--   활성 PC 는 60초마다 touch_device 로 살아 있음을 알린다
--   150초 넘게 소식이 없으면 연결 끊김으로 본다. 잠듦·정상 종료는 직전에 알린다
--   늦게 켜진 PC 는 활성 PC 가 온라인이면 물러난다(yield). 끊긴 PC 를 넘겨받을 때는 한 번 확인한다(confirm)
--   교환이 열려 있거나 서버 저장에 반영되지 않은 교환(7일 이내)이 있으면 넘겨받지 않는다
--   최소 앱 버전은 cloud_private.settings 표에 둔다. 옛 함수 시그니처는 CLOUD_UPDATE_REQUIRED 만 낸다

-- 기기 상태 칸. 옛 앱이 만든 행은 last_seen 이 비어 있다(unknown)
alter table public.cloud_saves
  add column last_seen   timestamptz,
  add column presence    text not null default 'active' check (presence in ('active', 'asleep', 'released')),
  add column last_op     uuid,        -- 마지막으로 쓴 올리기의 멱등 키
  add column last_op_rev bigint;      -- 그 올리기가 만든 rev

-- 서버 설정 표. 운영에서 값만 바꾼다
create table cloud_private.settings (
  key   text primary key,
  value text not null
);
alter table cloud_private.settings enable row level security;
revoke all on cloud_private.settings from public, anon, authenticated;
-- P1 배포 때 배포 버전으로 올린다(10절 Q7)
insert into cloud_private.settings (key, value) values ('min_app_version', '0.13.0');

-- 최소 앱 버전. 설정 행이 없으면 0.0.0(검사 안 함)
create function cloud_private.min_app_version() returns text
language sql stable set search_path = '' as $$
  select coalesce((select s.value from cloud_private.settings s where s.key = 'min_app_version'), '0.0.0');
$$;

-- 점 구분 버전을 정수 세 칸으로 바꾼다. 형식이 틀리면 null
--   0.14.0-beta.1 처럼 - 나 + 뒤는 버린다. 빠진 칸은 0 으로 채운다
create function cloud_private.version_parts(v text) returns int[]
language plpgsql immutable set search_path = '' as $$
declare
  core text;
  parts text[];
begin
  if v is null or v !~ '^[0-9]+(\.[0-9]+){0,2}([-+].*)?$' then
    return null;
  end if;
  core := substring(v from '^[0-9]+(?:\.[0-9]+){0,2}');
  parts := string_to_array(core, '.');
  return array[parts[1]::int, coalesce(parts[2], '0')::int, coalesce(parts[3], '0')::int];
exception when others then
  return null; -- 정수 범위 초과
end;
$$;

-- 앱 버전이 최소 버전 이상인지. 판정할 수 없으면 false
create function cloud_private.version_ok(v text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  have int[] := cloud_private.version_parts(v);
  need int[] := coalesce(cloud_private.version_parts(cloud_private.min_app_version()), array[0, 0, 0]);
begin
  return have is not null and have >= need;
end;
$$;

create function cloud_private.require_version(v text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if not cloud_private.version_ok(v) then
    raise exception 'CLOUD_UPDATE_REQUIRED';
  end if;
end;
$$;

-- 활성 기기의 상태
--   none         행이 없거나 활성 기기가 없다
--   unknown      last_seen 이 비어 있다(옛 앱 행). 경고 없이 넘겨받는다
--   released     정상 종료했다
--   asleep       잠금·절전 직전에 알렸다
--   online       150초 이내에 소식이 있었다
--   disconnected 그 밖(active 인데 150초 넘게 소식 없음)
create function cloud_private.presence_of(s public.cloud_saves) returns text
language plpgsql stable set search_path = '' as $$
begin
  if s.user_id is null or s.active_device is null then
    return 'none';
  elsif s.last_seen is null then
    return 'unknown';
  elsif s.presence = 'released' then
    return 'released';
  elsif s.presence = 'asleep' then
    return 'asleep';
  elsif s.last_seen > now() - interval '150 seconds' then
    return 'online';
  end if;
  return 'disconnected';
end;
$$;

-- 서버 저장에 반영되지 않은 교환이 있는지(10절 Q5: 7일 이내 done 채널만)
--   서버 저장이 없으면 반영분이 올라가지 않은 것이다
--   서버 저장의 trade.pending 이 그 채널이면 받는 PC 가 반영하므로 막지 않는다
--   내 applied_at 이 있으면 서버 저장 시각이 그 뒤일 때 반영분이 올라간 것이다
--   내 applied_at 이 비었으면(반영 알림 실패) 서버 저장 시각이 done_at 보다 뒤일 때 반영분이 올라간 것이다.
--     pending 이 없는 채 done 뒤에 올라온 저장은 교환을 반영했거나 풀어 둔 저장이다
create function cloud_private.trade_unsynced(me uuid, s public.cloud_saves) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  return exists (
    select 1
    from public.trade_channels c
    cross join lateral (select case when me = c.host then c.host_applied_at else c.guest_applied_at end as applied_at) a
    where me in (c.host, c.guest)
      and c.status = 'done'
      and c.done_at > now() - interval '7 days'
      and (
        s.save is null
        or s.updated_at is null
        or ((s.save #>> '{trade,pending,channelId}') is distinct from c.id::text
            and case when a.applied_at is null then s.updated_at <= c.done_at else a.applied_at > s.updated_at end)
      )
  );
end;
$$;

-- 옛 시그니처는 업데이트 안내만 한다(D28). 권한은 남겨 옛 앱이 이 오류를 받게 한다
drop function public.claim_device(uuid, text);
drop function public.upload_save(uuid, bigint, jsonb, int, text);

create function public.claim_device(p_device uuid, p_label text)
returns table (rev bigint, updated_at timestamptz, has_save boolean)
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'CLOUD_UPDATE_REQUIRED';
end;
$$;

create function public.upload_save(p_device uuid, p_base_rev bigint, p_save jsonb, p_save_v int, p_app_version text)
returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'CLOUD_UPDATE_REQUIRED';
end;
$$;

-- 이 PC 를 활성 기기로 만든다
--   p_mode  boot: 앱을 켤 때. late: 오프라인으로 켠 뒤 처음 서버에 닿을 때
--   p_force 연결 끊긴 PC 를 넘겨받는 확인(confirm)을 사용자가 승인했다
--   outcome claimed: 넘겨받았다. yield: 이 PC 가 물러난다(D20). confirm: 사용자 확인이 필요하다(G2)
--   other_label·other_seen 은 넘겨받거나 확인·양보할 상대 PC. 상대가 없으면 null
create function public.claim_device(p_device uuid, p_label text, p_app_version text, p_mode text, p_force boolean)
returns table (outcome text, rev bigint, updated_at timestamptz, has_save boolean, other_label text, other_seen timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := cloud_private.require_member();
  row_before public.cloud_saves;
  row_after public.cloud_saves;
  other boolean;
  state text;
begin
  perform cloud_private.require_version(p_app_version);
  if p_device is null or p_mode is null or p_mode not in ('boot', 'late') then
    raise exception 'CLOUD_BAD_ARGS';
  end if;
  select * into row_before from public.cloud_saves s where s.user_id = me for update;
  other := found and row_before.active_device is not null and row_before.active_device <> p_device;

  if other then
    -- 같은 PC 가 다시 켜진 것은 막지 않는다
    if exists (select 1 from public.trade_channels c where me in (c.host, c.guest) and c.status in ('open', 'joined') and c.expires_at > now()) then
      raise exception 'CLOUD_TRADE_ACTIVE';
    end if;
    if cloud_private.trade_unsynced(me, row_before) then
      raise exception 'CLOUD_TRADE_UNSYNCED';
    end if;
    state := cloud_private.presence_of(row_before);
    -- 양보가 확인보다 앞선다. 확인 중에 상대가 돌아왔으면 force 여도 물러난다
    if p_mode = 'late' and state = 'online' then
      return query select 'yield'::text, row_before.rev, row_before.updated_at, row_before.save is not null,
        row_before.device_label, row_before.last_seen;
      return;
    end if;
    if state = 'disconnected' and not coalesce(p_force, false) then
      return query select 'confirm'::text, row_before.rev, row_before.updated_at, row_before.save is not null,
        row_before.device_label, row_before.last_seen;
      return;
    end if;
  end if;

  insert into public.cloud_saves as s (user_id, active_device, device_label, app_version, last_seen, presence)
    values (me, p_device, left(p_label, 64), left(p_app_version, 32), now(), 'active')
    on conflict (user_id) do update
      set active_device = excluded.active_device, device_label = excluded.device_label,
          app_version = excluded.app_version, last_seen = excluded.last_seen, presence = excluded.presence
    returning * into row_after;

  if other then
    perform realtime.send(jsonb_build_object('device', p_device, 'label', left(p_label, 64)), 'kicked', 'account:' || me::text, true);
    return query select 'claimed'::text, row_after.rev, row_after.updated_at, row_after.save is not null,
      row_before.device_label, row_before.last_seen;
    return;
  end if;
  return query select 'claimed'::text, row_after.rev, row_after.updated_at, row_after.save is not null,
    null::text, null::timestamptz;
end;
$$;

-- 하트비트·잠듦·정상 종료. 활성 기기가 아니면 active=false 만 알린다(오류 아님)
create function public.touch_device(p_device uuid, p_app_version text, p_presence text)
returns table (active boolean, rev bigint)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := cloud_private.require_member();
  s public.cloud_saves;
begin
  perform cloud_private.require_version(p_app_version);
  if p_device is null or p_presence is null or p_presence not in ('active', 'asleep', 'released') then
    raise exception 'CLOUD_BAD_ARGS';
  end if;
  update public.cloud_saves c
    set last_seen = now(), presence = p_presence, app_version = left(p_app_version, 32)
    where c.user_id = me and c.active_device = p_device
    returning * into s;
  if found then
    return query select true, s.rev;
    return;
  end if;
  return query select false, (select c.rev from public.cloud_saves c where c.user_id = me);
end;
$$;

-- 저장을 올린다. 활성 기기이고 base_rev 가 서버 rev 와 같을 때만 쓴다
--   p_op 는 멱등 키다. 마지막으로 쓴 키와 같으면 다시 쓰지 않고 그때의 rev 를 돌려준다
create function public.upload_save(p_device uuid, p_base_rev bigint, p_save jsonb, p_save_v int, p_app_version text, p_op uuid)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := cloud_private.require_member();
  s public.cloud_saves;
begin
  perform cloud_private.require_version(p_app_version);
  if p_op is null then
    raise exception 'CLOUD_BAD_ARGS';
  end if;
  select * into s from public.cloud_saves c where c.user_id = me for update;
  if not found or s.active_device is distinct from p_device then
    raise exception 'CLOUD_NOT_ACTIVE';
  end if;
  if s.last_op = p_op then
    update public.cloud_saves c set last_seen = now(), presence = 'active' where c.user_id = me;
    return s.last_op_rev;
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
        rev = c.rev + 1, updated_at = now(), last_seen = now(), presence = 'active',
        last_op = p_op, last_op_rev = c.rev + 1
    where c.user_id = me
    returning c.rev into s.rev;
  return s.rev;
end;
$$;

revoke execute on all functions in schema cloud_private from public, anon, authenticated;
revoke execute on function
  public.claim_device(uuid, text), public.upload_save(uuid, bigint, jsonb, int, text),
  public.claim_device(uuid, text, text, text, boolean), public.touch_device(uuid, text, text),
  public.upload_save(uuid, bigint, jsonb, int, text, uuid)
  from public, anon;
grant execute on function
  public.claim_device(uuid, text), public.upload_save(uuid, bigint, jsonb, int, text),
  public.claim_device(uuid, text, text, text, boolean), public.touch_device(uuid, text, text),
  public.upload_save(uuid, bigint, jsonb, int, text, uuid)
  to authenticated;
