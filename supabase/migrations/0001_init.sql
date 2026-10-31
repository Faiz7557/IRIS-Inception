-- gen_random_uuid() tersedia bawaan di PG13+; pg_cron diaktifkan dari dashboard Supabase (Database > Extensions)
create extension if not exists pg_cron;

create type public.incident_type as enum
  ('kebakaran', 'kecelakaan', 'sakit', 'kejahatan', 'kdrt', 'bencana', 'umum');

create type public.call_state as enum
  ('SIAGA', 'MEMANGGIL', 'PEMBUKA', 'MENDENGAR', 'MENYEDERHANAKAN',
   'MENUNGGU_JAWABAN', 'MEMBACAKAN', 'FALLBACK', 'SELESAI');

create type public.call_mode as enum ('latihan', 'simulasi', 'produksi');

create type public.end_reason as enum
  ('operator_hangup', 'user_cancel', 'fallback_exhausted', 'user_link_lost', 'error');

create type public.utterance_kind as enum
  ('ya_tidak', 'angka', 'lokasi', 'pilihan', 'terbuka', 'instruksi', 'info');

create type public.llm_status as enum
  ('ok', 'cache_hit', 'timeout', 'api_error', 'refusal', 'invalid_json', 'invalid_schema', 'skipped');

create type public.answer_action as enum ('ucap', 'kirim_gps', 'ketik', 'ulangi');

create type public.notify_channel as enum ('halaman', 'web_push', 'sms_simulasi');

create type public.notify_status as enum ('antre', 'terkirim', 'gagal');

create type public.user_segment as enum ('A', 'B', 'C', 'D');

create type public.consent_kind as enum ('syarat_layanan', 'data_medis', 'korpus_anonim');

create table public.profiles (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  display_name_enc        bytea,
  address_enc             bytea,
  landmark_enc            bytea,
  medical_notes_enc       bytea,
  blood_type_enc          bytea,
  segment                 public.user_segment not null default 'A',
  practice_mode           boolean not null default true,
  silent_mode             boolean not null default false,
  large_text              boolean not null default false,
  double_tap_sos          boolean not null default false,
  medical_consent_at      timestamptz,
  medical_consent_version text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint medical_requires_consent
    check ((medical_notes_enc is null and blood_type_enc is null) or medical_consent_at is not null)
);

create table public.emergency_contacts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (user_id) on delete cascade,
  name_enc            bytea not null,
  phone_enc           bytea not null,
  relation            text check (char_length(relation) <= 30),
  priority            smallint not null check (priority between 1 and 3),
  status_token_hash   bytea not null unique,          -- sha256(token mentah 32 byte)
  push_subscription   jsonb,                           -- {"endpoint": "...", "keys": {"p256dh": "...", "auth": "..."}}
  push_subscribed_at  timestamptz,
  created_at          timestamptz not null default now(),
  unique (user_id, priority)
);

create table public.devices (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (user_id) on delete cascade,
  device_key_hash  bytea not null,      -- sha256(UUID acak yang disimpan di localStorage perangkat)
  user_agent       text check (char_length(user_agent) <= 300),
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  unique (user_id, device_key_hash)
);

create table public.calls (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.profiles (user_id) on delete cascade,
  device_id              uuid references public.devices (id) on delete set null,
  mode                   public.call_mode not null,
  incident               public.incident_type not null default 'umum',
  state                  public.call_state not null default 'SIAGA',
  attempt_count          smallint not null default 0 check (attempt_count between 0 and 6),
  degradation_max        smallint not null default 0 check (degradation_max between 0 and 5),
  lat                    double precision check (lat between -90 and 90),
  lng                    double precision check (lng between -180 and 180),
  gps_accuracy_m         real check (gps_accuracy_m >= 0),
  location_source        text not null default 'tidak_ada'
                         check (location_source in ('gps', 'profil', 'tidak_ada')),
  sos_confirmed_at       timestamptz not null default now(),
  first_ring_at          timestamptz,
  answered_at            timestamptz,
  opener_done_at         timestamptz,
  location_confirmed_at  timestamptz,
  dispatched_at          timestamptz,
  dispatch_source        text check (dispatch_source in ('keyword', 'console')),
  contacts_notified_at   timestamptz,
  ended_at               timestamptz,
  end_reason             public.end_reason,
  constraint ended_has_reason check ((ended_at is null) = (end_reason is null))
);

create index calls_user_time_idx   on public.calls (user_id, sos_confirmed_at desc);
create index calls_device_time_idx on public.calls (device_id, sos_confirmed_at desc);
create index calls_active_idx      on public.calls (state) where state <> 'SELESAI';

create table public.call_turns (
  id                       bigint generated always as identity primary key,
  call_id                  uuid not null references public.calls (id) on delete cascade,
  turn_no                  smallint not null,
  card_index               smallint not null default 0 check (card_index between 0 and 2),
  card_id                  uuid not null unique,
  operator_transcript      text,
  stt_confidence           real,
  kind                     public.utterance_kind not null,
  card                     jsonb,
  degradation_level        smallint not null default 0 check (degradation_level between 0 and 5),
  llm_status               public.llm_status not null,
  llm_input_tokens         integer,
  llm_output_tokens        integer,
  llm_cache_read_tokens    integer,
  operator_speech_end_at   timestamptz,
  utterance_final_at       timestamptz,
  llm_start_at             timestamptz,
  llm_end_at               timestamptz,
  card_sent_at             timestamptz,
  card_shown_at            timestamptz,
  user_tap_at              timestamptz,
  tap_received_at          timestamptz,
  tts_first_chunk_at       timestamptz,
  tts_first_audio_at       timestamptz,
  answer_option_index      smallint,
  answer_label             text,
  answer_action            public.answer_action,
  answer_spoken            text,
  repeat_requested         boolean not null default false,
  retention_until          timestamptz not null default (now() + interval '30 days'),
  unique (call_id, turn_no, card_index)
);

