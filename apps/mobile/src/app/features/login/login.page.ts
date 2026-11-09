import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonButton, IonContent, IonHeader, IonInput, IonItem, IonList, IonNote, IonSpinner, IonText, IonTitle, IonToolbar,
} from '@ionic/angular';
import { SessionService } from '../../core/session.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonInput, IonButton, IonText, IonNote, IonSpinner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.page.html',
  styles: [`
    .intro { margin: 24px 16px 8px; }
    .intro h1 { margin: 0 0 4px; font-size: 1.6rem; color: var(--ion-color-primary); }
    form ion-button { margin: 24px 16px 0; }
    .error { display: block; margin: 16px; }
  `],
})
export class LoginPage {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Informe e-mail e senha.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const { email, password } = this.form.getRawValue();
    try {
      await this.session.login(email.trim(), password);
      this.form.reset();
      await this.router.navigate(['/tarefas'], { replaceUrl: true });
    } catch (error: unknown) {
      this.error.set(loginError(error));
    } finally {
      this.busy.set(false);
    }
  }
}

export function loginError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return 'E-mail ou senha incorretos.';
    if (error.status === 429) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
    if (error.status === 400) return 'Confira o e-mail e a senha informados.';
    if (error.status === 0) return 'Sem conexão. É preciso estar online para entrar pela primeira vez.';
  }
  return 'Não foi possível entrar. Tente novamente.';
}
