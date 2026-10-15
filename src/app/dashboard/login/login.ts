import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';

/**
 * Login del Usuario A (operador del ejercicio) vía Supabase Auth (email/password).
 * TODO (Fase 4): mejorar UX, manejo de errores, recuperación de contraseña si aplica.
 */
@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
})
export class Login {
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);

  protected email = '';
  protected password = '';
  protected readonly cargando = signal(false);
  protected readonly error = signal<string | null>(null);

  async iniciarSesion(): Promise<void> {
    this.error.set(null);
    this.cargando.set(true);

    const { error } = await this.supabase.client.auth.signInWithPassword({
      email: this.email,
      password: this.password,
    });

    this.cargando.set(false);

    if (error) {
      this.error.set(error.message);
      return;
    }

    this.router.navigateByUrl('/dashboard');
  }
}
