import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-brand',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="brand" aria-label="TaskFlow">
      <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
      <span>taskflow<span class="brand-dot">.</span></span>
    </span>
  `,
  styleUrl: './brand.component.scss',
})
export class BrandComponent {}
