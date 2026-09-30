-- 익명 계정 저장 + 교환 기록(원장)
-- 설계: worklog-mac/records/cloud-authority/design-p2.md 1·3·4·7절, 12절 결정(10절 추천안 전부 채택)
--   익명 계정도 서버에 저장한다. 행은 첫 실제 올리기(개체 1마리 이상)에서만 만든다
--   첫 저장은 거부하지 않고 분류만 한다(trust). fresh 가 아니면 legacy 창(배포 뒤 30일) 안이면 legacy, 뒤면 unverified
--   교환은 로그인 계정만 한다. 끝난 교환의 보낸 개체 지문(id, since)을 원장에 남겨 복제를 막는다
--   로그인할 때 익명 저장을 로그인 계정으로 옮긴다(티켓 + adopt_anonymous). 익명 계정은 그 자리에서 지운다
--   P2 가 막는 것은 복제(되돌리기·계정 간 복사)다. 저장 조작(발행)은 P4 몫이다

-- ── 표·칸 ──────────────────────────────────────────────────────────────────────

-- 첫 저장 분류. 저장이 없으면 비어 있고, 정해지면 바뀌지 않는다(이관 때는 따라간다)
alter table public.cloud_saves
  add column trust          text check (trust in ('legacy', 'fresh', 'unverified')),
  add column first_saved_at timestamptz;
-- 이미 저장이 있는 행은 legacy(D26). 첫 저장 시각은 알 수 없어 비워 둔다
update public.cloud_saves set trust = 'legacy' where save is not null;
alter table public.cloud_saves
  add constraint cloud_saves_trust_with_save check (save is null or trust is not null);

-- 제안한 개체의 지문 {id, since}. 3인자 set_offer 가 채운다
alter table public.trade_channels
  add column host_ref  jsonb,
  add column guest_ref jsonb;

-- 교환으로 내보낸 개체 지문. 계정을 지워도 남긴다(from_user 에 FK 없음)
--   받은 개체는 새 id·새 since 로 만들어지므로 원장에 오르지 않는다
create table cloud_private.pet_ledger (
  pet_since  bigint not null,       -- 개체를 만든 시각(ms)
  pet_id     text not null,         -- 저장 안의 개체 id(p숫자). 저장마다 따로 매긴다
  from_user  uuid not null,         -- 내보낸 계정
  channel_id uuid not null,         -- 교환 채널. 채널이 지워져도 남긴다
  species    text,                  -- 내보낼 때의 종(기록용)
  done_at    timestamptz not null,
  primary key (pet_since, pet_id)
);
create index pet_ledger_from_user on cloud_private.pet_ledger (from_user);

