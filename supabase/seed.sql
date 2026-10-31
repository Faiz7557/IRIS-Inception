-- Local dev only (seed.sql never runs on a hosted project).
-- Send-SMS hook: instead of calling Twilio, store the OTP so any phone number can sign in locally.
-- Read the latest code: select phone, otp from public.dev_sms_outbox order by created_at desc limit 5;

create table if not exists public.dev_sms_outbox (
  id bigserial primary key,
  phone text not null,
  otp text not null,
  created_at timestamptz not null default now()
);
alter table public.dev_sms_outbox enable row level security;  -- only the auth hook may write; anon/authenticated see nothing
drop policy if exists dev_sms_outbox_auth_insert on public.dev_sms_outbox;
create policy dev_sms_outbox_auth_insert on public.dev_sms_outbox
  for insert to supabase_auth_admin with check (true);

create or replace function public.dev_send_sms(event jsonb)
returns jsonb
language plpgsql
as $$
begin
  insert into public.dev_sms_outbox (phone, otp)
  values (event->'user'->>'phone', event->'sms'->>'otp');
  return '{}'::jsonb;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant insert on public.dev_sms_outbox to supabase_auth_admin;
grant usage on sequence public.dev_sms_outbox_id_seq to supabase_auth_admin;
grant execute on function public.dev_send_sms(jsonb) to supabase_auth_admin;
revoke execute on function public.dev_send_sms(jsonb) from authenticated, anon, public;
