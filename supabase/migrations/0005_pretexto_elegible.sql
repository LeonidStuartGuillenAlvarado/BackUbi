-- Permite al Usuario A elegir, al generar el enlace, dónde se muestra el marcador de
-- pretexto (antes fijo en el código: "Un lugar interesante" en Lima).
--
-- Reemplaza validar_token por obtener_pretexto: en una sola llamada resuelve si el token
-- es usable (activo, no expirado) Y devuelve el punto a mostrar, sin exponer ninguna otra
-- columna de "enlaces" a "anon" (mismo principio que validar_token, pero evita un segundo
-- round-trip del cliente y un segundo punto de acceso público).

alter table public.enlaces
  add column if not exists pretexto_lat double precision not null default -12.0464
    check (pretexto_lat between -90 and 90),
  add column if not exists pretexto_lon double precision not null default -77.0428
    check (pretexto_lon between -180 and 180),
  add column if not exists pretexto_etiqueta text not null default 'Un lugar interesante';

create or replace function public.obtener_pretexto(p_token text)
returns table(valido boolean, lat double precision, lon double precision, etiqueta text)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_enlace record;
begin
  select e.pretexto_lat, e.pretexto_lon, e.pretexto_etiqueta
  into v_enlace
  from public.enlaces e
  where e.token = p_token
    and e.activo = true
    and (e.expira_en is null or e.expira_en > now());

  if not found then
    return query select false, null::double precision, null::double precision, null::text;
    return;
  end if;

  return query select true, v_enlace.pretexto_lat, v_enlace.pretexto_lon, v_enlace.pretexto_etiqueta;
end;
$$;

revoke all on function public.obtener_pretexto(text) from public;
grant execute on function public.obtener_pretexto(text) to anon, authenticated;

-- validar_token queda reemplazada por obtener_pretexto; se retira para no dejar superficie
-- pública sin usar (menos funciones SECURITY DEFINER callables por anon, menos que revisar).
drop function if exists public.validar_token(text);
