import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    // Vista pública / "mapa trampa": lo que abre el Usuario B al recibir el enlace.
    // Sin login, sin guard. La validación de token ocurre dentro del componente
    // vía la función RPC validar_token() (ver supabase/migrations/0001_schema_inicial.sql).
    path: 'r/:token',
    loadComponent: () => import('./public/mapa-trampa/mapa-trampa').then((m) => m.MapaTrampa),
  },
  {
    // Dashboard privado del Usuario A (operador del ejercicio).
    path: 'dashboard',
    children: [
      {
        path: 'login',
        loadComponent: () => import('./dashboard/login/login').then((m) => m.Login),
      },
      {
        path: '',
        canActivate: [authGuard],
        loadComponent: () => import('./dashboard/home/home').then((m) => m.Home),
      },
    ],
  },
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
