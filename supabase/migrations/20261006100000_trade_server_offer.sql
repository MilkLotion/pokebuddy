-- 교환 제안을 서버 저장에서 만든다 P5 (worklog/records/cloud-authority/cloud-authority.md "P5", 설계 S6)
--   set_offer: 지문(id·since)으로 찾은 서버 저장 개체로 제안을 만들어 채널에 넣는다. 앱이 보낸 p_pet 은 올렸는지 확인하는 데만 쓴다
--     (종·이로치·성격이 다르면 TRADE_PET_NOT_SYNCED). 레벨·경험치·친밀도 등은 보내는 PC 가 정하지 못한다
--   save_verify_context: 받은 제안(received·received_before)을 싣는다 — 서버 검증이 받은 개체를 제안과 대조한다
--   받은 제안은 교환이 끝나는 순간 cloud_private.trade_receipts 에 남긴다 — 두 사람이 반영하면(ack_applied) 채널의 제안 값이 지워지기 때문이다

create table cloud_private.trade_receipts (
  channel_id uuid not null,
  user_id    uuid not null,          -- 받은 사람
  offer      jsonb not null,         -- 받은 제안 — 상대가 낸 서버 저장 값
  done_at    timestamptz not null,
  primary key (channel_id, user_id)
);
alter table cloud_private.trade_receipts enable row level security;
revoke all on table cloud_private.trade_receipts from public, anon, authenticated;
create index trade_receipts_user on cloud_private.trade_receipts (user_id, done_at desc);

-- 채널이 done 이 되면 두 사람의 받은 제안을 남긴다
create function cloud_private.keep_trade_receipts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    if new.host is not null and new.guest_offer is not null then
      insert into cloud_private.trade_receipts (channel_id, user_id, offer, done_at)
        values (new.id, new.host, new.guest_offer, coalesce(new.done_at, now())) on conflict do nothing;
    end if;
    if new.guest is not null and new.host_offer is not null then
      insert into cloud_private.trade_receipts (channel_id, user_id, offer, done_at)
        values (new.id, new.guest, new.host_offer, coalesce(new.done_at, now())) on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function cloud_private.keep_trade_receipts() from public, anon, authenticated;
create trigger trade_channels_keep_receipts after update of status on public.trade_channels
  for each row execute function cloud_private.keep_trade_receipts();

-- 이 마이그레이션 전에 끝났고 제안 값이 아직 남은 채널을 채운다(검수 P5 M4). 두 사람이 이미 반영해 지워진 채널은 채울 수 없다
insert into cloud_private.trade_receipts (channel_id, user_id, offer, done_at)
  select c.id, c.host, c.guest_offer, coalesce(c.done_at, now()) from public.trade_channels c
    where c.status = 'done' and c.host is not null and c.guest_offer is not null
  union all
  select c.id, c.guest, c.host_offer, coalesce(c.done_at, now()) from public.trade_channels c
    where c.status = 'done' and c.guest is not null and c.host_offer is not null
  on conflict do nothing;

