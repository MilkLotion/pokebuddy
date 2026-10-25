-- 검증 잠금 스위치 — 관찰 모드 위반이 계정을 unverified 로 묶을지 정한다(설정 verify_lock, 기본 off)
--   2026-10-25 관찰: 친구에게 받은 지우개굴닌자를 교환으로 돌려준 계정이 form-item 위반으로 unverified 가 되어 교환이 막혔다.
--   지금까지 위반 270건 중 오탐이 많아, 규칙을 고치는 동안 잠금을 끈다. 위반 기록(save_violations)은 그대로 남긴다.
--   off: store_save 가 위반이 있어도 trust 를 바꾸지 않고, first_trust 가 legacy 창이 지나도 unverified 대신 legacy 를 준다.
--   on: 20261008100000_save_size_limit.sql 의 store_save · 20261002100000_anonymous_save.sql 의 first_trust 와 같다.
--   거부 모드(verify_mode = enforce)의 거부·이용 정지는 이 스위치와 무관하다.
--   켜기: admin.cjs verify --lock on --yes. 켜도 지금 legacy 로 푼 계정은 다시 묶지 않는다.

insert into cloud_private.settings (key, value) values ('verify_lock', 'off') -- on | off
  on conflict (key) do nothing;

-- 지금 묶인 계정을 푼다(위반 기록은 남는다)
update public.cloud_saves set trust = 'legacy' where trust = 'unverified';

create or replace function cloud_private.first_trust(save jsonb) returns text
language plpgsql stable set search_path = '' as $$
declare
  until timestamptz;
begin
  if cloud_private.is_fresh(save) then
    return 'fresh';
  end if;
  if cloud_private.setting('verify_lock', 'off') <> 'on' then
    return 'legacy';
  end if;
  begin
    until := cloud_private.setting('legacy_until')::timestamptz;
  exception when others then
    until := null;
  end;
  return case when until is not null and now() < until then 'legacy' else 'unverified' end;
end;
$$;

-- 본문은 20261008100000_save_size_limit.sql 의 store_save 그대로이고 trust 줄만 스위치를 본다
create or replace function cloud_private.store_save(me uuid, p_device uuid, p_base_rev bigint, p_checked_rev bigint, p_save jsonb, p_save_v int,
                                         p_app_version text, p_op uuid, p_violations jsonb)
returns bigint
language plpgsql set search_path = '' as $$
declare
  s public.cloud_saves;
  v_rev bigint;
  bad boolean := p_violations is not null and jsonb_typeof(p_violations) = 'array' and jsonb_array_length(p_violations) > 0;
  v_lock boolean := cloud_private.setting('verify_lock', 'off') = 'on';
