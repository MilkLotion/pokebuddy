-- 랜덤 배틀 서버 E3 (worklog/records/battle-server/battle-server.md "E3 서버 설계", docs/specs/adventure.md "서버")
--   battle_entries  상대 후보 — 저장을 올릴 때 배틀 파티를 자동 등록한다(upload-save → battle_register)
--   battle_offers   보인 3개 — 새로고침하면 바꾸고, 판을 시작하면 지운다
--   battles         판과 보상 원장 — 서버 저장 검증이 보상을 대조한다(save_verify_context 의 battles)
--   battle_events   판의 이벤트 목록
-- 표는 cloud_private 에 둔다. 함수(battle-offer·battle-start·upload-save)가 서비스 롤로 아래 RPC 만 부른다

create table cloud_private.battle_entries (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  party      jsonb not null,           -- 칸 6개: { species, form, moveSwap, level } 또는 null — 서버 저장에서 만든다
  updated_at timestamptz not null default now()
);

create table cloud_private.battle_offers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  offer_id   uuid not null default gen_random_uuid(),
  picks      jsonb not null,           -- [{ user_id, party }] 최대 3개 — 보일 때의 모습으로 고정한다
  created_at timestamptz not null default now()
);

create table cloud_private.battles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  opponent_id uuid,                    -- 상대가 계정을 지워도 판은 남는다
  kst_day     date not null,           -- 한국 시간 날짜 — 그날 첫 배틀 판정
  seed        bigint not null,
  winner      smallint,                -- 0 이 건 쪽(user_id), 1 이 상대, null 은 무승부
  timeout     boolean not null,
  end_ms      int not null,
  reward      int not null,
  data_hash   text not null,           -- 엔진·데이터 지문 (supabase/functions/_shared/battle/battle-data.json hash)
  sides       jsonb not null,          -- 두 쪽 칸 6개 — 전투 개체를 만든 개체 정보
  created_at  timestamptz not null default now()
);
create index battles_user on cloud_private.battles (user_id, created_at desc);

create table cloud_private.battle_events (
  battle_id uuid primary key references cloud_private.battles(id) on delete cascade,
  events    jsonb not null
);

alter table cloud_private.battle_entries enable row level security;
alter table cloud_private.battle_offers enable row level security;
alter table cloud_private.battles enable row level security;
alter table cloud_private.battle_events enable row level security;
revoke all on table cloud_private.battle_entries, cloud_private.battle_offers, cloud_private.battles, cloud_private.battle_events from public, anon, authenticated;

