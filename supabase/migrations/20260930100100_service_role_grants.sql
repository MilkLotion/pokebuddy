-- 관리자 CLI(service role) 표 권한 — 운영 DB 에는 기본 권한이 붙지 않아 명시한다
-- 2026-09-30 확인: 운영에서 service_role 이 네 표에 REFERENCES·TRIGGER·TRUNCATE 만 있어 admin/admin.cjs 조회·편지 보내기가 permission denied
--   로컬 DB 는 기본 권한으로 이미 있다. 여기서 다시 줘도 바뀌지 않는다
--   anon·authenticated 는 그대로 막아 둔다. 앱은 함수로만 읽고 쓴다

grant select, insert, update, delete on
  public.cloud_saves,
  public.mail_letters,
  public.mail_claims,
  public.trade_channels
to service_role;
