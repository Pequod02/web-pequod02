begin;

create or replace function public.guard_profile_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.current_user_is_admin() then
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

commit;
