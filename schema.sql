-- FixTrail schema. Run once in the Supabase SQL editor (or `supabase db push`).
-- The Next.js server uses the service-role key and enforces authorization in lib/service.ts.
-- RLS below protects the tables from direct access with the public anon key.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  role text not null default 'reporter' check (role in ('reporter', 'staff')),
  created_at timestamptz not null default now()
);

-- Every new auth user gets a reporter profile. Promote staff manually:
--   update public.profiles set role = 'staff' where id = '<user uuid>';
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', new.email));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 5 and 120),
  description text not null check (char_length(description) between 15 and 4000),
  building text not null,
  location text not null,
  category text check (category in ('electrical','plumbing','networking','equipment','structural','cleaning','other')),
  reporter_id uuid not null references auth.users (id),
  reporter_name text not null,
  priority text check (priority in ('critical','high','medium','low')),
  status text not null default 'new' check (status in ('new','triaged','in_progress','resolved')),
  assigned_team text,
  assigned_to text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  due_at timestamptz,
  resolved_at timestamptz,
  resolution_notes text,
  photo_path text,
  resolution_photo_path text,
  client_request_id uuid unique,
  check (status <> 'resolved' or (resolved_at is not null and resolution_notes is not null)),
  check (status = 'new' or priority is not null)
);
create index if not exists issues_reporter_idx on public.issues (reporter_id);
create index if not exists issues_status_idx on public.issues (status, due_at);
create index if not exists issues_created_idx on public.issues (created_at desc);

create table if not exists public.ai_assessments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  model_name text not null,
  prompt_version text not null,
  model_recommendation jsonb,   -- validated model output, unmodified
  safety_override jsonb,        -- deterministic rule result + post-rule recommendation
  assessment_status text not null check (assessment_status in ('pending','succeeded','failed')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists ai_assessments_issue_idx on public.ai_assessments (issue_id, created_at desc);

create table if not exists public.issue_activity (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  actor_id uuid not null references auth.users (id),
  actor_name text not null,
  action_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists issue_activity_issue_idx on public.issue_activity (issue_id, created_at desc);

-- Row Level Security: read-only access for signed-in users through the anon key; all writes go through the server.
alter table public.profiles enable row level security;
alter table public.issues enable row level security;
alter table public.ai_assessments enable row level security;
alter table public.issue_activity enable row level security;

-- Defense in depth: browser roles may only read (through the policies below). All writes go through the server.
revoke insert, update, delete, truncate on public.profiles, public.issues, public.ai_assessments, public.issue_activity from anon, authenticated;
grant select on public.profiles, public.issues, public.ai_assessments, public.issue_activity to authenticated;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'staff');
$$;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (id = auth.uid());

drop policy if exists "read own or staff" on public.issues;
create policy "read own or staff" on public.issues for select using (reporter_id = auth.uid() or public.is_staff());

drop policy if exists "read assessments" on public.ai_assessments;
create policy "read assessments" on public.ai_assessments for select using (
  exists (select 1 from public.issues i where i.id = issue_id and (i.reporter_id = auth.uid() or public.is_staff()))
);

drop policy if exists "read activity" on public.issue_activity;
create policy "read activity" on public.issue_activity for select using (
  exists (select 1 from public.issues i where i.id = issue_id and (i.reporter_id = auth.uid() or public.is_staff()))
);

-- Private bucket for report photos and resolution evidence (served through short-lived signed URLs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
