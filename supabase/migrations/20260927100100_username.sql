-- 아이디 로그인 — 아이디를 메일이 갈 수 없는 내부 주소로 바꿔 쓴다
-- 설계: docs/work/trade/trade.md "계정과 로그인 > 아이디와 비밀번호"
--   내부 주소는 <아이디>@id.pokebuddy.invalid 다. .invalid 는 메일이 갈 수 없는 예약 도메인이다
--   아이디는 영어 소문자·숫자·밑줄, 4~16자, 영문으로 시작(2026-09-27 사용자 결정 "id는 영어만")
--   이름(display_name)은 한글 가능, 1~12자, 중복 허용

create schema if not exists auth_private;
revoke all on schema auth_private from public, anon, authenticated;

create function auth_private.id_domain() returns text
language sql immutable set search_path = '' as $$
  select 'id.pokebuddy.invalid';
$$;

create function auth_private.reserved_usernames() returns text[]
language sql immutable set search_path = '' as $$
  select array['admin', 'administrator', 'pokebuddy', 'support', 'system', 'root', 'official', 'moderator'];
$$;

-- 아이디 규칙 검사. 규칙 밖이면 null, 맞으면 소문자로 바꾼 아이디
create function auth_private.normalize_username(username text) returns text
language sql immutable set search_path = '' as $$
  select case when lower(username) ~ '^[a-z][a-z0-9_]{3,15}$' then lower(username) end;
$$;

-- 입력 중 중복검사. 가입할 때의 최종 판정은 아래 트리거와 인증 서버가 한다
create function public.is_username_available(username text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  name text := auth_private.normalize_username(username);
begin
  if name is null then
    raise exception 'AUTH_USERNAME_INVALID';
  end if;
  if name = any (auth_private.reserved_usernames()) then
    return false;
  end if;
  return not exists (
    select 1 from auth.users u where lower(u.email) = name || '@' || auth_private.id_domain()
  );
end;
$$;

revoke execute on function public.is_username_available(text) from public, anon;
grant execute on function public.is_username_available(text) to authenticated;

-- 가입 전 검사 — 가입 요청은 인증 서버로 바로 가므로 함수 검사를 거치지 않는다(L-01)
-- 내부 주소로 가입하면 아이디 규칙·예약어·이름 규칙을 다시 본다. GitHub 가입은 건드리지 않는다
create function auth_private.check_username_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  local_part text;
  shown text;
begin
  if new.email is null or lower(new.email) not like '%@' || auth_private.id_domain() then
    return new;
  end if;
  local_part := split_part(lower(new.email), '@', 1);
  if auth_private.normalize_username(local_part) is null then
    raise exception 'AUTH_USERNAME_INVALID';
  end if;
  if local_part = any (auth_private.reserved_usernames()) then
    raise exception 'AUTH_USERNAME_RESERVED';
  end if;
  shown := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if length(shown) < 1 or length(shown) > 12 or shown ~ '[[:cntrl:]]' then
    raise exception 'AUTH_NAME_INVALID';
  end if;
  return new;
end;
$$;

create trigger check_username_signup
  before insert on auth.users
  for each row execute function auth_private.check_username_signup();

revoke execute on all functions in schema auth_private from public, anon, authenticated;
