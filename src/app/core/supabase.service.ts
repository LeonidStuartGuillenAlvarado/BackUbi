import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

/**
 * Cliente único de Supabase para toda la app (módulo público y dashboard).
 * Usa la publishable key (segura para exponer en frontend): la seguridad real
 * la dan las políticas RLS y las funciones RPC definidas en la base de datos,
 * no el secreto de esta clave. Ver proyectos/backubi/supabase/migrations/.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient = createClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
  );
}
