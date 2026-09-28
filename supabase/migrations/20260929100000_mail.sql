-- 우편함 — 모든 사용자에게 보내는 편지와 선물. 편지마다 계정당 한 번만 받는다
-- 설계: worklog/records/post-box/record.md "구현 설계" (2026-09-29 사용자 "a안으로 진행", "개발진행")
--   편지는 관리자가 service role 로 넣는다(admin/admin.cjs mail send). 앱은 아래 함수 둘만 부른다
--   선물이 빈 배열이면 공지 편지다. 받을 것이 없어 받기 기록도 없다
--   선물 값을 저장에 넣는 일은 앱이 한다. 받은 기록이 있는데 앱 저장에 없으면(끊김) 같은 선물을 다시 받아 넣는다

create table public.mail_letters (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 60),
  body       text not null default '' check (char_length(body) <= 1000),
  sender     text not null default 'PokeBuddy' check (char_length(sender) between 1 and 30),
  -- [{"kind":"item","id":"exp-candy-m","count":3}, {"kind":"points","count":500}]
  gifts      jsonb not null default '[]' check (jsonb_typeof(gifts) = 'array' and jsonb_array_length(gifts) <= 10),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,                       -- 없으면 기한 없음. 지나면 받지 못하고 목록에서도 빠진다(받은 편지는 남는다)
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table public.mail_claims (
  letter_id  uuid not null references public.mail_letters(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (letter_id, user_id)
);

alter table public.mail_letters enable row level security;
alter table public.mail_claims enable row level security;
revoke all on public.mail_letters, public.mail_claims from anon, authenticated;
-- 정책을 두지 않는다. 읽기·받기는 아래 함수만 한다

-- 지금 보이는 편지 — 시작했고, 기간 안이거나 내가 받은 것. 최근 순 50개
-- 로그인하지 않아도 부른다. 그때 받은 시각은 비어 있다
create function public.list_mail()
returns table (id uuid, title text, body text, sender text, gifts jsonb, starts_at timestamptz, ends_at timestamptz, claimed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.id, l.title, l.body, l.sender, l.gifts, l.starts_at, l.ends_at, c.claimed_at
  from public.mail_letters l
  left join public.mail_claims c on c.letter_id = l.id and c.user_id = auth.uid()
  where l.starts_at <= now() and (l.ends_at is null or l.ends_at > now() or c.claimed_at is not null)
  order by l.starts_at desc
  limit 50;
$$;

-- 편지의 선물을 받는다. 정식 계정만(익명 계정은 로그아웃하면 새로 생겨 여러 번 받을 수 있다)
-- 이미 받았으면 같은 선물을 다시 돌려준다 — 앱이 저장에 넣기 전에 끊겼을 때 다시 넣는다. 앱은 편지 id 로 두 번 넣지 않는다
create function public.claim_mail(p_letter uuid)
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
  select * into l from public.mail_letters m where m.id = p_letter;
  if not found or l.starts_at > now() then
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

revoke all on function public.list_mail() from public;
revoke all on function public.claim_mail(uuid) from public, anon; -- Supabase 기본 권한이 anon 에도 준다
grant execute on function public.list_mail() to anon, authenticated;
grant execute on function public.claim_mail(uuid) to authenticated;
