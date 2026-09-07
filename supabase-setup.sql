-- Tikklok — tabellen en beveiliging.
-- Plak dit één keer in Supabase → SQL Editor → Run.

create table if not exists public.tikklok_dagen (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  datum      text        not null,                -- 'JJJJ-MM-DD'
  data       jsonb       not null,
  bijgewerkt timestamptz not null default now(),
  primary key (user_id, datum)
);

create table if not exists public.tikklok_instellingen (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  data       jsonb       not null,
  bijgewerkt timestamptz not null default now()
);

alter table public.tikklok_dagen        enable row level security;
alter table public.tikklok_instellingen enable row level security;

-- Elke gebruiker ziet en schrijft uitsluitend zijn eigen rijen.
drop policy if exists "eigen dagen"        on public.tikklok_dagen;
drop policy if exists "eigen instellingen" on public.tikklok_instellingen;

create policy "eigen dagen" on public.tikklok_dagen
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "eigen instellingen" on public.tikklok_instellingen
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
