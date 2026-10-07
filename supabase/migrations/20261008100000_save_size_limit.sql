-- 저장 크기 상한 — 받는 저장의 상한을 압축 전 jsonb 256KB 에서 1MiB 로 올린다
--   2026-10-08 관찰: 포켓몬 224마리 계정의 저장이 압축 전 262,012바이트로 상한(262,144)에 닿아 CLOUD_TOO_LARGE 로 올리기가 멈췄다.
--   같은 저장이 열에는 41,683바이트(압축)로 들어간다. 상한은 압축 전 크기로 잰다 — 인자도, 테이블 제약도(제약은 압축 전에 검사한다).
--   두 곳을 같은 값으로 올린다: store_save 의 검사 두 곳과 테이블 제약 cloud_saves_save_check(20260927100200_cloud_save.sql).
--   본문은 20261003100000_save_verify.sql 의 store_save 그대로이고 상한만 바꿨다.
--   옛 upload_save RPC 는 이미 닫혔다(CLOUD_UPDATE_REQUIRED) — 바꾸지 않는다.

alter table public.cloud_saves drop constraint cloud_saves_save_check;
alter table public.cloud_saves add constraint cloud_saves_save_check
  check (save is null or pg_column_size(save) < 1048576); -- 1MiB

create or replace function cloud_private.store_save(me uuid, p_device uuid, p_base_rev bigint, p_checked_rev bigint, p_save jsonb, p_save_v int,
                                         p_app_version text, p_op uuid, p_violations jsonb)
returns bigint
language plpgsql set search_path = '' as $$
declare
  s public.cloud_saves;
  v_rev bigint;
  bad boolean := p_violations is not null and jsonb_typeof(p_violations) = 'array' and jsonb_array_length(p_violations) > 0;
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
        trust = case when bad then 'unverified' else coalesce(c.trust, cloud_private.first_trust(p_save)) end,
        first_saved_at = coalesce(c.first_saved_at, case when c.trust is null then now() end)
    where c.user_id = me
    returning c.rev into v_rev;
  if bad then
    perform cloud_private.log_violations(me, v_rev, p_violations, false, p_app_version);
  end if;
  return v_rev;
end;
$$;