-- 이관 티켓. 원문은 익명 앱에 한 번만 돌려주고 SHA-256 만 둔다
create table cloud_private.handoff_tickets (
  hash       bytea primary key,
  anon_id    uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index handoff_tickets_anon on cloud_private.handoff_tickets (anon_id);

-- 이관 감사 기록. 두 계정 모두 지워질 수 있으므로 FK 를 두지 않는다
create table cloud_private.handoffs (
  id         bigint generated always as identity primary key,
  anon_id    uuid not null,
  member_id  uuid not null,
  outcome    text not null check (outcome in ('moved', 'discarded', 'empty')),
  anon_rev   bigint,
  trust      text,
  created_at timestamptz not null default now()
);

-- 교환 중 예약(design-p2.md 17절 D31). 제안에 올린 개체 지문 하나에 채널 하나만 둔다. 계정과 무관하다
--   set_offer 가 채운다. 다른 활성 채널(open·joined, 만료 전)이 가진 지문은 TRADE_PET_BUSY
--   채널이 닫히면(done·cancelled·expired) 트리거가 지운다. 채널을 지우면 FK 로 따라 지운다
--   만료 시각만 지나고 아직 expired 로 바뀌지 않은 채널의 예약은 set_offer 가 덮어쓴다
create table trade_private.pet_offers (
  pet_since  bigint not null,
  pet_id     text not null,
  channel_id uuid not null references public.trade_channels(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (pet_since, pet_id)
);
create index pet_offers_channel on trade_private.pet_offers (channel_id);
create index pet_offers_user on trade_private.pet_offers (user_id);

alter table cloud_private.pet_ledger enable row level security;
alter table cloud_private.handoff_tickets enable row level security;
alter table cloud_private.handoffs enable row level security;
alter table trade_private.pet_offers enable row level security;
revoke all on cloud_private.pet_ledger, cloud_private.handoff_tickets, cloud_private.handoffs from public, anon, authenticated;
revoke all on trade_private.pet_offers from public, anon, authenticated;

-- 채널이 닫히면 그 채널의 예약을 푼다. 취소·만료(expire_if_due·expire_due)·완료가 모두 status 를 바꾸므로 한곳에서 푼다
create function trade_private.release_offers() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from trade_private.pet_offers o where o.channel_id = new.id;
  return null;
end;
$$;
create trigger trade_channels_release_offers
  after update of status on public.trade_channels
  for each row
  when (old.status in ('open', 'joined') and new.status not in ('open', 'joined'))
  execute function trade_private.release_offers();

-- ── 설정 ───────────────────────────────────────────────────────────────────────
-- legacy_until 은 마이그레이션 시각 + 30일이 초기값이다. 원격 배포 때 운영 SQL 편집기에서 배포 시각 + 30일로 다시 맞춘다(11절 3)
-- fresh 문턱은 초기값이다(10절 Q2). P4 때 확정한다
-- starter_species 는 data/unlocks.json 의 starter 규칙(src/dex/unlocks.ts starters())과 같아야 한다. 쉼표로 잇는다
insert into cloud_private.settings (key, value) values
  ('legacy_until', (now() + interval '30 days')::text),
  ('fresh_max_level', '3'),
  ('fresh_max_points', '220'),
  ('fresh_max_bag', '3'),
  ('fresh_max_play_ms', '7200000'),
  ('starter_species', 'bulbasaur,charmander,squirtle,chikorita,cyndaquil,totodile,treecko,torchic,mudkip,turtwig,chimchar,piplup,snivy,tepig,oshawott,chespin,fennekin,froakie,rowlet,litten,popplio,grookey,scorbunny,sobble,sprigatito,fuecoco,quaxly,pichu,eevee');

create function cloud_private.setting(k text) returns text
language sql stable set search_path = '' as $$
  select s.value from cloud_private.settings s where s.key = k;
$$;

-- ── 내부 도우미 ────────────────────────────────────────────────────────────────

-- 로그인·익명 계정 모두. 토큰이 있어도 계정이 지워졌으면(이관 뒤 옛 익명 토큰) 거절한다
create function cloud_private.require_account() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from auth.users u where u.id = me) then
    raise exception 'CLOUD_LOGIN_REQUIRED';
  end if;
  return me;
end;
$$;

-- 익명 계정인가. 토큰이 아니라 계정 행을 본다(연결로 정식 계정이 되면 바로 반영)
create function cloud_private.is_anon(who uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select u.is_anonymous from auth.users u where u.id = who), false);
$$;

-- 개체의 since 를 정수로. 정수가 아니면 null
create function cloud_private.since_of(v jsonb) returns bigint
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^[0-9]{1,15}$' then (v #>> '{}')::bigint end;
$$;