create or replace function public.set_offer(p_channel uuid, p_pet jsonb, p_ref jsonb)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := trade_private.require_member();
  ch public.trade_channels := trade_private.lock_mine(p_channel, me);
  v_id text;
  v_since bigint;
  v_ref jsonb;
  v_pet jsonb; -- 서버 저장의 그 개체
  v_offer jsonb; -- 채널에 넣을 제안 — 서버 저장 값으로 만든다(P5)
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
  -- 서버 저장에서 그 개체를 찾는다. 앱이 보낸 값과 종·이로치·성격이 다르면 아직 올리지 않은 진행이다(NOT_SYNCED)
  select p into v_pet
    from public.cloud_saves s
    cross join lateral jsonb_array_elements(cloud_private.pets_of(s.save)) p
    where s.user_id = me
      and p ->> 'id' = v_id
      and cloud_private.since_of(p -> 'since') = v_since
      and p -> 'species' = p_pet -> 'species'
      and coalesce(p -> 'shiny', 'false'::jsonb) = coalesce(p_pet -> 'shiny', 'false'::jsonb)
      and (p -> 'nature') is not distinct from (p_pet -> 'nature')
    limit 1;
  if v_pet is null then
    raise exception 'TRADE_PET_NOT_SYNCED';
  end if;
  -- 앱이 보낸 레벨·경험치가 서버 값보다 크면 아직 올리지 않은 진행이다 — 옛 서버 값으로 제안하지 않고 다시 올리게 한다(검수 P5 M3)
  if coalesce((p_pet ->> 'level')::numeric, 0) > coalesce((v_pet ->> 'level')::numeric, 0)
     or (p_pet ? 'exp' and coalesce((p_pet ->> 'exp')::numeric, 0) > coalesce((v_pet ->> 'exp')::numeric, 0)) then
    raise exception 'TRADE_PET_NOT_SYNCED';
  end if;
  -- 검증받지 않은 저장(첫 저장 분류·관찰 모드 위반으로 unverified)은 제안의 근거가 되지 못한다 — 부풀린 개체를 교환으로 세탁하지 못하게(검수 P5 H1)
  if exists (select 1 from public.cloud_saves s where s.user_id = me and s.trust = 'unverified') then
    raise exception 'TRADE_SAVE_UNVERIFIED';
  end if;
  -- 제안 값은 서버 저장 개체로 만든다(P5) — 레벨·경험치·친밀도 등을 보내는 PC 가 정하지 못한다. 모양은 src/trade/core.ts TradePet
  v_offer := jsonb_strip_nulls(jsonb_build_object(
    'species', v_pet -> 'species',
    'shiny', coalesce(v_pet -> 'shiny', 'false'::jsonb),
    'nature', v_pet -> 'nature',
    'gender', v_pet -> 'gender',
    'size', v_pet -> 'size',
    'level', v_pet -> 'level',
    'exp', v_pet -> 'exp',
    'affinity', v_pet -> 'affinity',
    'fullness', v_pet -> 'fullness',
    'mood', v_pet -> 'mood',
    'stage', coalesce(v_pet -> 'stage', '0'::jsonb),
    'evolved', coalesce(v_pet -> 'evolved', '[]'::jsonb)));
  if octet_length(v_offer::text) > trade_private.rule('offer_max_bytes') then
    raise exception 'TRADE_OFFER_INVALID';
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
    set host_offer = case when me = c.host then v_offer else c.host_offer end,
        guest_offer = case when me = c.guest then v_offer else c.guest_offer end,
        host_ref = case when me = c.host then v_ref else c.host_ref end,
        guest_ref = case when me = c.guest then v_ref else c.guest_ref end,
        offer_rev = c.offer_rev + 1
    where c.id = ch.id
    returning * into ch;
  perform trade_private.notify(ch);
  return ch.offer_rev;
end;
$$;


-- 문맥에 받은 제안을 더한다 — 나머지는 20261005100000_account_holds.sql 과 같다
create or replace function public.save_verify_context(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.cloud_saves;
  since timestamptz;
  letters jsonb;
  trades int;
  before jsonb;
  received jsonb;
  received_before jsonb;
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
  -- 받은 제안(P5) — 교환이 끝날 때 남긴 상대 제안(trade_receipts). 받은 개체는 이 값과 같아야 한다
  select coalesce(jsonb_agg(r.offer order by r.done_at), '[]'::jsonb) into received
    from cloud_private.trade_receipts r
    where r.user_id = p_user and since is not null and r.done_at > since;
  select coalesce(jsonb_object_agg(r.channel_id::text, r.offer), '{}'::jsonb) into received_before
    from cloud_private.trade_receipts r
    where r.user_id = p_user and since is not null and r.done_at <= since and r.done_at > since - interval '30 days';
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
    'received', received,
    'received_before', received_before,
    'seed', (select a.seed from cloud_private.account_seeds a where a.user_id = p_user and since is not null and a.created_at <= since),
    'held', cloud_private.is_held(p_user));
end;
$$;

