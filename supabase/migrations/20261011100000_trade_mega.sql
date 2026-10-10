-- 교환 제안에 메가스톤을 싣는다 (2026-10-11 사용자 "고유개체에 메가진화했냐안했냐로 … 교환해도 유지되게" → B안).
--   set_offer 는 20261006100000_trade_server_offer.sql 그대로에 mega 한 칸만 더한다 — 서버 저장 개체가 메가스톤을 지녔으면 { stone, bondMs, care }.
--   모습(on)은 싣지 않는다. 받는 앱은 원래 모습으로 받는다 (src/trade/exchange.ts TradePet.mega). 옛 앱은 이 칸을 모르고 버린다
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
    'evolved', coalesce(v_pet -> 'evolved', '[]'::jsonb),
    'mega', case when v_pet -> 'mega' ->> 'stone' = 'true' then jsonb_build_object(
      'stone', true,
      'bondMs', coalesce(v_pet -> 'mega' -> 'bondMs', '0'::jsonb),
      'care', coalesce(v_pet -> 'mega' -> 'care', '0'::jsonb)) end));
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