create index call_turns_call_idx      on public.call_turns (call_id, turn_no, card_index);
create index call_turns_retention_idx on public.call_turns (retention_until);

create table public.call_events (
  id          bigint generated always as identity primary key,
  call_id     uuid not null references public.calls (id) on delete cascade,
  seq         integer not null,
  at          timestamptz not null default now(),
  event       text not null,
  from_state  public.call_state,
  to_state    public.call_state,
  ignored     boolean not null default false,
  payload     jsonb not null default '{}'::jsonb,
  unique (call_id, seq)
);

create index call_events_at_idx on public.call_events (at);

create table public.notifications (
  id          bigint generated always as identity primary key,
  call_id     uuid not null references public.calls (id) on delete cascade,
  contact_id  uuid references public.emergency_contacts (id) on delete set null,
  channel     public.notify_channel not null,
  trigger     text not null check (trigger in ('panggilan_dibuat', 'fallback', 'dispatch', 'selesai')),
  status      public.notify_status not null default 'antre',
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  error       text check (char_length(error) <= 300)
);

create index notifications_call_idx on public.notifications (call_id);

create table public.consent_log (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references public.profiles (user_id) on delete cascade,
  kind      public.consent_kind not null,
  version   text not null,          -- contoh 'medis-v1-2026-10-31'
  granted   boolean not null,
  at        timestamptz not null default now()
);

create index consent_log_user_idx on public.consent_log (user_id, kind, at desc);

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
for each row execute function public.touch_updated_at();

alter table public.profiles            enable row level security;
alter table public.emergency_contacts  enable row level security;
alter table public.devices             enable row level security;
alter table public.calls               enable row level security;
alter table public.call_turns          enable row level security;
alter table public.call_events         enable row level security;
alter table public.notifications       enable row level security;
alter table public.consent_log         enable row level security;

-- Satu-satunya akses klien: membaca riwayat panggilan miliknya (layar Riwayat).
create policy calls_select_own on public.calls
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Tabel lain tidak punya policy untuk anon/authenticated, sehingga tertutup bagi klien.
revoke all on public.profiles, public.emergency_contacts, public.devices,
              public.call_turns, public.call_events, public.notifications,
              public.consent_log
  from anon, authenticated;

create view public.v_turn_latency with (security_invoker = true) as
select
  t.call_id,
  t.turn_no,
  t.card_index,
  t.kind,
  t.llm_status,
  t.degradation_level,
  t.repeat_requested,
  extract(epoch from (t.card_shown_at      - t.operator_speech_end_at)) as latency_a_s,
  extract(epoch from (t.tts_first_audio_at - t.user_tap_at))            as latency_b_s,
  extract(epoch from (t.utterance_final_at - t.operator_speech_end_at)) as stt_s,
  extract(epoch from (t.llm_end_at         - t.llm_start_at))           as llm_s
from public.call_turns t;

create view public.v_call_metrics with (security_invoker = true) as
select
  c.id as call_id,
  c.mode,
  c.incident,
  c.degradation_max,
  c.end_reason,
  extract(epoch from (c.opener_done_at - c.sos_confirmed_at)) as t_info_s,
  extract(epoch from (c.answered_at    - c.sos_confirmed_at)) as t_answer_s,
  extract(epoch from (c.ended_at       - c.answered_at))      as duration_s,
  (select count(*) from public.call_turns t
    where t.call_id = c.id and t.kind <> 'info')              as cards,
  (select count(*) from public.call_turns t
    where t.call_id = c.id and t.repeat_requested)            as repeats
from public.calls c;

create view public.v_metrics_summary with (security_invoker = true) as
select
  count(*)                                                           as turns,
  percentile_disc(0.5) within group (order by latency_a_s)           as latency_a_median_s,
  percentile_disc(0.9) within group (order by latency_a_s)           as latency_a_p90_s,
  percentile_disc(0.5) within group (order by latency_b_s)           as latency_b_median_s,
  avg(case when repeat_requested then 0 else 1 end)                  as share_answered_without_repeat,
  avg(case when degradation_level = 0 then 1 else 0 end)             as share_level0
from public.v_turn_latency
where kind <> 'info';

revoke all on public.v_turn_latency, public.v_call_metrics, public.v_metrics_summary
  from anon, authenticated;

select cron.schedule(
  'j112-retensi-harian',
  '15 20 * * *',               -- 20:15 UTC = 03:15 WIB
  $$
    delete from public.call_turns where retention_until < now();

    update public.call_events
       set payload = '{}'::jsonb
     where at < now() - interval '30 days' and payload <> '{}'::jsonb;

    update public.calls
       set lat = round(lat::numeric, 3)::double precision,
           lng = round(lng::numeric, 3)::double precision
     where ended_at is not null
       and (lat <> round(lat::numeric, 3)::double precision
            or lng <> round(lng::numeric, 3)::double precision);

    update public.calls
       set state = 'SELESAI', ended_at = now(), end_reason = 'error'
     where state <> 'SELESAI' and sos_confirmed_at < now() - interval '2 hours';
  $$
);
