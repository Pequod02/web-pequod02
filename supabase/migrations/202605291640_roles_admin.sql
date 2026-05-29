begin;

do $$
begin
  create type public.app_role as enum ('admin', 'patron', 'tripulante');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nombre text,
  rol public.app_role not null default 'tripulante',
  created_at timestamptz not null default now()
);

create index if not exists profiles_rol_idx on public.profiles(rol);
alter table public.profiles enable row level security;
grant select, insert, update, delete on public.profiles to authenticated;

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select p.rol
  from public.profiles p
  where p.id = auth.uid()
$$;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin'::public.app_role, false)
$$;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_is_admin() to authenticated;

drop policy if exists "profiles_select_by_role" on public.profiles;
create policy "profiles_select_by_role"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.current_user_role() = 'admin'::public.app_role
  or (
    public.current_user_role() = 'patron'::public.app_role
    and rol in ('patron'::public.app_role, 'tripulante'::public.app_role)
  )
);

drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin"
on public.profiles
for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin"
on public.profiles
for update
to authenticated
using (id = auth.uid() or public.current_user_is_admin())
with check (id = auth.uid() or public.current_user_is_admin());

drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin"
on public.profiles
for delete
to authenticated
using (public.current_user_is_admin());

create or replace function public.guard_profile_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_is_admin() then
    return new;
  end if;

  if old.id = auth.uid()
    and old.email like '%@pequod02.local'
    and new.email not like '%@pequod02.local'
    and new.id = old.id
    and new.rol is not distinct from old.rol
    and new.created_at is not distinct from old.created_at then
    return new;
  end if;

  if new.id <> old.id
    or new.email is distinct from old.email
    or new.rol is distinct from old.rol
    or new.created_at is distinct from old.created_at then
    raise exception 'Solo un administrador puede cambiar email, rol o campos de sistema.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_updates on public.profiles;
create trigger guard_profile_updates
before update on public.profiles
for each row execute function public.guard_profile_updates();

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nombre, rol)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', ''), ''),
    'tripulante'
  )
  on conflict (id) do update
  set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

create or replace function public.admin_basic_stats()
returns table (
  total_usuarios bigint,
  total_admins bigint,
  total_patrones bigint,
  total_tripulantes bigint,
  total_archivos bigint
)
language sql
stable
security definer
set search_path = public, storage
as $$
  select
    count(*)::bigint as total_usuarios,
    count(*) filter (where rol = 'admin'::public.app_role)::bigint as total_admins,
    count(*) filter (where rol = 'patron'::public.app_role)::bigint as total_patrones,
    count(*) filter (where rol = 'tripulante'::public.app_role)::bigint as total_tripulantes,
    (
      select count(*)::bigint
      from storage.objects
      where bucket_id = 'pequod02-files'
    ) as total_archivos
  from public.profiles
  where public.current_user_is_admin();
$$;

grant execute on function public.admin_basic_stats() to authenticated;

create or replace function public.complete_own_profile(
  p_email text,
  p_nombre text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_profile public.profiles;
  clean_email text := lower(trim(coalesce(p_email, '')));
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida.';
  end if;

  if clean_email = ''
    or clean_email like '%@pequod02.local'
    or clean_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Email no valido.';
  end if;

  update public.profiles
  set
    email = clean_email,
    nombre = nullif(trim(coalesce(p_nombre, nombre, '')), '')
  where id = auth.uid()
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'Perfil no encontrado.';
  end if;

  return updated_profile;
end;
$$;

grant execute on function public.complete_own_profile(text, text) to authenticated;

insert into storage.buckets (id, name, public)
values ('pequod02-files', 'pequod02-files', false)
on conflict (id) do nothing;

drop policy if exists "pequod02_files_read_by_authenticated" on storage.objects;
create policy "pequod02_files_read_by_authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'pequod02-files');

drop policy if exists "pequod02_files_insert_admin" on storage.objects;
create policy "pequod02_files_insert_admin"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'pequod02-files' and public.current_user_is_admin());

drop policy if exists "pequod02_files_update_admin" on storage.objects;
create policy "pequod02_files_update_admin"
on storage.objects
for update
to authenticated
using (bucket_id = 'pequod02-files' and public.current_user_is_admin())
with check (bucket_id = 'pequod02-files' and public.current_user_is_admin());

drop policy if exists "pequod02_files_delete_admin" on storage.objects;
create policy "pequod02_files_delete_admin"
on storage.objects
for delete
to authenticated
using (bucket_id = 'pequod02-files' and public.current_user_is_admin());

commit;
