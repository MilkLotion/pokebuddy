-- 서버 저장 검증 P4a — 올리기는 Edge Function upload-save 를 거친다 (worklog/records/cloud-authority/record.md "P4 서버 검증")
--   앱은 upload_save RPC 를 더 부르지 않는다. 함수가 직전 서버 저장과 새 저장을 비교(supabase/functions/_shared/save-rules.ts)한 뒤
--   service_role 전용 accept_save 로 쓴다. rev CAS·활성 기기·교환 원장 검사는 지금처럼 DB 함수 안에 있다(검수 F9)
--   Δt 는 서버 시각이다 — last_accepted_at(마지막으로 받은 시각)부터. 클라이언트 시계는 믿지 않는다(검수 F5)
--   관찰 모드(verify_mode = observe): 위반이 있어도 받는다. 위반을 save_violations 에 적고 trust 를 unverified 로 둔다(검수 F1)
--   거부 모드(enforce): 함수가 위반을 적고 CLOUD_SAVE_REJECTED 로 돌려준다(P4c — 사용자가 위반 기록을 보고 켠다, D34)

alter table public.cloud_saves add column last_accepted_at timestamptz;
update public.cloud_saves set last_accepted_at = updated_at where save is not null;

create table cloud_private.save_violations (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  rev         bigint, -- 받은 저장의 rev. 거부했으면 null
  rule        text not null,
  value       double precision not null,
  lim         double precision not null,
  pet         text,
  rejected    boolean not null default false,
  app_version text,
  created_at  timestamptz not null default now()
);
alter table cloud_private.save_violations enable row level security;
create index save_violations_user on cloud_private.save_violations (user_id, created_at desc);

insert into cloud_private.settings (key, value) values
  ('verify_mode', 'observe'),       -- observe | enforce (D34)
  ('verify_margin', '1.1'),         -- 규칙상 정상 최대치에 곱하는 여유 (D32)
  ('verify_max_gap_hours', '72')    -- 오프라인 진행 인정 상한 (D25)
  on conflict (key) do nothing;

create function cloud_private.setting(k text, fallback text) returns text
language sql stable set search_path = '' as $$
  select coalesce((select s.value from cloud_private.settings s where s.key = k), fallback);
$$;

-- 위반 기록 — p_violations: [{ rule, value, limit, pet? }]
create function cloud_private.log_violations(p_user uuid, p_rev bigint, p_violations jsonb, p_rejected boolean, p_app_version text)
returns int
language plpgsql set search_path = '' as $$
declare
  n int := 0;
  v jsonb;
