import { ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';
import { IconComponent } from '../../../shared/icon/icon.component';
import { AuthUser } from '../../auth/auth.models';

@Component({
  selector: 'app-header',
  imports: [IconComponent],
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

  focusMenuButton(): void {
    this.menuButton().nativeElement.focus();
  }

  isMenuButtonVisible(): boolean {
    const button = this.menuButton().nativeElement;
    return button.ownerDocument.defaultView?.getComputedStyle(button).display !== 'none';
  }
}
