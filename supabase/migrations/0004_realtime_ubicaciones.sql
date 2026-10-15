-- Fase 4: habilita Realtime (postgres_changes) en ubicaciones_capturadas para que el
-- dashboard del Usuario A reciba las capturas apenas se insertan, sin hacer polling.
--
-- Supabase Realtime respeta las RLS existentes de la tabla: cada cliente suscrito solo
-- recibe los INSERT que su propia policy de SELECT le permitiría leer (en este caso,
-- "ubicaciones: propietario del enlace lee sus capturas"). No hace falta duplicar esa
-- lógica aquí, ni abrir la tabla a "anon" — la vista pública nunca se suscribe a esto.

alter publication supabase_realtime add table public.ubicaciones_capturadas;
