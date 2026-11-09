import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../core/api-base-url';
import { Organization } from '../organizations/organization.models';
import { OrganizationsService } from '../organizations/organizations.service';
import { PlanPageComponent } from './plan-page.component';
import { planLimitMessage, usagePercent } from './plan.models';

const MB = 1024 * 1024;
const GB = 1024 * MB;
const catalog = [
  { id: 'FREE', name: 'Gratuito', limits: { members: 5, projects: 3, tasks: 2000, storageBytes: GB, maxFileBytes: 10 * MB } },
  { id: 'PRO', name: 'Profissional', limits: { members: 50, projects: null, tasks: null, storageBytes: 20 * GB, maxFileBytes: 25 * MB } },
  { id: 'BUSINESS', name: 'Empresarial', limits: { members: 250, projects: null, tasks: null, storageBytes: 200 * GB, maxFileBytes: 25 * MB } },
];

describe('plan helpers', () => {
  it('recognizes plan limit errors only by their code', () => {
    const limit = new HttpErrorResponse({
      status: 403, error: { code: 'PLAN_LIMIT_REACHED', limit: 'members', message: 'O plano Gratuito permite até 5 membros por organização.' },
    });
    expect(planLimitMessage(limit)).toContain('permite até 5 membros');
    expect(planLimitMessage(limit)).toContain('Plano');
    expect(planLimitMessage(new HttpErrorResponse({ status: 403, error: { message: 'Sem permissão' } }))).toBeNull();
    expect(planLimitMessage(new HttpErrorResponse({ status: 409, error: { code: 'PLAN_LIMIT_REACHED' } }))).toBeNull();
    expect(planLimitMessage(new Error('x'))).toBeNull();
  });

  it('computes usage percentages, capped and null for unlimited resources', () => {
    expect(usagePercent(2, 5)).toBe(40);
    expect(usagePercent(9, 5)).toBe(100);
    expect(usagePercent(10, null)).toBeNull();
  });
});

describe('PlanPageComponent', () => {
  const active = signal<Organization | null>({ id: 'one', name: 'Equipe', slug: 'e', createdAt: '2026-01-01', role: 'MEMBER' });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PlanPageComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: OrganizationsService, useValue: { active } },
      ],
    });
  });

  it('shows usage of the active organization and compares the plans', async () => {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PlanPageComponent);
    await fixture.whenStable();
    http.expectOne('/api/organizations/one/plan').flush({
      plan: 'FREE', name: 'Gratuito', planChangedAt: null, limits: catalog[0].limits,
      usage: { members: 4, projects: 3, tasks: 120, storageBytes: 512 * MB },
    });
    http.expectOne('/api/plans').flush(catalog);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('está no plano Gratuito');
    const rows = Array.from(element.querySelectorAll('.usage-head')).map((row) =>
      Array.from(row.querySelectorAll('span')).map((span) => span.textContent?.trim()).join(' '));
    expect(rows).toEqual(['Membros 4 de 5', 'Projetos 3 de 3', 'Tarefas 120 de 2.000', 'Armazenamento de anexos 512 MB de 1 GB']);
    const meters = Array.from(element.querySelectorAll('[role="meter"]'));
    expect(meters.map((meter) => meter.getAttribute('aria-valuenow'))).toEqual(['80', '100', '6', '50']);
    expect(meters[1].classList).toContain('meter--full');
    expect(element.querySelector('th.current')?.textContent).toContain('Gratuito');
    expect(element.querySelector('tbody')?.textContent).toContain('Ilimitado');
    http.verify();
  });

  it('offers a retry when the plan cannot be loaded', async () => {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PlanPageComponent);
    await fixture.whenStable();
    http.expectOne('/api/organizations/one/plan').flush({}, { status: 500, statusText: 'Error' });
    // forkJoin cancela a outra requisição quando uma falha.
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível carregar');
    element.querySelector<HTMLButtonElement>('button')?.click();
    await fixture.whenStable();
    expect(http.match('/api/organizations/one/plan')).toHaveLength(1);
    http.match('/api/plans');
  });
});
