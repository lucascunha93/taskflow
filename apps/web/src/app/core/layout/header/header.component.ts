import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../../shared/icon/icon.component';
import { AuthUser } from '../../auth/auth.models';

@Component({
  selector: 'app-header',
  imports: [IconComponent, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
})
export class HeaderComponent {
  readonly user = input.required<AuthUser>();
  readonly menuOpen = input(false);
  readonly menuToggle = output<void>();
  readonly logout = output<void>();
  private readonly menuButton = viewChild.required<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly router = inject(Router);
  protected readonly search = new FormControl('', { nonNullable: true });

  /** Abre a lista de tarefas da organização ativa filtrada pelo título informado. */
  protected submitSearch(): void {
    const search = this.search.value.trim();
    void this.router.navigate(['/tasks'], { queryParams: search ? { search } : {} });
    this.search.reset();
  }

  focusMenuButton(): void {
    this.menuButton().nativeElement.focus();
  }

  isMenuButtonVisible(): boolean {
    const button = this.menuButton().nativeElement;
    return button.ownerDocument.defaultView?.getComputedStyle(button).display !== 'none';
  }
}
