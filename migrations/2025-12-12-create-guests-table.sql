-- Guests table to store non-auth users (no FK to auth.users)
create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  email text null,
  number_of_credits integer default 0,
  bookmarks jsonb default '[]'::jsonb,
  settings jsonb default '{}'::jsonb,
  paid_chapters jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists guests_email_idx on public.guests(email);

-- Optional: keep email uniqueness only for non-null emails
create unique index if not exists guests_email_unique_not_null
  on public.guests(email)
  where email is not null;

-- No foreign keys to auth.users (guests are standalone)


