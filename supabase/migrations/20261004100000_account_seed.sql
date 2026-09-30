-- 계정 시드 P4b — 알 결과를 계정마다 정해진 난수로 정한다 (worklog/records/cloud-authority/record.md "P4b 서버 시드", D24)
--   앱은 account_seed() 로 자기 계정 시드를 받아 cloud.json 에 둔다(오프라인에서도 쓴다). 알 id 를 키로 결정적 난수를 낸다(src/verify/save-rules.ts seededRand)
--   서버 검증(upload-save)은 save_verify_context 의 seed 로 열린 알의 결과를 다시 계산해 새 저장과 대조한다(egg-roll)
--   시드는 처음 요청 때 만든다. 시드가 없는 계정(아직 한 번도 받지 않음)은 알 결과를 대조하지 않는다
--   직전에 받은 저장보다 나중에 만든 시드도 싣지 않는다 — 앱이 시드를 받기 전에 연 알(보통 난수)을 대조하지 않게(검수 P4b H2)
--   한계: 시드는 사용자 PC 에 있으므로 다음 알 결과를 미리 계산할 수는 있다. 바꿀 수는 없다

create table cloud_private.account_seeds (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  seed       text not null,
  created_at timestamptz not null default now()
);
alter table cloud_private.account_seeds enable row level security;

-- 자기 계정 시드 — 없으면 만든다(uuid v4 둘을 이어 붙인 64자. 난수는 결국 32비트로 줄여 쓴다)
create function public.account_seed()
returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := cloud_private.require_account();
  v text;
begin
  insert into cloud_private.account_seeds (user_id, seed)
    values (me, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
    on conflict (user_id) do nothing;
  select a.seed into v from cloud_private.account_seeds a where a.user_id = me;
  return v;
end;
$$;
revoke all on function public.account_seed() from public, anon;
grant execute on function public.account_seed() to authenticated;

-- 문맥에 시드를 더한다 — 나머지는 20261003100000_save_verify.sql 과 같다
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
    'seed', (select a.seed from cloud_private.account_seeds a where a.user_id = p_user and since is not null and a.created_at <= since));
end;
$$;

