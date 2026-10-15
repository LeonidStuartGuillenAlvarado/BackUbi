-- Fix advisor "auth_rls_initplan" (performance, WARN)
-- Postgres re-evalúa auth.uid() por cada fila evaluada en una policy. Envolverlo en
-- (select auth.uid()) hace que el planner lo trate como un valor constante por query
-- (InitPlan), evaluado una sola vez en vez de N veces. No cambia la lógica de seguridad,
-- solo el plan de ejecución. Afecta a las 5 policies reportadas por get_advisors.
--
-- Referencia: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

-- ========== enlaces ==========

drop policy if exists "enlaces: propietario lee sus enlaces" on public.enlaces;
create policy "enlaces: propietario lee sus enlaces"
  on public.enlaces for select
  to authenticated
  using ((select auth.uid()) = creado_por);

drop policy if exists "enlaces: propietario crea sus enlaces" on public.enlaces;
create policy "enlaces: propietario crea sus enlaces"
  on public.enlaces for insert
  to authenticated
  with check ((select auth.uid()) = creado_por);

drop policy if exists "enlaces: propietario actualiza sus enlaces" on public.enlaces;
create policy "enlaces: propietario actualiza sus enlaces"
  on public.enlaces for update
  to authenticated
  using ((select auth.uid()) = creado_por)
  with check ((select auth.uid()) = creado_por);

drop policy if exists "enlaces: propietario elimina sus enlaces" on public.enlaces;
create policy "enlaces: propietario elimina sus enlaces"
  on public.enlaces for delete
  to authenticated
  using ((select auth.uid()) = creado_por);

-- ========== ubicaciones_capturadas ==========

drop policy if exists "ubicaciones: propietario del enlace lee sus capturas" on public.ubicaciones_capturadas;
create policy "ubicaciones: propietario del enlace lee sus capturas"
  on public.ubicaciones_capturadas for select
  to authenticated
  using (
    exists (
      select 1 from public.enlaces e
      where e.id = ubicaciones_capturadas.enlace_id and e.creado_por = (select auth.uid())
    )
  );