-- 등록 — 저장을 받아들인 뒤 upload-save 가 부른다. party 가 null 이면 등록을 지운다
create function public.battle_register(p_user uuid, p_party jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_party is null then
    delete from cloud_private.battle_entries where user_id = p_user;
  else
    insert into cloud_private.battle_entries (user_id, party, updated_at) values (p_user, p_party, now())
      on conflict (user_id) do update set party = excluded.party, updated_at = now();
  end if;
end;
$$;

-- 배틀 문맥 — 서버 저장, 정지 여부, 마지막 판 시각과 남은 쿨타임
create function public.battle_context(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  last_at timestamptz;
  cool int := cloud_private.setting('battle_cooldown_sec', '300')::int;
begin
  select max(b.created_at) into last_at from cloud_private.battles b where b.user_id = p_user;
  return jsonb_build_object(
    'held', cloud_private.is_held(p_user),
    'save', (select c.save from public.cloud_saves c where c.user_id = p_user),
    'cooldown_ms', case when last_at is null then 0
                        else greatest(0, floor(extract(epoch from (last_at + make_interval(secs => cool) - now())) * 1000)) end);
end;
$$;

-- 상대 3개 — 자기 빼고 무작위. 1초에 한 번만. 보인 파티를 고정해 둔다
create function public.battle_offer_make(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prev timestamptz;
  v_picks jsonb;
  v_offer uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtext('battle:' || p_user::text));
  select o.created_at into prev from cloud_private.battle_offers o where o.user_id = p_user;
  if prev is not null and now() - prev < interval '1 second' then raise exception 'BATTLE_TOO_FAST'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', e.user_id, 'party', e.party)), '[]'::jsonb) into v_picks
    from (select x.user_id, x.party from cloud_private.battle_entries x where x.user_id <> p_user order by random() limit 3) e;
  insert into cloud_private.battle_offers (user_id, offer_id, picks, created_at) values (p_user, v_offer, v_picks, now())
    on conflict (user_id) do update set offer_id = excluded.offer_id, picks = excluded.picks, created_at = excluded.created_at;
  return jsonb_build_object('offer_id', v_offer, 'picks', v_picks);
end;
$$;

-- 보인 3개 가운데 하나 — 지금 offer 가 아니면 null
create function public.battle_offer_get(p_user uuid, p_offer uuid, p_pick int)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select o.picks -> (p_pick - 1) from cloud_private.battle_offers o
    where o.user_id = p_user and o.offer_id = p_offer and p_pick between 1 and jsonb_array_length(o.picks);
$$;

-- 판 기록 — 쿨타임·offer 를 다시 보고(동시 요청 막기), 보상을 정하고, offer 를 지운다
--   보상: 오늘(한국 시간) 첫 판 500, 아니면 이기면 50·지거나 비기면 10 (docs/specs/balance.md "배틀 보상")
create function public.battle_record(p_user uuid, p_offer uuid, p_pick int, p_opponent uuid, p_seed bigint, p_winner smallint,
                                     p_timeout boolean, p_end_ms int, p_data_hash text, p_sides jsonb, p_events jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cool int := cloud_private.setting('battle_cooldown_sec', '300')::int;
  last_at timestamptz;
  day date := (now() at time zone 'Asia/Seoul')::date;
  v_reward int;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('battle:' || p_user::text));
  if cloud_private.is_held(p_user) then raise exception 'CLOUD_ACCOUNT_HELD'; end if;
  select max(b.created_at) into last_at from cloud_private.battles b where b.user_id = p_user;
  if last_at is not null and now() < last_at + make_interval(secs => cool) then raise exception 'BATTLE_COOLDOWN'; end if;
  if public.battle_offer_get(p_user, p_offer, p_pick) is null then raise exception 'BATTLE_OFFER_GONE'; end if;
  if not exists (select 1 from cloud_private.battles b where b.user_id = p_user and b.kst_day = day) then v_reward := 500;
  elsif p_winner = 0 then v_reward := 50;
  else v_reward := 10;
  end if;
  insert into cloud_private.battles (user_id, opponent_id, kst_day, seed, winner, timeout, end_ms, reward, data_hash, sides)
    values (p_user, p_opponent, day, p_seed, p_winner, p_timeout, p_end_ms, v_reward, p_data_hash, p_sides)
    returning id into v_id;
  insert into cloud_private.battle_events (battle_id, events) values (v_id, p_events);
  delete from cloud_private.battle_offers where user_id = p_user;
  return jsonb_build_object('battle_id', v_id, 'reward', v_reward);
end;
$$;

revoke all on function public.battle_register(uuid, jsonb), public.battle_context(uuid), public.battle_offer_make(uuid),
  public.battle_offer_get(uuid, uuid, int),
  public.battle_record(uuid, uuid, int, uuid, bigint, smallint, boolean, int, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.battle_register(uuid, jsonb), public.battle_context(uuid), public.battle_offer_make(uuid),
  public.battle_offer_get(uuid, uuid, int),
  public.battle_record(uuid, uuid, int, uuid, bigint, smallint, boolean, int, text, jsonb, jsonb) to service_role;

-- 서버 저장 검증 — 이 사용자의 판 보상(battles)을 싣는다. 새 저장의 battleRewards 에 새로 들어온 판 id 를 여기서 찾는다
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
  battles jsonb;
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
  select coalesce(jsonb_agg(r.offer order by r.done_at), '[]'::jsonb) into received
    from cloud_private.trade_receipts r
    where r.user_id = p_user and since is not null and r.done_at > since;
  select coalesce(jsonb_object_agg(r.channel_id::text, r.offer), '{}'::jsonb) into received_before
    from cloud_private.trade_receipts r
    where r.user_id = p_user and since is not null and r.done_at <= since and r.done_at > since - interval '30 days';
  -- 배틀 보상(E3) — 판 id → 포인트, 최근 200판
  select coalesce(jsonb_object_agg(x.id::text, x.reward), '{}'::jsonb) into battles
    from (select b.id, b.reward from cloud_private.battles b where b.user_id = p_user order by b.created_at desc limit 200) x;
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
    'held', cloud_private.is_held(p_user),
    'battles', battles);
end;
$$;
