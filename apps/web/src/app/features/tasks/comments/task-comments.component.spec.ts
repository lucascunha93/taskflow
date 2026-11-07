import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/api-base-url';
import { AuthService } from '../../../core/auth/auth.service';
import { Organization } from '../../organizations/organization.models';
import { OrganizationsService } from '../../organizations/organizations.service';
import { TaskCommentsComponent } from './task-comments.component';

const memberOrg: Organization = { id: 'one', name: 'Equipe', slug: 'equipe', createdAt: '2026-01-01', role: 'MEMBER' };
const url = '/api/organizations/one/tasks/t1/comments';
const comment = (id: string, authorId: string, body = 'Texto') => ({
  id, taskId: 't1', body, editedAt: null, createdAt: '2026-01-02T10:00:00Z', author: { id: authorId, name: `Pessoa ${authorId}` },
});

describe('TaskCommentsComponent', () => {
  const active = signal<Organization | null>(memberOrg);
  let http: HttpTestingController;
  let fixture: ComponentFixture<TaskCommentsComponent>;
  let element: HTMLElement;

  beforeEach(async () => {
    active.set(memberOrg);
    TestBed.configureTestingModule({
      imports: [TaskCommentsComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: AuthService, useValue: { user: signal({ id: 'me', name: 'Eu', email: 'me@example.test', createdAt: '2026-01-01' }) } },
        { provide: OrganizationsService, useValue: { active } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TaskCommentsComponent);
    fixture.componentRef.setInput('taskId', 't1');
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  function button(text: string): HTMLButtonElement {
    const found = Array.from(element.querySelectorAll('button')).find((item) => item.textContent?.trim() === text);
    if (!found) throw new Error(`Button not found: ${text}`);
    return found;
  }
  function type(selector: string, value: string): void {
    const field = element.querySelector<HTMLTextAreaElement>(selector);
    if (!field) throw new Error(`Field not found: ${selector}`);
    field.value = value;
    field.dispatchEvent(new Event('input'));
  }
  function submit(index = 0): void {
    element.querySelectorAll('form')[index]?.dispatchEvent(new Event('submit', { cancelable: true }));
  }
  async function loadFirstPage(data: object[], nextCursor: string | null = null): Promise<void> {
    const request = http.expectOne((req) => req.url === url);
    expect(request.request.params.get('limit')).toBe('50');
    request.flush({ data, nextCursor });
    await fixture.whenStable();
  }

  it('shows an empty state and posts a trimmed comment', async () => {
    await loadFirstPage([]);
    expect(element.textContent).toContain('Nenhum comentário ainda');
    submit();
    await fixture.whenStable();
    expect(element.textContent).toContain('Escreva o comentário antes de enviar');
    type('#new-comment', '  Vamos priorizar  ');
    submit();
    const post = http.expectOne((req) => req.url === url && req.method === 'POST');
    expect(post.request.body).toEqual({ body: 'Vamos priorizar' });
    post.flush(comment('c1', 'me', 'Vamos priorizar'));
    await fixture.whenStable();
    expect(element.querySelector('.comment-body')?.textContent).toBe('Vamos priorizar');
    expect(element.querySelector<HTMLTextAreaElement>('#new-comment')?.value).toBe('');
  });

  it('only offers edit to the author and delete to the author for members', async () => {
    await loadFirstPage([comment('c1', 'me'), comment('c2', 'other')]);
    const [mine, theirs] = Array.from(element.querySelectorAll('.comment'));
    expect(Array.from(mine.querySelectorAll('button'), (item) => item.textContent?.trim())).toEqual(['Editar', 'Excluir']);
    expect(theirs.querySelectorAll('button')).toHaveLength(0);
  });

  it('lets OWNER and ADMIN delete comments of other people', async () => {
    active.set({ ...memberOrg, role: 'ADMIN' });
    await fixture.whenStable();
    // A troca do contexto recarrega a lista; responde a todas as listagens ainda abertas.
    for (const request of http.match((req) => req.url === url)) {
      if (!request.cancelled) request.flush({ data: [comment('c2', 'other')], nextCursor: null });
    }
    await fixture.whenStable();
    button('Excluir').click();
    await fixture.whenStable();
    button('Confirmar').click();
    const deletion = http.expectOne(`${url}/c2`);
    expect(deletion.request.method).toBe('DELETE');
    deletion.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(element.querySelectorAll('.comment')).toHaveLength(0);
  });

  it('edits a comment and marks it as edited', async () => {
    await loadFirstPage([comment('c1', 'me', 'Antigo')]);
    button('Editar').click();
    await fixture.whenStable();
    type('#edit-c1', ' Novo texto ');
    submit(0);
    const patch = http.expectOne(`${url}/c1`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ body: 'Novo texto' });
    patch.flush({ ...comment('c1', 'me', 'Novo texto'), editedAt: '2026-01-03T10:00:00Z' });
    await fixture.whenStable();
    expect(element.querySelector('.comment-body')?.textContent).toBe('Novo texto');
    expect(element.textContent).toContain('(editado)');
  });

  it('loads more comments with the cursor and reports failures', async () => {
    await loadFirstPage([comment('c1', 'me')], 'c1');
    button('Carregar mais comentários').click();
    const more = http.expectOne((req) => req.url === url && req.params.get('after') === 'c1');
    more.flush({ data: [comment('c2', 'other')], nextCursor: null });
    await fixture.whenStable();
    expect(element.querySelectorAll('.comment')).toHaveLength(2);
    expect(element.textContent).not.toContain('Carregar mais comentários');
    type('#new-comment', 'Falha');
    submit(0);
    http.expectOne((req) => req.url === url && req.method === 'POST').flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível confirmar o comentário');
  });

  it('shows a load error without the form when the task is not accessible', async () => {
    http.expectOne((req) => req.url === url).flush({}, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('não encontrado');
    expect(element.querySelector('#new-comment')).toBeNull();
  });
});
