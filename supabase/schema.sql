-- Run this in the Supabase SQL editor once, against your project.

create table if not exists medications (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  brand_or_common_name text,
  amount text not null,
  frequency text not null,
  times_of_day text[] not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dose_logs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  med_id uuid not null,
  date text not null,
  time_of_day text not null,
  taken boolean not null default false,
  taken_at timestamptz
);

create index if not exists dose_logs_by_date on dose_logs (user_id, date);
create index if not exists dose_logs_by_med on dose_logs (med_id);

alter table medications enable row level security;
alter table dose_logs enable row level security;

create policy "Users manage their own medications"
  on medications for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own dose logs"
  on dose_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
