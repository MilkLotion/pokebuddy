-- 이용 정지 P4c — 거부 모드에서 저장이 거부된 계정은 모든 조작을 막는다 (worklog/records/cloud-authority/cloud-authority.md "P4c", D35·D36)
--   정지는 운영자가 위반 기록을 확인한 뒤 풀거나 그대로 둔다(관리자 CLI — admin_hold_set). 자동 말소는 하지 않는다
--   막는 곳: 계정 도우미(cloud_private.require_account — 기기 연결·하트비트·받기·이관·시드), 교환 도우미(trade_private.require_uid —
--   만들기·참가·제안·확정·나가기·반영), 편지 받기(claim_mail), 올리기(upload-save 함수가 문맥의 held 를 본다)
--   코드는 모두 CLOUD_ACCOUNT_HELD 다. 앱은 이 코드를 받으면 게임을 멈추고 정지 창을 띄운 뒤 끝낸다

create table cloud_private.account_holds (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  reason      text not null,               -- save-rejected | admin
  created_at  timestamptz not null default now(),
  released_at timestamptz,                 -- 풀었으면 시각. null 이면 정지 중
  note        text
);
alter table cloud_private.account_holds enable row level security;
revoke all on table cloud_private.account_holds from public, anon, authenticated;

create function cloud_private.is_held(who uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from cloud_private.account_holds h where h.user_id = who and h.released_at is null);
$$;
revoke all on function cloud_private.is_held(uuid) from public, anon, authenticated;

-- 계정 도우미 — 정지된 계정이면 CLOUD_ACCOUNT_HELD (20261002100000_anonymous_save.sql 정의에 정지 확인을 더했다)
create or replace function cloud_private.require_account() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from auth.users u where u.id = me) then
    raise exception 'CLOUD_LOGIN_REQUIRED';
  end if;
  if cloud_private.is_held(me) then
    raise exception 'CLOUD_ACCOUNT_HELD';
  end if;
  return me;
end;
$$;

-- 교환 도우미 — 같은 확인 (20260927100000_trade.sql 정의에 더했다)
create or replace function trade_private.require_uid() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'TRADE_AUTH_REQUIRED';
  end if;
  if cloud_private.is_held(v) then
    raise exception 'CLOUD_ACCOUNT_HELD';
  end if;
  return v;
end;
$$;

-- 편지 받기 — 정지 확인을 더했다 (20260930100000_mail_recipient.sql)
create or replace function public.claim_mail(p_letter uuid)
returns table (gifts jsonb, claimed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  l public.mail_letters;
  at timestamptz;
begin
  if me is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'MAIL_LOGIN_REQUIRED';
  end if;
  if cloud_private.is_held(me) then
    raise exception 'CLOUD_ACCOUNT_HELD';
  end if;
  select * into l from public.mail_letters m where m.id = p_letter;
  if not found or l.starts_at > now() or (l.recipient is not null and l.recipient <> me) then
    raise exception 'MAIL_NOT_FOUND';
  end if;
  if jsonb_array_length(l.gifts) = 0 then
    raise exception 'MAIL_NO_GIFTS';
  end if;
  select c.claimed_at into at from public.mail_claims c where c.letter_id = p_letter and c.user_id = me;
  if at is null then
    if l.ends_at is not null and l.ends_at <= now() then
      raise exception 'MAIL_EXPIRED';
    end if;
    insert into public.mail_claims as c (letter_id, user_id) values (p_letter, me)
      on conflict (letter_id, user_id) do nothing;
    select c.claimed_at into at from public.mail_claims c where c.letter_id = p_letter and c.user_id = me;
  end if;
  return query select l.gifts, at;
end;
$$;


-- 거부 모드에서 함수가 거부한 위반을 적고 계정을 정지한다(D35). 이미 정지 중이면 그대로, 풀린 적이 있으면 다시 건다
create or replace function public.reject_save(p_user uuid, p_violations jsonb, p_app_version text)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  n := cloud_private.log_violations(p_user, null, p_violations, true, p_app_version);
  insert into cloud_private.account_holds (user_id, reason)
    values (p_user, 'save-rejected')
    on conflict (user_id) do update set reason = 'save-rejected', created_at = now(), released_at = null
      where cloud_private.account_holds.released_at is not null;
  return n;
end;
$$;

-- 문맥에 정지 여부를 더한다 — 함수는 정지된 계정의 올리기를 CLOUD_ACCOUNT_HELD 로 거절한다
create or replace function public.save_verify_context(p_user uuid)
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
    'trades_before', before,
    'seed', (select a.seed from cloud_private.account_seeds a where a.user_id = p_user and since is not null and a.created_at <= since),
    'held', cloud_private.is_held(p_user));
end;
$$;


-- 관리자 CLI(admin/admin.cjs holds · hold) — 정지 목록과 걸기·풀기
create function public.admin_holds(p_all boolean default false)
returns table (user_id uuid, reason text, created_at timestamptz, released_at timestamptz, note text, violations bigint)
language sql stable security definer set search_path = '' as $$
  select h.user_id, h.reason, h.created_at, h.released_at, h.note,
         (select count(*) from cloud_private.save_violations v where v.user_id = h.user_id)
    from cloud_private.account_holds h
    where p_all or h.released_at is null
    order by h.created_at desc
    limit 200;
$$;

-- p_hold true 면 건다(reason admin), false 면 푼다. 지금 상태를 돌려준다
create function public.admin_hold_set(p_user uuid, p_hold boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'CLOUD_LOGIN_REQUIRED';
  end if;
  if p_hold then
    insert into cloud_private.account_holds (user_id, reason, note) values (p_user, 'admin', p_note)
      on conflict (user_id) do update set reason = 'admin', created_at = now(), released_at = null, note = coalesce(p_note, cloud_private.account_holds.note);
  else
    update cloud_private.account_holds h set released_at = now(), note = coalesce(p_note, h.note)
      where h.user_id = p_user and h.released_at is null;
  end if;
  return jsonb_build_object('user_id', p_user, 'held', cloud_private.is_held(p_user));
end;
$$;

revoke all on function public.admin_holds(boolean) from public, anon, authenticated;
revoke all on function public.admin_hold_set(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_holds(boolean) to service_role;
grant execute on function public.admin_hold_set(uuid, boolean, text) to service_role;
