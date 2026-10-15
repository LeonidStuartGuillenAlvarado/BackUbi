-- Fase 3: capturar_ubicacion ya NO acepta la IP como parámetro del cliente.
--
-- Motivo: igual que con lat/lon, un cliente podría mandar cualquier valor de
-- "ip_address" vía la RPC (es solo otro parámetro de texto). Para el método
-- 'ip' en particular, el dato que da valor es la IP real de la request, que
-- PostgREST sí expone de forma confiable a través de los headers de la
-- request (`request.headers`), sin que el cliente pueda falsearla desde el
-- body de la llamada RPC. La función ahora la lee del lado servidor.
--
-- Se mantiene p_latitud/p_longitud como parámetros (necesarios para el método
-- 'gps', que sí depende de lo que reporte navigator.geolocation en el
-- cliente — eso no se puede resolver del lado servidor). El método 'ip' no
-- necesita que el cliente mande coordenadas en absoluto.

drop function if exists public.capturar_ubicacion(text, double precision, double precision, double precision, text, inet, text);

create or replace function public.capturar_ubicacion(
  p_token text,
  p_latitud double precision,
  p_longitud double precision,
  p_precision_metros double precision,
  p_metodo text,
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
  v_ip_header text;
  v_ip inet;
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

  -- PostgREST expone los headers de la request actual en request.headers (json).
  -- x-forwarded-for puede traer varias IPs separadas por coma (cliente, proxies);
  -- la primera es la IP original del cliente.
  begin
    v_ip_header := split_part(
      (current_setting('request.headers', true)::json ->> 'x-forwarded-for'),
      ',', 1
    );
    v_ip := trim(v_ip_header)::inet;
  exception when others then
    v_ip := null;
  end;

  insert into public.ubicaciones_capturadas (
    enlace_id, latitud, longitud, precision_metros, metodo, ip_address, user_agent
  ) values (
    v_enlace.id, p_latitud, p_longitud, p_precision_metros, p_metodo, v_ip, p_user_agent
  )
  returning id into v_nueva_captura_id;

  if v_capturas_actuales + 1 >= v_enlace.max_capturas then
    update public.enlaces set activo = false where id = v_enlace.id;
  end if;

  return v_nueva_captura_id;
end;
$$;

revoke all on function public.capturar_ubicacion(text, double precision, double precision, double precision, text, text) from public;
grant execute on function public.capturar_ubicacion(text, double precision, double precision, double precision, text, text) to anon, authenticated;
