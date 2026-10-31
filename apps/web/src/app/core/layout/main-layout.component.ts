import { ChangeDetectionStrategy, Component, HostListener, inject, signal, viewChild } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { HeaderComponent } from './header/header.component';
import { SidebarComponent } from './sidebar/sidebar.component';

@Component({
  selector: 'app-main-layout',
  imports: [HeaderComponent, SidebarComponent, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss',
})
export class MainLayoutComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly menuOpen = signal(false);
  protected readonly pageActive = signal(false);
  private readonly header = viewChild(HeaderComponent);

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected logout(): void {
    this.auth.logout();
    void this.router.navigateByUrl(this.auth.status() === 'error' ? '/session-error' : '/login');
  }

  @HostListener('document:keydown.escape')
  protected closeMenu(): void {
    if (this.menuOpen()) {
      this.menuOpen.set(false);
      this.header()?.focusMenuButton();
    }
  }

  @HostListener('window:resize')
  protected resetMenuOnDesktop(): void {
    if (this.menuOpen() && this.header()?.isMenuButtonVisible() === false) {
      this.menuOpen.set(false);
    }
  }
}
