import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { API_BASE_URL } from '../../core/api-base-url';
import { Organization } from '../organizations/organization.models';
import { OrganizationsService } from '../organizations/organizations.service';
import { BillingService } from './billing.service';
import { CheckoutPageComponent } from './checkout-page.component';
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

const button = (element: HTMLElement, text: string): HTMLButtonElement => {
  const found = Array.from(element.querySelectorAll('button')).find((item) => item.textContent?.trim() === text);
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
};

describe('PlanPageComponent', () => {
  const active = signal<Organization | null>({ id: 'one', name: 'Equipe', slug: 'e', createdAt: '2026-01-01', role: 'MEMBER' });
  const freeOverview = {
    plan: 'FREE', name: 'Gratuito', planChangedAt: null, limits: catalog[0].limits,
    usage: { members: 4, projects: 3, tasks: 120, storageBytes: 512 * MB },
  };
  const proOverview = { ...freeOverview, plan: 'PRO', name: 'Profissional', limits: catalog[1].limits };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PlanPageComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: OrganizationsService, useValue: { active } },
      ],
    });
  });

  async function load(overview: object, billing: object) {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PlanPageComponent);
    await fixture.whenStable();
    http.expectOne('/api/organizations/one/plan').flush(overview);
    http.expectOne('/api/plans').flush(catalog);
    http.expectOne('/api/organizations/one/billing').flush(billing);
    await fixture.whenStable();
    return { http, fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('shows usage of the active organization and compares the plans', async () => {
    const { http, element } = await load(freeOverview, { provider: null, canManage: false, history: [] });
    expect(element.textContent).toContain('está no plano Gratuito');
    const rows = Array.from(element.querySelectorAll('.usage-head')).map((row) =>
      Array.from(row.querySelectorAll('span')).map((span) => span.textContent?.trim()).join(' '));
    expect(rows).toEqual(['Membros 4 de 5', 'Projetos 3 de 3', 'Tarefas 120 de 2.000', 'Armazenamento de anexos 512 MB de 1 GB']);
    const meters = Array.from(element.querySelectorAll('[role="meter"]'));
    expect(meters.map((meter) => meter.getAttribute('aria-valuenow'))).toEqual(['80', '100', '6', '50']);
    expect(meters[1].classList).toContain('meter--full');
    expect(element.querySelector('th.current')?.textContent).toContain('Gratuito');
    expect(element.querySelector('tbody')?.textContent).toContain('Ilimitado');
    expect(element.textContent).toContain('Somente o proprietário da organização pode mudar o plano.');
    expect(element.querySelector('.actions-row')).toBeNull();
    http.verify();
  });

  it('keeps showing the plan when billing information is unavailable', async () => {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PlanPageComponent);
    await fixture.whenStable();
    http.expectOne('/api/organizations/one/plan').flush(freeOverview);
    http.expectOne('/api/plans').flush(catalog);
    http.expectOne('/api/organizations/one/billing').flush({}, { status: 500, statusText: 'Error' });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('está no plano Gratuito');
    http.verify();
  });

  it('lets the owner start a simulated checkout', async () => {
    const { http, element } = await load(freeOverview, { provider: 'fake', canManage: true, history: [] });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    expect(element.textContent).toContain('o pagamento é simulado e nenhum valor é cobrado');
    expect(element.textContent).not.toContain('Voltar ao Gratuito');
    button(element, 'Mudar para Profissional').click();
    const request = http.expectOne('/api/organizations/one/billing/checkouts');
    expect(request.request.body).toEqual({ plan: 'PRO' });
    request.flush({ id: 'c1', plan: 'PRO', planName: 'Profissional', status: 'PENDING', checkoutUrl: '/plan/checkout/c1' });
    expect(navigate).toHaveBeenCalledWith('/plan/checkout/c1');
    http.verify();
  });

  it('returns to the free plan after confirmation and lists the history', async () => {
    const { http, fixture, element } = await load(proOverview, { provider: 'fake', canManage: true, history: [
      { id: 'h1', fromPlan: 'FREE', toPlan: 'PRO', createdAt: '2026-11-09T10:00:00Z', checkoutId: 'c1', actor: { id: 'u', name: 'Ana' } },
    ] });
    expect(element.querySelector('.history')?.textContent).toContain('Gratuito → Profissional');
    button(element, 'Voltar ao Gratuito').click();
    await fixture.whenStable();
    expect(element.querySelector('[role="alertdialog"]')?.textContent).toContain('não há reembolso');
    button(element, 'Confirmar').click();
    http.expectOne('/api/organizations/one/billing/cancel').flush({ plan: 'FREE', name: 'Gratuito' });
    await fixture.whenStable();
    // A página recarrega o plano e mostra o aviso com os dados novos.
    http.expectOne('/api/organizations/one/plan').flush(freeOverview);
    http.expectOne('/api/plans').flush(catalog);
    http.expectOne('/api/organizations/one/billing').flush({ provider: 'fake', canManage: true, history: [] });
    await fixture.whenStable();
    expect(element.querySelector('.notice')?.textContent).toContain('voltou ao plano Gratuito');
    expect(element.textContent).toContain('está no plano Gratuito');
    http.verify();
  });

  it('shows the API reason when the owner cannot return to the free plan', async () => {
    const { http, fixture, element } = await load(proOverview, { provider: 'fake', canManage: true, history: [] });
    button(element, 'Voltar ao Gratuito').click();
    await fixture.whenStable();
    button(element, 'Confirmar').click();
    http.expectOne('/api/organizations/one/billing/cancel').flush(
      { code: 'PLAN_LIMIT_REACHED', limit: 'freeOrganizations', message: 'Cada usuário pode ser proprietário de até 3 organizações no plano Gratuito.' },
      { status: 403, statusText: 'Forbidden' },
    );
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('até 3 organizações');
    http.verify();
  });

  it('offers a retry when the plan cannot be loaded', async () => {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PlanPageComponent);
    await fixture.whenStable();
    http.expectOne('/api/organizations/one/plan').flush({}, { status: 500, statusText: 'Error' });
    // forkJoin cancela as outras requisições quando uma falha.
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível carregar');
    element.querySelector<HTMLButtonElement>('button')?.click();
    await fixture.whenStable();
    expect(http.match('/api/organizations/one/plan')).toHaveLength(1);
    http.match('/api/plans');
    http.match('/api/organizations/one/billing');
  });
});