-- 저장의 개체 배열. 배열이 아니면 빈 배열
create function cloud_private.pets_of(save jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(save -> 'pets') = 'array' then save -> 'pets' else '[]'::jsonb end;
$$;

-- 저장에 그 지문의 개체가 있는가
create function cloud_private.has_pet(save jsonb, pet_id text, pet_since bigint) returns boolean
language sql immutable set search_path = '' as $$
  select exists (
    select 1 from jsonb_array_elements(cloud_private.pets_of(save)) p
    where p ->> 'id' = pet_id and cloud_private.since_of(p -> 'since') = pet_since
  );
$$;

-- 새 게임 그대로의 저장인가(3절) — 첫 선택만 마친 모양. 모양이 틀리면 false
create function cloud_private.is_fresh(save jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  pet jsonb;
  starters text[] := string_to_array(coalesce(cloud_private.setting('starter_species'), ''), ',');
  max_level numeric := coalesce(cloud_private.setting('fresh_max_level'), '3')::numeric;
  max_points numeric := coalesce(cloud_private.setting('fresh_max_points'), '220')::numeric;
  max_bag numeric := coalesce(cloud_private.setting('fresh_max_bag'), '3')::numeric;
  max_play numeric := coalesce(cloud_private.setting('fresh_max_play_ms'), '7200000')::numeric;
begin
  if jsonb_typeof(save) is distinct from 'object' or save -> 'v' is distinct from '3'::jsonb
     or jsonb_typeof(save -> 'pets') is distinct from 'array' or jsonb_array_length(save -> 'pets') <> 1 then
    return false;
  end if;
  pet := save -> 'pets' -> 0;
  return coalesce(
    jsonb_typeof(pet) = 'object'
    -- 개체 하나: 첫 선택 개체, 이로치 아님, 진화·모습 없음, 첫 선택 후보 종, 낮은 레벨
    and jsonb_typeof(pet -> 'id') = 'string' and pet -> 'id' = save -> 'starterPetId'
    and pet -> 'shiny' = 'false'::jsonb
    and pet -> 'stage' = '0'::jsonb
    and pet -> 'evolved' = '[]'::jsonb
    and not pet ? 'forms'
    and (pet ->> 'species') = any (starters)
    and jsonb_typeof(pet -> 'level') = 'number' and (pet ->> 'level')::numeric <= max_level
    -- 알·도구·포인트
    and save -> 'eggs' = '[]'::jsonb
    and save -> 'eggSeq' = '0'::jsonb
    and jsonb_typeof(save -> 'points' -> 'balance') = 'number' and (save #>> '{points,balance}')::numeric <= max_points
    and jsonb_typeof(save -> 'bag') = 'object'
    and (select coalesce(sum((b.value #>> '{}')::numeric), 0) from jsonb_each(save -> 'bag') b) <= max_bag
    -- 도감
    and save -> 'dex' -> 'shinyObtained' = '[]'::jsonb
    and jsonb_typeof(save -> 'dex' -> 'obtained') = 'array' and jsonb_array_length(save -> 'dex' -> 'obtained') <= 1
    -- 파티 열린 칸 2개 이하, 박스는 전부 빈 칸
    and jsonb_typeof(save -> 'party' -> 'slots') = 'array'
    and (select count(*) from jsonb_array_elements(save -> 'party' -> 'slots') s where s ->> 'state' is distinct from 'locked') <= 2
    and jsonb_typeof(save -> 'boxes') = 'array'
    and not exists (
      select 1 from jsonb_array_elements(save -> 'boxes') b
      cross join lateral jsonb_array_elements(case when jsonb_typeof(b -> 'slots') = 'array' then b -> 'slots' else '["?"]'::jsonb end) s
      where s <> 'null'::jsonb
    )
    -- 교환·우편 흔적 없음
    and coalesce(save -> 'trade' -> 'pending', 'null'::jsonb) = 'null'::jsonb
    and coalesce(save -> 'mail' -> 'applied', '[]'::jsonb) = '[]'::jsonb
    -- 누적 시간
    and coalesce((save #>> '{totals,presenceMs}')::numeric, 0) + coalesce((save #>> '{totals,workMs}')::numeric, 0) <= max_play,
    false);
exception when others then
  return false; -- 숫자 자리에 숫자가 아닌 값 등
end;
$$;

-- 첫 저장 분류. legacy_until 설정이 없거나 읽지 못하면 창이 닫힌 것으로 본다
create function cloud_private.first_trust(save jsonb) returns text
language plpgsql stable set search_path = '' as $$
declare
  until timestamptz;
begin
  if cloud_private.is_fresh(save) then
    return 'fresh';
  end if;
  begin
    until := cloud_private.setting('legacy_until')::timestamptz;
  exception when others then
    until := null;
  end;
  return case when until is not null and now() < until then 'legacy' else 'unverified' end;
end;
$$;

-- 진행 있음(7절) = 개체 2+ 또는 알 1+ 또는 레벨 2+
create function cloud_private.has_progress(save jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_array_length(cloud_private.pets_of(save)) >= 2
      or coalesce(jsonb_typeof(save -> 'eggs') = 'array' and jsonb_array_length(save -> 'eggs') >= 1, false)
      or exists (
        select 1 from jsonb_array_elements(cloud_private.pets_of(save)) p
        where jsonb_typeof(p -> 'level') = 'number' and (p ->> 'level')::numeric >= 2
      );
$$;

-- 올리려는 저장(save)에 교환으로 내보낸 개체가 남아 있는가(4절)
--   cur 는 지금 서버 저장. 행이 없으면 null
--   내가 내보낸 지문: 거부. 예외 — 저장의 trade.pending 이 그 채널·그 개체이고, 채널이 7일 안에 끝났다
--     (교환이 끝났지만 아직 반영하지 않은 저장. 채널이 지워졌으면 예외가 아니다)
--     반영 알림(applied_at) 여부는 보지 않는다. 올리기 전송 중에 반영·알림이 끝나면 전송 중인 저장이 거부되기 때문이다(검수 M1)
--   남이 내보낸 지문: 지금 서버 저장에 이미 있던 개체가 아니면 거부(다른 계정에서 복사)
create function cloud_private.pets_blocked(me uuid, cur jsonb, save jsonb) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1
    from jsonb_array_elements(cloud_private.pets_of(save)) p
    join cloud_private.pet_ledger l
      on l.pet_id = p ->> 'id' and l.pet_since = cloud_private.since_of(p -> 'since')
    where case
      when l.from_user = me then not exists (
        select 1 from public.trade_channels c
        where c.id = l.channel_id
          and c.status = 'done'
          and l.done_at > now() - interval '7 days'
          and me in (c.host, c.guest)
          and (save #>> '{trade,pending,channelId}') = l.channel_id::text
          and (save #>> '{trade,pending,petId}') = l.pet_id
      )
      else not cloud_private.has_pet(cur, l.pet_id, l.pet_since)
    end
  );
$$;

-- ── 클라우드 저장 (시그니처 유지) ──────────────────────────────────────────────

-- 이 PC 를 활성 기기로 만든다. 익명 계정은 행이 없으면 만들지 않고 빈 결과만 준다(F11)
create or replace function public.claim_device(p_device uuid, p_label text, p_app_version text, p_mode text, p_force boolean)
returns table (outcome text, rev bigint, updated_at timestamptz, has_save boolean, other_label text, other_seen timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := cloud_private.require_account();
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
  if not found and cloud_private.is_anon(me) then
    -- 익명 행은 첫 실제 올리기에서 만든다
    return query select 'claimed'::text, 0::bigint, null::timestamptz, false, null::text, null::timestamptz;
    return;
  end if;
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
--   익명 계정은 행이 없으면 (true, 0) — 아직 올린 적이 없는 새 설치다
create or replace function public.touch_device(p_device uuid, p_app_version text, p_presence text)
returns table (active boolean, rev bigint)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := cloud_private.require_account();
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
  if cloud_private.is_anon(me) and not exists (select 1 from public.cloud_saves c where c.user_id = me) then
    return query select true, 0::bigint;
    return;
  end if;
  return query select false, (select c.rev from public.cloud_saves c where c.user_id = me);
end;
$$;

-- 서버 저장을 받는다. 활성 기기만. 익명 계정은 행이 없으면 빈 저장(null, 0, null)
create or replace function public.download_save(p_device uuid)
returns table (save jsonb, rev bigint, save_v int)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := cloud_private.require_account();
  s public.cloud_saves;
begin
  select * into s from public.cloud_saves c where c.user_id = me;
  if not found and cloud_private.is_anon(me) then
    return query select null::jsonb, 0::bigint, null::int;
    return;
  end if;
  if not found or s.active_device is distinct from p_device then
    raise exception 'CLOUD_NOT_ACTIVE';
  end if;
  return query select s.save, s.rev, s.save_v;
end;
$$;

-- 저장을 올린다. 활성 기기이고 base_rev 가 서버 rev 와 같을 때만 쓴다
--   p_op 는 멱등 키다. 마지막으로 쓴 키와 같으면 다시 쓰지 않고 그때의 rev 를 돌려준다
--   익명 계정의 첫 올리기는 행을 만든다(이 PC 가 활성, rev 1). 개체가 없으면 CLOUD_EMPTY_SAVE
--   서버 저장이 비어 있을 때 올리는 저장이 첫 저장이다. 분류(trust)를 정하고 이후 바꾸지 않는다
--   교환으로 내보낸 개체가 남아 있으면 CLOUD_PET_TRADED_OUT
create or replace function public.upload_save(p_device uuid, p_base_rev bigint, p_save jsonb, p_save_v int, p_app_version text, p_op uuid)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := cloud_private.require_account();
  s public.cloud_saves;
  v_rev bigint;
begin
  perform cloud_private.require_version(p_app_version);
  if p_op is null then
    raise exception 'CLOUD_BAD_ARGS';
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
                                    last_seen, presence, last_op, last_op_rev, trust, first_saved_at)
      values (me, p_save, p_save_v, 1, p_device, left(p_app_version, 32), now(),
              now(), 'active', p_op, 1, cloud_private.first_trust(p_save), now())
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
  if p_base_rev is distinct from s.rev then
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
        last_op = p_op, last_op_rev = c.rev + 1,
        trust = coalesce(c.trust, cloud_private.first_trust(p_save)),
        first_saved_at = coalesce(c.first_saved_at, case when c.trust is null then now() end)
    where c.user_id = me
    returning c.rev into v_rev;
  return v_rev;
end;
$$;

-- require_member 는 더 쓰지 않는다. 위 네 함수가 require_account 로 바뀌었다
drop function cloud_private.require_member();

-- ── 익명 저장 이관 ─────────────────────────────────────────────────────────────

-- 이관 티켓을 만든다. 익명 계정만. 원문은 여기서 한 번만 돌려준다
--   32바이트 무작위, base64url. 10분 뒤 만료. 이 계정의 옛 티켓은 지운다
--   로그인(세션 교체) 직전에 익명 토큰으로 부르고, 로그인 토큰으로 adopt_anonymous 에 넘긴다 — 두 계정의 소유 증명
create function public.begin_handoff()
returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := cloud_private.require_account();
  v_token text;
begin
  if not cloud_private.is_anon(me) then
    raise exception 'CLOUD_HANDOFF_INVALID';
  end if;
  delete from cloud_private.handoff_tickets t where t.anon_id = me or t.expires_at <= now();
  v_token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  insert into cloud_private.handoff_tickets (hash, anon_id, expires_at)
    values (extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), me, now() + interval '10 minutes');
  return v_token;
end;
$$;

-- 익명 저장을 로그인 계정으로 옮기고 익명 계정을 지운다. 로그인 계정만. 한 트랜잭션
--   outcome moved     익명 저장이 있고 로그인 계정에 저장이 없다 → 옮긴다(rev+1, 활성 기기·분류는 유지·이어받음)
--           discarded 로그인 계정에 저장이 있다(D7) 또는 익명 저장에 교환으로 내보낸 개체가 있다 → 버린다
--           empty     익명 저장이 없다
--   rev 는 로그인 계정의 지금 rev(행이 없으면 0)
--   티켓 없음·만료·자기 자신·이미 정식 계정 → CLOUD_HANDOFF_INVALID. 익명 계정의 교환이 열려 있으면 CLOUD_TRADE_ACTIVE
create function public.adopt_anonymous(p_ticket text)
returns table (outcome text, rev bigint)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := cloud_private.require_account();
  t cloud_private.handoff_tickets;
  anon_row public.cloud_saves;
  mine public.cloud_saves;
  v_outcome text;
  v_rev bigint;
begin
  if cloud_private.is_anon(me) then
    raise exception 'CLOUD_LOGIN_REQUIRED';
  end if;
  -- 티켓 행을 잠가 같은 티켓의 동시 사용을 한 번으로 줄인다
  select * into t from cloud_private.handoff_tickets h
    where h.hash = extensions.digest(convert_to(coalesce(p_ticket, ''), 'UTF8'), 'sha256')
    for update;
  if not found or t.expires_at <= now() or t.anon_id = me or not cloud_private.is_anon(t.anon_id) then
    raise exception 'CLOUD_HANDOFF_INVALID';
  end if;
  if exists (select 1 from public.trade_channels c where t.anon_id in (c.host, c.guest) and c.status in ('open', 'joined') and c.expires_at > now()) then
    raise exception 'CLOUD_TRADE_ACTIVE';
  end if;

  -- 두 계정을 uuid 순서로 잠근다. 행이 아직 없는 계정도 잠기도록 권고 잠금을 함께 쓴다
  perform pg_advisory_xact_lock(hashtextextended('cloud_saves:' || least(me, t.anon_id)::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('cloud_saves:' || greatest(me, t.anon_id)::text, 0));
  perform 1 from public.cloud_saves s where s.user_id in (me, t.anon_id) order by s.user_id for update;
  select * into anon_row from public.cloud_saves s where s.user_id = t.anon_id;
  select * into mine from public.cloud_saves s where s.user_id = me;

  if anon_row.user_id is null or anon_row.save is null then
    v_outcome := 'empty';
    v_rev := coalesce(mine.rev, 0);
  elsif mine.save is not null or cloud_private.pets_blocked(me, mine.save, anon_row.save) then
    v_outcome := 'discarded';
    v_rev := coalesce(mine.rev, 0);
  else
    insert into public.cloud_saves as s (user_id, save, save_v, rev, app_version, updated_at, trust, first_saved_at)
      values (me, anon_row.save, anon_row.save_v, 1, anon_row.app_version, now(), anon_row.trust, anon_row.first_saved_at)
      on conflict (user_id) do update
        set save = excluded.save, save_v = excluded.save_v, rev = s.rev + 1, app_version = excluded.app_version,
            updated_at = now(), trust = excluded.trust, first_saved_at = excluded.first_saved_at
      returning s.rev into v_rev;
    v_outcome := 'moved';
  end if;

  insert into cloud_private.handoffs (anon_id, member_id, outcome, anon_rev, trust)
    values (t.anon_id, me, v_outcome, anon_row.rev, anon_row.trust);
  delete from cloud_private.handoff_tickets h where h.anon_id = t.anon_id;
  -- 익명 계정을 지운다. 저장 행은 함께 지워지고 교환 채널의 host·guest 는 비워진다
  -- 옛 익명 토큰은 만료 전까지 유효하지만 require_account 가 CLOUD_LOGIN_REQUIRED 로 막는다
  delete from auth.users u where u.id = t.anon_id;
  return query select v_outcome, v_rev;
end;
$$;

-- ── 교환 ───────────────────────────────────────────────────────────────────────

-- 규약 2: 제안에 개체 지문(ref)을 붙인다. 옛 앱(규약 1)은 만들기·참가에서 TRADE_VERSION_MISMATCH
create or replace function trade_private.rule(name text) returns int
language sql immutable set search_path = '' as $$
  select case name
    when 'protocol_min' then 2
    when 'protocol_max' then 2
    when 'open_minutes' then 10
    when 'joined_minutes' then 30
    when 'create_per_hour' then 20
    when 'offer_max_bytes' then 4096
  end;
$$;

-- 로그인한 정식 계정. 익명 계정은 교환하지 못한다
create function trade_private.require_member() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v uuid := trade_private.require_uid();
  anon boolean;
begin
  select coalesce(u.is_anonymous, false) into anon from auth.users u where u.id = v;
  if not found then
    raise exception 'TRADE_AUTH_REQUIRED';
  end if;
  if anon then
    raise exception 'TRADE_LOGIN_REQUIRED';
  end if;
  return v;
end;
$$;

-- 채널을 만든다. 토큰 원문은 여기서 한 번만 돌려준다
create or replace function public.create_channel(p_protocol int, p_data_version text)
returns table (channel_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := trade_private.require_member();
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
create or replace function public.join_channel(p_token text, p_protocol int, p_data_version text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := trade_private.require_member();
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

-- 옛 앱(규약 1)의 제안. 지문이 없으므로 업데이트 안내만 한다. 권한은 남겨 옛 앱이 이 오류를 받게 한다
create or replace function public.set_offer(p_channel uuid, p_pet jsonb)
returns int
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'TRADE_VERSION_MISMATCH';
end;
$$;

-- 내 제안을 바꾼다. 판 번호가 올라 양쪽 확정이 저절로 풀린다
--   p_ref {id, since} 는 제안한 개체의 지문. 내 서버 저장에 그 개체가 있고 종·이로치·성격이 제안과 같아야 한다(10절 Q7, 레벨 제외)
--   원장에 있는 지문(이미 교환으로 내보낸 개체)은 TRADE_PET_TRADED
--   다른 활성 채널에 올라가 있는 지문은 계정과 무관하게 TRADE_PET_BUSY(D31)
create function public.set_offer(p_channel uuid, p_pet jsonb, p_ref jsonb)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := trade_private.require_member();
  ch public.trade_channels := trade_private.lock_mine(p_channel, me);
  v_id text;
  v_since bigint;
  v_ref jsonb;
begin
  perform trade_private.require_joined(ch);
  if p_pet is null or jsonb_typeof(p_pet) <> 'object'
     or octet_length(p_pet::text) > trade_private.rule('offer_max_bytes')
     or jsonb_typeof(p_pet -> 'species') is distinct from 'string'
     or jsonb_typeof(p_pet -> 'level') is distinct from 'number' then
    raise exception 'TRADE_OFFER_INVALID';
  end if;
  if jsonb_typeof(p_ref) is distinct from 'object' or jsonb_typeof(p_ref -> 'id') is distinct from 'string' then
    raise exception 'TRADE_OFFER_INVALID';
  end if;
  v_id := p_ref ->> 'id';
  v_since := cloud_private.since_of(p_ref -> 'since');
  if length(v_id) = 0 or length(v_id) > 32 or v_since is null then
    raise exception 'TRADE_OFFER_INVALID';
  end if;
  if exists (select 1 from cloud_private.pet_ledger l where l.pet_since = v_since and l.pet_id = v_id) then
    raise exception 'TRADE_PET_TRADED';
  end if;
  if not exists (
    select 1
    from public.cloud_saves s
    cross join lateral jsonb_array_elements(cloud_private.pets_of(s.save)) p
    where s.user_id = me
      and p ->> 'id' = v_id
      and cloud_private.since_of(p -> 'since') = v_since
      and p -> 'species' = p_pet -> 'species'
      and coalesce(p -> 'shiny', 'false'::jsonb) = coalesce(p_pet -> 'shiny', 'false'::jsonb)
      and (p -> 'nature') is not distinct from (p_pet -> 'nature')
  ) then
    raise exception 'TRADE_PET_NOT_SYNCED';
  end if;
  v_ref := jsonb_build_object('id', v_id, 'since', v_since);

  -- 교환 중 예약(D31). 같은 채널에서 다른 개체로 바꾸면 내 이전 예약을 푼다
  --   지문이 비어 있거나, 같은 채널의 내 예약이거나, 예약한 채널이 활성이 아니면 가져온다
  --   두 채널이 동시에 같은 지문을 넣으면 기본 키 대기로 줄을 서고, 뒤쪽은 앞쪽의 활성 채널을 보고 BUSY 가 된다
  --   BUSY 로 끝나면 함수 전체가 되돌아가므로 이전 예약과 이전 제안이 그대로 남는다
  delete from trade_private.pet_offers o
    where o.channel_id = ch.id and o.user_id = me and (o.pet_since, o.pet_id) is distinct from (v_since, v_id);
  insert into trade_private.pet_offers as o (pet_since, pet_id, channel_id, user_id)
    values (v_since, v_id, ch.id, me)
    on conflict (pet_since, pet_id) do update
      set channel_id = excluded.channel_id, user_id = excluded.user_id, created_at = now()
      where (o.channel_id = excluded.channel_id and o.user_id = excluded.user_id)
         or not exists (
           select 1 from public.trade_channels c
           where c.id = o.channel_id and c.status in ('open', 'joined') and c.expires_at > now()
         );
  if not found then
    raise exception 'TRADE_PET_BUSY';
  end if;

  update public.trade_channels c
    set host_offer = case when me = c.host then p_pet else c.host_offer end,
        guest_offer = case when me = c.guest then p_pet else c.guest_offer end,
        host_ref = case when me = c.host then v_ref else c.host_ref end,
        guest_ref = case when me = c.guest then v_ref else c.guest_ref end,
        offer_rev = c.offer_rev + 1
    where c.id = ch.id
    returning * into ch;
  perform trade_private.notify(ch);
  return ch.offer_rev;
end;
$$;

-- 확정한다. p_rev 가 null 이면 확정을 푼다. 둘 다 같은 판에 확정하면 완료다
--   완료하면 양쪽 지문을 원장에 남긴다. 지문 없는 제안(옛 앱)으로는 확정하지 못한다
create or replace function public.set_ready(p_channel uuid, p_rev int)
returns public.trade_status
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := trade_private.require_member();
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
  if ch.host_ref is null or ch.guest_ref is null then
    raise exception 'TRADE_VERSION_MISMATCH';
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
  if ch.status = 'done' then
    -- 계정이 지워져 host·guest 가 빈 쪽은 남기지 않는다(계정 삭제는 열린 교환이 있으면 거절하므로 드물다)
    -- 지문이 이미 원장에 있으면(다른 채널이 먼저 끝남) TRADE_PET_TRADED 로 완료 전체를 되돌린다(검수 C1)
    --   제안 단계의 예약(D31)이 먼저 막으므로 여기는 마지막 안전장치다. 완료로 바뀌면 트리거가 예약을 푼다
    --   동시에 끝나는 두 채널은 기본 키 대기로 줄을 선다. 먼저 커밋한 쪽만 완료되고 뒤쪽은 충돌로 거부된다
    begin
      insert into cloud_private.pet_ledger (pet_since, pet_id, from_user, channel_id, species, done_at)
        select (r ->> 'since')::bigint, r ->> 'id', who, ch.id, sp, ch.done_at
        from (values (ch.host_ref, ch.host, ch.host_offer ->> 'species'),
                     (ch.guest_ref, ch.guest, ch.guest_offer ->> 'species')) v(r, who, sp)
        where who is not null;
    exception when unique_violation then
      raise exception 'TRADE_PET_TRADED';
    end;
  end if;
  perform trade_private.notify(ch);
  return ch.status;
end;
$$;

-- ── 정리 (7절) ─────────────────────────────────────────────────────────────────
-- 익명 사용자를 지운다. 공통: 열린(open·joined) 채널이 없고, 반영하지 않은 done 채널이 없다
--   (a) 저장 행이 없고 만든 지 30일
--   (b) 저장 행이 있고 진행이 없으며 마지막 활동(last_seen, 없으면 updated_at)이 30일 전
--   (c) 진행이 있고 마지막 활동이 1년 전
-- last_sign_in_at 은 보지 않는다 — 토큰 갱신만으로는 활동이 아니다
create or replace function trade_private.cleanup_anonymous_users() returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  delete from auth.users u
  where coalesce(u.is_anonymous, false)
    and not exists (select 1 from public.trade_channels c where u.id in (c.host, c.guest) and c.status in ('open', 'joined'))
    and not exists (
      select 1 from public.trade_channels c
      where c.status = 'done'
        and ((c.host = u.id and c.host_applied_at is null) or (c.guest = u.id and c.guest_applied_at is null))
    )
    and (
      (not exists (select 1 from public.cloud_saves s where s.user_id = u.id)
       and u.created_at < now() - interval '30 days')
      or exists (
        select 1 from public.cloud_saves s
        where s.user_id = u.id
          and coalesce(s.last_seen, s.updated_at)
              < now() - case when cloud_private.has_progress(s.save) then interval '1 year' else interval '30 days' end
      )
    );
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── 실행 권한 ──────────────────────────────────────────────────────────────────
revoke execute on all functions in schema cloud_private from public, anon, authenticated;
revoke execute on all functions in schema trade_private from public, anon, authenticated;
revoke execute on function
  public.begin_handoff(), public.adopt_anonymous(text), public.set_offer(uuid, jsonb, jsonb)
  from public, anon;
grant execute on function
  public.begin_handoff(), public.adopt_anonymous(text), public.set_offer(uuid, jsonb, jsonb)
  to authenticated;
