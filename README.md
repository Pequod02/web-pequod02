# web-pequod02

Workspace para la web del barco de vela Pequod02.

## Objetivo

Crear una web estatica publicada en GitHub Pages para centralizar informacion y herramientas de la tripulacion de Pequod02.

## Stack previsto

- Frontend: HTML, CSS y JavaScript.
- Autenticacion: Supabase Auth.
- Base de datos: Supabase.
- Roles: tabla `profiles` con `admin`, `patron` y `tripulante`.
- Archivos: Supabase Storage en bucket privado `pequod02-files`.
- Publicacion: GitHub Pages.
- Cuenta GitHub: Pequod02.

## Secciones previstas

- Regatas: calendario, instrucciones en PDF y meteorologia de Puertos del Estado.
- Mantenimiento y reparaciones: registro de trabajos, incidencias y tareas pendientes del barco.
- Academia: manuales de navegacion y material de formacion.
- Agente IA para tripulantes: asistente orientado a consultas internas del proyecto.
- Administracion: `src/admin.html`, restringido a usuarios con rol `admin`.

## Estructura

```text
web-pequod02/
|-- assets/
|-- docs/
|-- supabase/
|-- src/
`-- README.md
```

## Supabase

La migracion SQL esta en:

```text
supabase/migrations/202605291640_roles_admin.sql
```

Debe ejecutarse en el SQL Editor de Supabase o con una conexion Postgres con permisos de owner. Despues de ejecutarla, el primer administrador debe asignarse manualmente:

```sql
update public.profiles
set rol = 'admin'
where email = 'admin@pequod02.com';
```

El panel de administracion crea, lista, edita roles y da de baja usuarios reales de Supabase Auth mediante la Edge Function:

```text
supabase/functions/admin-users/index.ts
```

La funcion usa la Supabase Admin API con `SERVICE_ROLE_KEY`, verifica primero que la sesion llamante tenga rol `admin` en `public.profiles` y despues sincroniza `auth.users` con `public.profiles`. La clave `service_role` debe configurarse como secreto de la Edge Function; no debe publicarse en `src/config.js` ni en GitHub Pages.

Despliegue de la funcion:

```bash
supabase functions deploy admin-users
supabase secrets set SERVICE_ROLE_KEY=tu_service_role_key
```

## Notas

- El frontend debe poder funcionar como sitio estatico en GitHub Pages.
- La integracion con Supabase debe mantener las claves sensibles fuera del repositorio publico. La anon key puede vivir en el frontend; la service role key no.
- La cuenta Supabase estara conectada con la cuenta GitHub Pequod02.
