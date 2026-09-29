-- 우편함 받는 사람 — 편지를 한 계정에게만 보낸다
-- 설계: worklog/records/post-box/record.md "받는 사람 지정" (2026-09-30 사용자 "특정id를 기반으로 특정사람한데만 보내는 기능도 있어야", "그렇게 해")
--   recipient 가 비어 있으면 지금처럼 모든 사용자 편지다
--   받는 사람이 정해진 편지는 그 계정의 목록에만 보이고, 그 계정만 받는다
--   관리자는 admin/admin.cjs mail send --to <아이디> 로 넣는다

alter table public.mail_letters
  add column recipient uuid references auth.users(id) on delete cascade;

create index mail_letters_recipient_idx on public.mail_letters (recipient) where recipient is not null;

-- 지금 보이는 편지 — 모든 사용자 편지와 나에게 온 편지. 시작했고, 기간 안이거나 내가 받은 것. 최근 순 50개
-- 로그인하지 않으면 auth.uid() 가 비어 모든 사용자 편지만 보인다
create or replace function public.list_mail()
returns table (id uuid, title text, body text, sender text, gifts jsonb, starts_at timestamptz, ends_at timestamptz, claimed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.id, l.title, l.body, l.sender, l.gifts, l.starts_at, l.ends_at, c.claimed_at
  from public.mail_letters l
  left join public.mail_claims c on c.letter_id = l.id and c.user_id = auth.uid()
  where l.starts_at <= now()
    and (l.recipient is null or l.recipient = auth.uid())
    and (l.ends_at is null or l.ends_at > now() or c.claimed_at is not null)
  order by l.starts_at desc
  limit 50;
$$;

-- 편지의 선물을 받는다. 정식 계정만. 남에게 온 편지는 없는 것과 같다
-- 이미 받았으면 같은 선물을 다시 돌려준다 — 앱이 저장에 넣기 전에 끊겼을 때 다시 넣는다
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

-- create or replace 는 권한을 유지한다. 처음 마이그레이션과 같은 권한을 다시 적어 둔다
revoke all on function public.list_mail() from public;
revoke all on function public.claim_mail(uuid) from public, anon;
grant execute on function public.list_mail() to anon, authenticated;
grant execute on function public.claim_mail(uuid) to authenticated;
