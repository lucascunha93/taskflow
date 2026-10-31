import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { OrganizationsService } from '../organizations/organizations.service';
import { AddMemberRole } from './member.models';
import { MembersService } from './members.service';

@Component({
  selector: 'app-members-page',
  imports: [ReactiveFormsModule, RouterLink],
  providers: [MembersService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './members-page.component.html',
  styleUrl: './members-page.component.scss',
})
export class MembersPageComponent {
  protected readonly organizations = inject(OrganizationsService);
  protected readonly members = inject(MembersService);
  private readonly activeId = computed(() => this.organizations.active()?.id ?? null);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    role: this.fb.control<AddMemberRole>('MEMBER', Validators.required),
  });

  constructor() {
    effect(() => {
      this.activeId();
      this.form.reset({ email: '', role: 'MEMBER' });
    });
    effect(() => {
      if (this.members.success()) this.form.reset({ email: '', role: 'MEMBER' });
    });
    effect(() => {
      if (this.organizations.active()?.role !== 'OWNER' && this.form.controls.role.value === 'ADMIN') {
        this.form.controls.role.setValue('MEMBER');
      }
    });
  }

  protected submit(): void {
    if (this.members.adding()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { email, role } = this.form.getRawValue();
    this.members.add(email.trim(), role);
  }
}