describe('CheckoutPageComponent', () => {
  const active = signal<Organization | null>({ id: 'one', name: 'Equipe', slug: 'e', createdAt: '2026-01-01', role: 'OWNER' });
  const pending = {
    id: 'c1', organizationId: 'one', plan: 'PRO', planName: 'Profissional', status: 'PENDING', provider: 'fake',
    expiresAt: '2030-01-01T10:30:00Z', completedAt: null, createdAt: '2030-01-01T10:00:00Z',
  };

  async function open() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        provideRouter([{ path: 'plan/checkout/:checkoutId', component: CheckoutPageComponent }, { path: 'plan', children: [] }]),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: OrganizationsService, useValue: { active } },
      ],
    });
    const harness = await RouterTestingHarness.create();
    const http = TestBed.inject(HttpTestingController);
    await harness.navigateByUrl('/plan/checkout/c1');
    await harness.fixture.whenStable();
    http.expectOne('/api/organizations/one/billing/checkouts/c1').flush(pending);
    await harness.fixture.whenStable();
    return { http, harness, element: harness.routeNativeElement as HTMLElement };
  }

  it('applies the plan only after the simulated approval', async () => {
    const { http, harness, element } = await open();
    expect(element.textContent).toContain('Nenhum valor é cobrado');
    expect(element.textContent).toContain('Aguardando pagamento');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    button(element, 'Simular pagamento aprovado').click();
    const request = http.expectOne('/api/billing/fake/checkouts/c1/complete');
    expect(request.request.body).toEqual({ outcome: 'approve' });
    request.flush({ ...pending, status: 'PAID', completedAt: '2030-01-01T10:05:00Z' });
    await harness.fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/plan']);
    expect(TestBed.inject(BillingService).takeNotice()).toContain('plano Profissional');
    http.verify();
  });

  it('shows a declined payment and hides the payment buttons', async () => {
    const { http, harness, element } = await open();
    button(element, 'Simular recusa').click();
    http.expectOne('/api/billing/fake/checkouts/c1/complete').flush({ ...pending, status: 'FAILED' });
    await harness.fixture.whenStable();
    expect(element.textContent).toContain('Pagamento recusado');
    expect(element.querySelectorAll('button')).toHaveLength(0);
    http.verify();
  });
});
