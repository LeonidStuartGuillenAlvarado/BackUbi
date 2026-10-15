-- Migración inicial BACKUBI (v2 — corrige hallazgos de revisión)
-- Proyecto Supabase: backubi (ref yikoupeedyxqvgxekubf, us-east-1)
-- Ejercicio académico de simulación OSINT/ingeniería social — ver docs/README.md
--
-- Cambios respecto a la v1 tras revisión:
--   1. El acceso público ya NO es contra las tablas directamente, sino vía funciones RPC
--      (validar_token / capturar_ubicacion). Evita que un cliente arbitrario (curl/Postman
--      con la anon key) inserte filas falsas o lea columnas que no debería ver.
--   2. capturar_ubicacion es atómica (bloquea la fila del enlace, cuenta capturas existentes
--      y desactiva el enlace al llegar a max_capturas) -> cierra la ventana de carrera que
--      permitía inundar un mismo enlace con inserts concurrentes.
--   3. Se quitó el índice redundante sobre enlaces.token (ya lo cubre el UNIQUE).
--   4. activo y expira_en se validan juntos, tanto en las policies como en las funciones.
--   5. CHECKs de rango en coordenadas/precisión, pgcrypto habilitado, token en hex (encode()
--      no soporta 'base64url'), ip_address como inet, y on delete restrict en vez de cascade
--      para no perder evidencia si se borra un enlace.

create extension if not exists pgcrypto;

-- ========== enlaces ==========

create table if not exists public.enlaces (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(gen_random_bytes(12), 'hex'),
  creado_por uuid not null references auth.users(id) on delete cascade,
  etiqueta text,                         -- nota interna del Usuario A, nunca expuesta a anon
  activo boolean not null default true,
  max_capturas integer not null default 1 check (max_capturas > 0),
  creado_en timestamptz not null default now(),
  expira_en timestamptz                  -- null = sin expiración
);

comment on table public.enlaces is
  'Enlaces generados por el operador del ejercicio (Usuario A). Cada token identifica un mapa trampa.';

create index if not exists enlaces_creado_por_idx on public.enlaces (creado_por);
-- (se quitó enlaces_token_idx: redundante, el UNIQUE de "token" ya crea ese índice)

alter table public.enlaces enable row level security;

create policy "enlaces: propietario lee sus enlaces"
  on public.enlaces for select
  to authenticated
  using (auth.uid() = creado_por);

create policy "enlaces: propietario crea sus enlaces"
  on public.enlaces for insert
  to authenticated
  with check (auth.uid() = creado_por);

create policy "enlaces: propietario actualiza sus enlaces"
  on public.enlaces for update
  to authenticated
  using (auth.uid() = creado_por)
  with check (auth.uid() = creado_por);

create policy "enlaces: propietario elimina sus enlaces"
  on public.enlaces for delete
  to authenticated
  using (auth.uid() = creado_por);

-- Nota: a propósito NO hay policy de SELECT para "anon" en esta tabla. La vista pública
-- nunca lee enlaces directamente (fugaría etiqueta/creado_por); valida el token a través
-- de validar_token(), definida más abajo.

-- ========== ubicaciones_capturadas ==========

create table if not exists public.ubicaciones_capturadas (
  id uuid primary key default gen_random_uuid(),
  enlace_id uuid not null references public.enlaces(id) on delete restrict,
  latitud double precision check (latitud is null or latitud between -90 and 90),
  longitud double precision check (longitud is null or longitud between -180 and 180),
  precision_metros double precision check (precision_metros is null or precision_metros >= 0),
  metodo text not null check (metodo in ('gps', 'ip')),
  ip_address inet,
  user_agent text,
  capturado_en timestamptz not null default now()
);

comment on table public.ubicaciones_capturadas is
  'Capturas de ubicación del Usuario B (compañero de curso consentido) al abrir un enlace trampa.
   Registro inmutable: sin policies de update/delete a propósito (trazabilidad del ejercicio).
   on delete restrict en enlace_id: no se puede borrar un enlace que ya tiene capturas asociadas,
   para no perder evidencia.';

create index if not exists ubicaciones_enlace_id_idx on public.ubicaciones_capturadas (enlace_id);
create index if not exists ubicaciones_capturado_en_idx on public.ubicaciones_capturadas (capturado_en);

alter table public.ubicaciones_capturadas enable row level security;

create policy "ubicaciones: propietario del enlace lee sus capturas"
  on public.ubicaciones_capturadas for select
  to authenticated
  using (
    exists (
      select 1 from public.enlaces e
      where e.id = ubicaciones_capturadas.enlace_id and e.creado_por = auth.uid()
    )
  );

-- Nota: a propósito NO hay policy de INSERT para "anon" en esta tabla. La captura pública
-- entra solo a través de capturar_ubicacion() (SECURITY DEFINER), nunca con un insert directo.
-- Tampoco hay policies de UPDATE/DELETE para nadie -> quedan denegadas por defecto (inmutable).

-- ========== Funciones RPC (único punto de entrada para el rol "anon") ==========

-- Valida si un token corresponde a un enlace utilizable ahora mismo (activo y no expirado),
-- sin exponer ninguna otra columna de "enlaces" a quien la llama.
create or replace function public.validar_token(p_token text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.enlaces
    where token = p_token
      and activo = true
      and (expira_en is null or expira_en > now())
  );
$$;

revoke all on function public.validar_token(text) from public;
grant execute on function public.validar_token(text) to anon, authenticated;

-- Inserta una captura de ubicación de forma atómica:
--   - bloquea la fila del enlace (for update) para evitar condiciones de carrera,
--   - rechaza si el enlace no existe, está inactivo o expiró,
--   - rechaza si ya se alcanzó max_capturas para ese enlace,
--   - inserta la fila y, si con esta inserción se llega a max_capturas, desactiva el enlace.
create or replace function public.capturar_ubicacion(
  p_token text,
  p_latitud double precision,
  p_longitud double precision,
  p_precision_metros double precision,
  p_metodo text,
  p_ip_address inet,
  p_user_agent text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enlace record;
  v_capturas_actuales integer;
  v_nueva_captura_id uuid;
begin
  select * into v_enlace
  from public.enlaces
  where token = p_token
  for update;

  if v_enlace is null then
    raise exception 'token_invalido';
  end if;

  if not v_enlace.activo then
    raise exception 'enlace_inactivo';
  end if;

  if v_enlace.expira_en is not null and v_enlace.expira_en <= now() then
    raise exception 'enlace_expirado';
  end if;

  select count(*) into v_capturas_actuales
  from public.ubicaciones_capturadas
  where enlace_id = v_enlace.id;

  if v_capturas_actuales >= v_enlace.max_capturas then
    raise exception 'limite_capturas_alcanzado';
  end if;

  insert into public.ubicaciones_capturadas (
    enlace_id, latitud, longitud, precision_metros, metodo, ip_address, user_agent
  ) values (
    v_enlace.id, p_latitud, p_longitud, p_precision_metros, p_metodo, p_ip_address, p_user_agent
  )
  returning id into v_nueva_captura_id;

  if v_capturas_actuales + 1 >= v_enlace.max_capturas then
    update public.enlaces set activo = false where id = v_enlace.id;
  end if;

  return v_nueva_captura_id;
end;
$$;

revoke all on function public.capturar_ubicacion(text, double precision, double precision, double precision, text, inet, text) from public;
grant execute on function public.capturar_ubicacion(text, double precision, double precision, double precision, text, inet, text) to anon, authenticated;