begin
  if p_violations is null or jsonb_typeof(p_violations) <> 'array' then
    return 0;
  end if;
  for v in select * from jsonb_array_elements(p_violations) limit 50 loop
    insert into cloud_private.save_violations (user_id, rev, rule, value, lim, pet, rejected, app_version)
      values (p_user, p_rev, left(coalesce(v->>'rule', '?'), 32),
              coalesce((v->>'value')::double precision, 0), coalesce((v->>'limit')::double precision, 0),
              left(v->>'pet', 32), p_rejected, left(p_app_version, 32));
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- 받아 쓰기 — 옛 upload_save 본문에 사용자 인자·위반 처리·last_accepted_at 을 더했다
--   p_checked_rev: 함수가 비교에 쓴 직전 저장의 rev. 기존 행에 쓸 때는 지금 rev 와 같아야 한다 — 비교 뒤 다른 요청이 먼저 썼거나,
--   비교를 건너뛴 요청(멱등 재전송으로 보였는데 그사이 last_op 가 바뀐 요청)이 검증 없이 쓰지 못하게 한다(검수 P4a C1)
create function cloud_private.store_save(me uuid, p_device uuid, p_base_rev bigint, p_checked_rev bigint, p_save jsonb, p_save_v int,
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
    if pg_column_size(p_save) >= 262144 then
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
  if pg_column_size(p_save) >= 262144 then
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

-- 함수가 비교에 쓰는 것 — 직전 서버 저장·rev·서버 시각 기준 틈·받은 편지·끝난 교환·검증 설정
--   편지는 받은 시각이 아니라 id 로 대조한다 — 받기와 올리기가 엇갈려도 새로 넣은 편지 id 로 선물을 찾는다(검수 P4a H4e). 최근 200통
--   교환은 확정과 반영이 두 올리기 사이에 모두 끝날 수 있다 — 직전 저장 뒤 끝난 교환 수를 준다.
--   직전 저장 전에 끝났는데 반영이 늦은 교환(trade.pending)은 30일 안의 끝난 채널 id 로 확인한다
create function public.save_verify_context(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.cloud_saves;
  since timestamptz;
  letters jsonb;
  trades int;
  before jsonb;
begin
  select * into s from public.cloud_saves c where c.user_id = p_user;
  since := coalesce(s.last_accepted_at, s.updated_at);
  select coalesce(jsonb_object_agg(x.letter_id::text, x.gifts), '{}'::jsonb) into letters
    from (select mc.letter_id, l.gifts
            from public.mail_claims mc
            join public.mail_letters l on l.id = mc.letter_id
            where mc.user_id = p_user
            order by mc.claimed_at desc
            limit 200) x;
  select count(*)::int into trades
    from public.trade_channels t
    where t.status = 'done' and (t.host = p_user or t.guest = p_user) and since is not null and t.done_at > since;
  select coalesce(jsonb_agg(t.id::text), '[]'::jsonb) into before
    from public.trade_channels t
    where t.status = 'done' and (t.host = p_user or t.guest = p_user) and since is not null
      and t.done_at <= since and t.done_at > since - interval '30 days';
  return jsonb_build_object(
    'found', s.user_id is not null,
    'rev', s.rev,
    'save', s.save,
    'last_op', s.last_op,
    'gap_ms', case when since is null then null else floor(extract(epoch from (now() - since)) * 1000) end,
    'mode', cloud_private.setting('verify_mode', 'observe'),
    'margin', cloud_private.setting('verify_margin', '1.1')::double precision,
    'max_gap_ms', cloud_private.setting('verify_max_gap_hours', '72')::double precision * 3600000,
    'letters', letters,
    'trades', trades,
    'trades_before', before);
end;
$$;

create function public.accept_save(p_user uuid, p_device uuid, p_base_rev bigint, p_checked_rev bigint, p_save jsonb, p_save_v int,
                                   p_app_version text, p_op uuid, p_violations jsonb)
returns bigint
language sql security definer set search_path = '' as $$
  select cloud_private.store_save(p_user, p_device, p_base_rev, p_checked_rev, p_save, p_save_v, p_app_version, p_op, p_violations);
$$;

-- 거부 모드에서 함수가 거부한 위반을 적는다
create function public.reject_save(p_user uuid, p_violations jsonb, p_app_version text)
returns int
language sql security definer set search_path = '' as $$
  select cloud_private.log_violations(p_user, null, p_violations, true, p_app_version);
$$;

-- 관리자 CLI(admin/admin.cjs) — 위반 목록과 검증 설정. cloud_private 는 API 에 노출되지 않아 service_role 전용 함수로 연다
create function public.admin_save_violations(p_user uuid default null, p_limit int default 50)
returns table (id bigint, user_id uuid, rev bigint, rule text, value double precision, lim double precision, pet text,
               rejected boolean, app_version text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select v.id, v.user_id, v.rev, v.rule, v.value, v.lim, v.pet, v.rejected, v.app_version, v.created_at
    from cloud_private.save_violations v
    where p_user is null or v.user_id = p_user
    order by v.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 500);
$$;

-- 모드(observe|enforce)·여유를 바꾼다. null 이면 그대로. 지금 값을 돌려준다
create function public.admin_verify_settings(p_mode text default null, p_margin double precision default null)
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
  return jsonb_build_object(
    'mode', cloud_private.setting('verify_mode', 'observe'),
    'margin', cloud_private.setting('verify_margin', '1.1')::double precision,
    'max_gap_hours', cloud_private.setting('verify_max_gap_hours', '72')::double precision,
    'violations', (select count(*) from cloud_private.save_violations),
    'unverified', (select count(*) from public.cloud_saves c where c.trust = 'unverified'));
end;
$$;

revoke all on function public.admin_save_violations(uuid, int) from public, anon, authenticated;
revoke all on function public.admin_verify_settings(text, double precision) from public, anon, authenticated;
grant execute on function public.admin_save_violations(uuid, int) to service_role;
grant execute on function public.admin_verify_settings(text, double precision) to service_role;

revoke all on function public.save_verify_context(uuid) from public, anon, authenticated;
revoke all on function public.accept_save(uuid, uuid, bigint, bigint, jsonb, int, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.reject_save(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_verify_context(uuid) to service_role;
grant execute on function public.accept_save(uuid, uuid, bigint, bigint, jsonb, int, text, uuid, jsonb) to service_role;
grant execute on function public.reject_save(uuid, jsonb, text) to service_role;
revoke all on function cloud_private.setting(text, text) from public, anon, authenticated;
revoke all on function cloud_private.log_violations(uuid, bigint, jsonb, boolean, text) from public, anon, authenticated;
revoke all on function cloud_private.store_save(uuid, uuid, bigint, bigint, jsonb, int, text, uuid, jsonb) from public, anon, authenticated;

-- 앱이 직접 부르던 upload_save — 검증을 건너뛰는 길이라 닫는다. P4 전 앱은 업데이트 안내를 받는다
create or replace function public.upload_save(p_device uuid, p_base_rev bigint, p_save jsonb, p_save_v int, p_app_version text, p_op uuid)
returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'CLOUD_UPDATE_REQUIRED';
end;
$$;
-- 최소 앱 버전(min_app_version)은 여기서 올리지 않는다 — 배포할 때 새 앱 버전으로 올린다(D28). 올리기 전의 옛 앱은 위 upload_save 에서 업데이트 안내를 받는다
