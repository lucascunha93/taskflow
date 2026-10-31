import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/icon/icon.component';
import { OrganizationsService } from './organizations.service';

@Component({
  selector: 'app-organization-selector',
  imports: [IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './organization-selector.component.html',
  styleUrl: './organization-selector.component.scss',
})
export class OrganizationSelectorComponent {
  protected readonly organizations = inject(OrganizationsService);
  protected readonly open = signal(false);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');

  protected select(id: string): void {
    if (this.organizations.select(id)) this.open.set(false);
  }

  protected onToggle(event: Event): void {
    if (event.target instanceof HTMLDetailsElement) this.open.set(event.target.open);
  }

  protected closeAndFocus(event: Event): void {
    if (!this.open()) return;
    event.stopPropagation();
    this.open.set(false);
    this.summary()?.nativeElement.focus();
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (event.target instanceof Node && !this.host.nativeElement.contains(event.target)) this.open.set(false);
  }
}