begin
  if me is null or not exists (select 1 from auth.users u where u.id = me) then
    raise exception 'CLOUD_LOGIN_REQUIRED';
  end if;
  perform cloud_private.require_version(p_app_version);
  if p_op is null then
    raise exception 'CLOUD_BAD_ARGS';
  end if;
  if bad and cloud_private.setting('verify_mode', 'observe') = 'enforce' then
    raise exception 'CLOUD_SAVE_REJECTED'; -- 함수가 먼저 거르고 위반을 적는다. 여기는 막아 두기만 한다
  end if;
  select * into s from public.cloud_saves c where c.user_id = me for update;

  if not found and cloud_private.is_anon(me) then
    if p_device is null or p_save is null or jsonb_typeof(p_save) <> 'object' then
      raise exception 'CLOUD_BAD_ARGS';
    end if;
    if p_base_rev is distinct from 0 then
      raise exception 'CLOUD_REV_CONFLICT';
    end if;
    if jsonb_array_length(cloud_private.pets_of(p_save)) = 0 then
      raise exception 'CLOUD_EMPTY_SAVE';
    end if;
    if pg_column_size(p_save) >= 1048576 then
      raise exception 'CLOUD_TOO_LARGE';
    end if;
    -- adopt_anonymous 와 같은 권고 잠금. 이관이 이 계정 저장을 읽는 동안 첫 행을 만들지 않는다(검수 L4)
    perform pg_advisory_xact_lock(hashtextextended('cloud_saves:' || me::text, 0));
    if cloud_private.pets_blocked(me, null, p_save) then
      raise exception 'CLOUD_PET_TRADED_OUT';
    end if;
    insert into public.cloud_saves (user_id, save, save_v, rev, active_device, app_version, updated_at,
                                    last_seen, presence, last_op, last_op_rev, trust, first_saved_at, last_accepted_at)
      values (me, p_save, p_save_v, 1, p_device, left(p_app_version, 32), now(),
              now(), 'active', p_op, 1, cloud_private.first_trust(p_save), now(), now())
      on conflict (user_id) do nothing;
    if not found then
      raise exception 'CLOUD_REV_CONFLICT'; -- 같은 순간 다른 요청이 행을 만들었다
    end if;
    return 1;
  end if;

  if not found or s.active_device is distinct from p_device then
    raise exception 'CLOUD_NOT_ACTIVE';
  end if;
  if s.last_op = p_op then
    update public.cloud_saves c set last_seen = now(), presence = 'active' where c.user_id = me;
    return s.last_op_rev;
  end if;
  if p_base_rev is distinct from s.rev or p_checked_rev is distinct from s.rev then
    raise exception 'CLOUD_REV_CONFLICT';
  end if;
  if p_save is null or jsonb_typeof(p_save) <> 'object' then
    raise exception 'CLOUD_BAD_ARGS';
  end if;
  if pg_column_size(p_save) >= 1048576 then
    raise exception 'CLOUD_TOO_LARGE';
  end if;
  if cloud_private.pets_blocked(me, s.save, p_save) then
    raise exception 'CLOUD_PET_TRADED_OUT';
  end if;
  update public.cloud_saves c
    set save = p_save, save_v = p_save_v, app_version = left(p_app_version, 32),
        rev = c.rev + 1, updated_at = now(), last_seen = now(), presence = 'active',
        last_op = p_op, last_op_rev = c.rev + 1, last_accepted_at = now(),
        trust = case when bad and v_lock then 'unverified' else coalesce(c.trust, cloud_private.first_trust(p_save)) end,
        first_saved_at = coalesce(c.first_saved_at, case when c.trust is null then now() end)
    where c.user_id = me
    returning c.rev into v_rev;
  if bad then
    perform cloud_private.log_violations(me, v_rev, p_violations, false, p_app_version);
  end if;
  return v_rev;
end;
$$;

-- 관리 함수에 잠금 스위치를 더한다. 인자가 늘어 옛 함수를 지우고 다시 만든다(20261003100000_save_verify.sql)
drop function public.admin_verify_settings(text, double precision);

create function public.admin_verify_settings(p_mode text default null, p_margin double precision default null, p_lock text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_mode is not null then
    if p_mode not in ('observe', 'enforce') then
      raise exception 'CLOUD_BAD_ARGS';
    end if;
    insert into cloud_private.settings (key, value) values ('verify_mode', p_mode)
      on conflict (key) do update set value = excluded.value;
  end if;
  if p_margin is not null then
    if p_margin < 1 or p_margin > 10 then
      raise exception 'CLOUD_BAD_ARGS';
    end if;
    insert into cloud_private.settings (key, value) values ('verify_margin', p_margin::text)
      on conflict (key) do update set value = excluded.value;
  end if;
  if p_lock is not null then
    if p_lock not in ('on', 'off') then
      raise exception 'CLOUD_BAD_ARGS';
    end if;
    insert into cloud_private.settings (key, value) values ('verify_lock', p_lock)
      on conflict (key) do update set value = excluded.value;
  end if;
  return jsonb_build_object(
    'mode', cloud_private.setting('verify_mode', 'observe'),
    'margin', cloud_private.setting('verify_margin', '1.1')::double precision,
    'lock', cloud_private.setting('verify_lock', 'off'),
    'max_gap_hours', cloud_private.setting('verify_max_gap_hours', '72')::double precision,
    'violations', (select count(*) from cloud_private.save_violations),
    'unverified', (select count(*) from public.cloud_saves c where c.trust = 'unverified'));
end;
$$;

revoke all on function public.admin_verify_settings(text, double precision, text) from public, anon, authenticated;
grant execute on function public.admin_verify_settings(text, double precision, text) to service_role;
revoke all on function cloud_private.store_save(uuid, uuid, bigint, bigint, jsonb, int, text, uuid, jsonb) from public, anon, authenticated;
