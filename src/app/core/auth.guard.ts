import { inject } from '@angular/core';
import { Router } from '@angular/router';
import type { CanActivateFn } from '@angular/router';
import { SupabaseService } from './supabase.service';

/**
 * Protege las rutas del dashboard privado (Usuario A). Si no hay sesión activa
 * de Supabase Auth, redirige a /dashboard/login.
 */
export const authGuard: CanActivateFn = async () => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);

  const { data } = await supabase.client.auth.getSession();

  if (data.session) {
    return true;
  }

  return router.createUrlTree(['/dashboard/login']);
};
