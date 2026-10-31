import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'dashboard'
  | 'my-tasks'
  | 'tasks'
  | 'members'
  | 'settings'
  | 'search'
  | 'chevron'
  | 'menu'
  | 'close';

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true" focusable="false">
      @switch (name()) {
        @case ('dashboard') {
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        }
        @case ('my-tasks') {
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12 2.3 2.3 4.7-4.8" />
        }
        @case ('tasks') {
          <path d="M9 6h11M9 12h11M9 18h11" />
          <path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" />
        }
        @case ('members') {
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19v-1a5.5 5.5 0 0 1 11 0v1M16 5.5a3 3 0 0 1 0 5.8M17 13.5a5 5 0 0 1 3.5 4.8v.7" />
        }
        @case ('settings') {
          <circle cx="12" cy="12" r="3" />
          <path d="M19.2 13.5a7.8 7.8 0 0 0 0-3l1.5-1.2-1.5-2.6-1.8.6a7.8 7.8 0 0 0-2.6-1.5L14.5 4h-3l-.3 1.8a7.8 7.8 0 0 0-2.6 1.5l-1.8-.6-1.5 2.6 1.5 1.2a7.8 7.8 0 0 0 0 3l-1.5 1.2 1.5 2.6 1.8-.6a7.8 7.8 0 0 0 2.6 1.5l.3 1.8h3l.3-1.8a7.8 7.8 0 0 0 2.6-1.5l1.8.6 1.5-2.6z" />
        }
        @case ('search') {
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 4 4" />
        }
        @case ('chevron') {
          <path d="m7 10 5 5 5-5" />
        }
        @case ('menu') {
          <path d="M4 7h16M4 12h16M4 17h16" />
        }
        @case ('close') {
          <path d="M6 6l12 12M18 6 6 18" />
        }
      }
    </svg>
  `,
  styles: `:host { display: inline-flex; width: 20px; height: 20px; flex: 0 0 auto; } svg { width: 100%; height: 100%; }`,
})
export class IconComponent {
  readonly name = input.required<IconName>();
}
