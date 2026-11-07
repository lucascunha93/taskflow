import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { AuthUser } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { Organization } from '../organizations/organization.models';
import { OrganizationsService } from '../organizations/organizations.service';
import { ProfilePageComponent } from './profile-page.component';

const user: AuthUser = { id: 'u1', name: 'Pessoa Teste', email: 'pessoa@example.test', createdAt: '2026-01-15T12:00:00Z' };
const organizations: Organization[] = [
  { id: 'one', name: 'Equipe A', slug: 'equipe-a', createdAt: '2026-01-01', role: 'OWNER' },
  { id: 'two', name: 'Equipe B', slug: 'equipe-b', createdAt: '2026-01-01', role: 'MEMBER' },
];

describe('ProfilePageComponent', () => {
  const currentUser = signal<AuthUser | null>(user);
  let updated: Subject<AuthUser>;
  const auth = { user: currentUser, updateProfile: vi.fn(() => updated.asObservable()) };
  const items = signal<Organization[]>(organizations);
  const status = signal<'idle' | 'loading' | 'ready' | 'error'>('ready');
  let fixture: ComponentFixture<ProfilePageComponent>;
  let element: HTMLElement;

  beforeEach(async () => {
    currentUser.set(user);
    items.set(organizations);
    status.set('ready');
    updated = new Subject<AuthUser>();
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [ProfilePageComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: OrganizationsService, useValue: { organizations: items, status, refresh: vi.fn() } },
      ],
    });
    fixture = TestBed.createComponent(ProfilePageComponent);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  function setName(value: string): void {
    const field = element.querySelector<HTMLInputElement>('#profile-name');
    if (!field) throw new Error('Name field not found');
    field.value = value;
    field.dispatchEvent(new Event('input'));
  }
  function submit(): void {
    element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  it('shows account data and the role in each organization', () => {
    expect(element.textContent).toContain('pessoa@example.test');
    expect(element.textContent).toContain('15/01/2026');
    const roles = Array.from(element.querySelectorAll('.organization-roles li'),
      (item) => Array.from(item.querySelectorAll('span'), (span) => span.textContent?.trim()));
    expect(roles).toEqual([['Equipe A', 'Proprietário'], ['Equipe B', 'Membro']]);
  });

  it('updates the trimmed display name once and confirms success', async () => {
    expect(element.querySelector<HTMLInputElement>('#profile-name')?.value).toBe('Pessoa Teste');
    setName('  Novo Nome ');
    submit();
    submit();
    expect(auth.updateProfile).toHaveBeenCalledOnce();
    expect(auth.updateProfile).toHaveBeenCalledWith('Novo Nome');
    updated.next({ ...user, name: 'Novo Nome' });
    updated.complete();
    await fixture.whenStable();
    expect(element.textContent).toContain('Perfil atualizado');
  });

  it('validates locally and reports API failures', async () => {
    setName('x');
    submit();
    await fixture.whenStable();
    expect(element.textContent).toContain('Informe um nome com 2 a 120 caracteres');
    expect(auth.updateProfile).not.toHaveBeenCalled();
    setName('Outro Nome');
    submit();
    updated.error(new HttpErrorResponse({ status: 0 }));
    await fixture.whenStable();
    expect(element.textContent).toContain('Não foi possível atualizar o perfil');
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });

  it('distinguishes an empty organization list from a loading failure', async () => {
    items.set([]);
    await fixture.whenStable();
    expect(element.textContent).toContain('ainda não participa');
    status.set('error');
    await fixture.whenStable();
    expect(element.textContent).toContain('Não foi possível carregar suas organizações');
  });
});
