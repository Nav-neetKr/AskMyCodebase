-- Run this once in Supabase: Dashboard > SQL Editor > New query.
-- RLS ensures the browser access token can only access its owner's rows.
create table if not exists public.codebase_repos (
  repo_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  repo_url text not null,
  repo_name text not null,
  indexed_at timestamptz not null default now(),
  chunk_count integer not null check (chunk_count >= 0),
  chunks jsonb not null
);

alter table public.codebase_repos enable row level security;
grant select, insert, delete on public.codebase_repos to authenticated;

drop policy if exists "Users can read their own repositories" on public.codebase_repos;
drop policy if exists "Users can add their own repositories" on public.codebase_repos;
drop policy if exists "Users can remove their own repositories" on public.codebase_repos;
create policy "Users can read their own repositories"
  on public.codebase_repos for select using ((select auth.uid()) = owner_id);
create policy "Users can add their own repositories"
  on public.codebase_repos for insert with check ((select auth.uid()) = owner_id);
create policy "Users can remove their own repositories"
  on public.codebase_repos for delete using ((select auth.uid()) = owner_id);
