import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/api-base-url';
import { AuthService } from '../../../core/auth/auth.service';
import { Organization } from '../../organizations/organization.models';
import { OrganizationsService } from '../../organizations/organizations.service';
import { formatBytes, localFileProblem } from './attachment.models';
import { TaskAttachmentsComponent } from './task-attachments.component';

const url = '/api/organizations/one/tasks/t1/attachments';
const attachment = (id: string, uploaderId = 'me', fileName = 'relatorio.pdf') => ({
  id, taskId: 't1', fileName, contentType: 'application/pdf', size: 2048, createdAt: '2026-01-02T10:00:00Z',
  uploader: { id: uploaderId, name: `Pessoa ${uploaderId}` },
});

describe('attachment helpers', () => {
  it('validates extension, emptiness and size like the API', () => {
    expect(localFileProblem({ name: 'a.PDF', size: 10 })).toBeNull();
    expect(localFileProblem({ name: 'a.svg', size: 10 })).toContain('não permitido');
    expect(localFileProblem({ name: 'a.png', size: 0 })).toContain('vazio');
    expect(localFileProblem({ name: 'a.png', size: 10 * 1024 * 1024 + 1 })).toContain('10 MB');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
  });
});

describe('TaskAttachmentsComponent', () => {
  const active = signal<Organization | null>({ id: 'one', name: 'Equipe', slug: 'e', createdAt: '2026-01-01', role: 'MEMBER' });
  let http: HttpTestingController;
  let fixture: ComponentFixture<TaskAttachmentsComponent>;
  let element: HTMLElement;

  beforeEach(async () => {
    active.set({ id: 'one', name: 'Equipe', slug: 'e', createdAt: '2026-01-01', role: 'MEMBER' });
    TestBed.configureTestingModule({
      imports: [TaskAttachmentsComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: AuthService, useValue: { user: signal({ id: 'me', name: 'Eu', email: 'me@example.test', createdAt: '2026-01-01' }) } },
        { provide: OrganizationsService, useValue: { active } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TaskAttachmentsComponent);
    fixture.componentRef.setInput('taskId', 't1');
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  function choose(file: File): void {
    const input = element.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('File input not found');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  }
  function button(text: string): HTMLButtonElement {
    const found = Array.from(element.querySelectorAll('button')).find((item) => item.textContent?.trim() === text);
    if (!found) throw new Error(`Button not found: ${text}`);
    return found;
  }

  it('lists attachments and offers delete only for own files to members', async () => {
    http.expectOne(url).flush([attachment('a1'), attachment('a2', 'other', 'foto.png')]);
    await fixture.whenStable();
    const rows = Array.from(element.querySelectorAll('.attachment'));
    expect(rows.map((row) => row.querySelector('.name')?.textContent)).toEqual(['relatorio.pdf', 'foto.png']);
    expect(rows[0].textContent).toContain('2 KB');
    expect(rows[0].textContent).toContain('Excluir');
    expect(rows[1].textContent).not.toContain('Excluir');
  });

  it('rejects disallowed files locally and uploads valid ones with progress', async () => {
    http.expectOne(url).flush([]);
    await fixture.whenStable();
    choose(new File(['<svg/>'], 'desenho.svg', { type: 'image/svg+xml' }));
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('não permitido');
    http.expectNone((req) => req.method === 'POST');

    choose(new File(['%PDF-1.7'], 'contrato.pdf', { type: 'application/pdf' }));
    const post = http.expectOne((req) => req.url === url && req.method === 'POST');
    expect(post.request.body instanceof FormData).toBe(true);
    expect((post.request.body as FormData).get('file')).toBeInstanceOf(File);
    post.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
    await fixture.whenStable();
    expect(element.textContent).toContain('Enviando “contrato.pdf”… 50%');
    post.flush(attachment('a3', 'me', 'contrato.pdf'));
    await fixture.whenStable();
    expect(element.querySelector('.name')?.textContent).toBe('contrato.pdf');
    expect(element.textContent).not.toContain('Enviando');
  });

  it('maps API rejections to clear messages', async () => {
    http.expectOne(url).flush([]);
    await fixture.whenStable();
    choose(new File(['%PDF-1.7'], 'a.pdf'));
    http.expectOne((req) => req.method === 'POST').flush({}, { status: 415, statusText: 'Unsupported Media Type' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('conteúdo diferente da extensão');
    choose(new File(['%PDF-1.7'], 'b.pdf'));
    http.expectOne((req) => req.method === 'POST').flush({}, { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('armazenamento não está configurado');
  });

  it('downloads through a short-lived signed URL', async () => {
    http.expectOne(url).flush([attachment('a1')]);
    await fixture.whenStable();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    button('relatorio.pdf').click();
    http.expectOne(`${url}/a1/download`).flush({ url: 'http://localhost:8333/bucket/key?X-Amz-Signature=abc', expiresAt: '2030-01-01T00:00:00Z' });
    expect(click).toHaveBeenCalledOnce();
    const link = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(link.href).toBe('http://localhost:8333/bucket/key?X-Amz-Signature=abc');
    expect(link.download).toBe('relatorio.pdf');
    click.mockRestore();
  });

  it('lets managers delete files of others after confirmation', async () => {
    active.set({ id: 'one', name: 'Equipe', slug: 'e', createdAt: '2026-01-01', role: 'ADMIN' });
    await fixture.whenStable();
    for (const request of http.match(url)) if (!request.cancelled) request.flush([attachment('a2', 'other', 'foto.png')]);
    await fixture.whenStable();
    button('Excluir').click();
    await fixture.whenStable();
    button('Confirmar').click();
    const deletion = http.expectOne(`${url}/a2`);
    expect(deletion.request.method).toBe('DELETE');
    deletion.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(element.textContent).toContain('Nenhum anexo');
  });
});
