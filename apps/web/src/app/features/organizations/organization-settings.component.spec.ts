import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { Organization } from './organization.models';
import { OrganizationSettingsComponent } from './organization-settings.component';
import { OrganizationsService } from './organizations.service';

const owner: Organization = { id: 'one', name: 'Equipe A', slug: 'equipe-a', createdAt: '2026-01-01T00:00:00Z', role: 'OWNER' };
const member: Organization = { id: 'two', name: 'Equipe B', slug: 'equipe-b', createdAt: '2026-02-01T00:00:00Z', role: 'MEMBER' };

describe('OrganizationSettingsComponent', () => {
  const active = signal<Organization | null>(owner);
  const status = signal<'idle' | 'loading' | 'ready' | 'error'>('ready');
  let renamed: Subject<Organization>;
  const service = {
    active, status, warning: signal(''), refresh: vi.fn(),
    rename: vi.fn(() => renamed.asObservable()),
  };
  let fixture: ComponentFixture<OrganizationSettingsComponent>;
  let element: HTMLElement;

  beforeEach(async () => {
    active.set(owner);
    status.set('ready');
    renamed = new Subject<Organization>();
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [OrganizationSettingsComponent],
      providers: [provideRouter([]), { provide: OrganizationsService, useValue: service }],
    });
    fixture = TestBed.createComponent(OrganizationSettingsComponent);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  function setName(value: string): void {
    const field = element.querySelector<HTMLInputElement>('#organization-name');
    if (!field) throw new Error('Name field not found');
    field.value = value;
    field.dispatchEvent(new Event('input'));
  }
  function submit(): void {
    element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  it('shows organization details and renames it for managers', async () => {
    expect(element.textContent).toContain('equipe-a');
    expect(element.textContent).toContain('Proprietário');
    expect(element.querySelector<HTMLInputElement>('#organization-name')?.value).toBe('Equipe A');
    setName('  Equipe Nova  ');
    submit();
    submit();
    expect(service.rename).toHaveBeenCalledOnce();
    expect(service.rename).toHaveBeenCalledWith('one', 'Equipe Nova');
    await fixture.whenStable();
    expect(element.querySelector('button[type="submit"]')?.textContent).toContain('Salvando');
    const updated = { ...owner, name: 'Equipe Nova' };
    renamed.next(updated);
    renamed.complete();
    active.set(updated);
    await fixture.whenStable();
    expect(element.textContent).toContain('Nome da organização atualizado');
    expect(element.querySelector<HTMLInputElement>('#organization-name')?.value).toBe('Equipe Nova');
  });

  it('validates the name locally and skips unchanged names', async () => {
    setName(' a ');
    submit();
    await fixture.whenStable();
    expect(element.textContent).toContain('Informe um nome com 2 a 120 caracteres');
    setName('Equipe A');
    submit();
    await fixture.whenStable();
    expect(element.textContent).toContain('Nenhuma alteração para salvar');
    expect(service.rename).not.toHaveBeenCalled();
  });

  it('reports a forbidden response from the API', async () => {
    setName('Outro nome');
    submit();
    renamed.error(new HttpErrorResponse({ status: 403 }));
    await fixture.whenStable();
    expect(element.textContent).toContain('não tem permissão');
  });

  it('shows read-only details for members and resets when the organization changes', async () => {
    setName('Edição pendente');
    active.set(member);
    await fixture.whenStable();
    expect(element.querySelector('form')).toBeNull();
    expect(element.textContent).toContain('Somente proprietários e administradores');
    expect(element.textContent).toContain('Membro');
    active.set(owner);
    await fixture.whenStable();
    expect(element.querySelector<HTMLInputElement>('#organization-name')?.value).toBe('Equipe A');
  });

  it('guides the user when there is no active organization', async () => {
    active.set(null);
    await fixture.whenStable();
    expect(element.textContent).toContain('Selecione ou crie uma organização');
    expect(element.querySelector('a.tf-button')?.getAttribute('href')).toBe('/');
  });
});
