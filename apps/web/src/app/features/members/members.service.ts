import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { planLimitMessage } from '../plans/plan.models';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Subscription, map } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base-url';
import { OrganizationsService } from '../organizations/organizations.service';
import { AddMemberRole, Member } from './member.models';

type Status = 'idle' | 'loading' | 'ready' | 'error';

function memberFromResponse(value: unknown): Member {
  if (typeof value !== 'object' || value === null ||
    !('id' in value) || typeof value.id !== 'string' || !value.id ||
    !('createdAt' in value) || typeof value.createdAt !== 'string' || !value.createdAt ||
    !('role' in value) || (value.role !== 'OWNER' && value.role !== 'ADMIN' && value.role !== 'MEMBER') ||
    !('user' in value) || typeof value.user !== 'object' || value.user === null ||
    !('id' in value.user) || typeof value.user.id !== 'string' || !value.user.id ||
    !('name' in value.user) || typeof value.user.name !== 'string' || !value.user.name ||
    !('email' in value.user) || typeof value.user.email !== 'string' || !value.user.email) {
    throw new Error('Resposta de membro inválida.');
  }
  return {
    id: value.id, role: value.role, createdAt: value.createdAt,
    user: { id: value.user.id, name: value.user.name, email: value.user.email },
  };
}

function addedFromResponse(value: unknown): Member {
  if (typeof value !== 'object' || value === null ||
    !('membership' in value) || typeof value.membership !== 'object' || value.membership === null ||
    !('user' in value)) throw new Error('Resposta de inclusão inválida.');
  return memberFromResponse({ ...value.membership, user: value.user });
}

@Injectable()
export class MembersService {
  private readonly http = inject(HttpClient);
  private readonly organizations = inject(OrganizationsService);
  private readonly baseUrl = inject(API_BASE_URL).replace(/\/+$/, '');
  private readonly contextId = signal<string | null>(null);
  private readonly membersState = signal<Member[]>([]);
  private readonly statusState = signal<Status>('idle');
  private readonly loadErrorState = signal('');
  private readonly addingState = signal(false);
  private readonly addErrorState = signal('');
  private readonly successState = signal('');
  private readonly reload = signal(0);
  private readonly activeId = computed(() => this.organizations.active()?.id ?? null);
  private addRequest: Subscription | null = null;
  private generation = 0;

  private readonly current = computed(() => this.contextId() !== null &&
    this.contextId() === this.organizations.active()?.id);
  readonly members = computed(() => this.current() ? this.membersState() : []);
  readonly status = computed<Status>(() => {
    if (!this.organizations.active()) return 'idle';
    return this.current() ? this.statusState() : 'loading';
  });
  readonly loadError = computed(() => this.current() ? this.loadErrorState() : '');
  readonly adding = computed(() => this.current() && this.addingState());
  readonly addError = computed(() => this.current() ? this.addErrorState() : '');
  readonly success = computed(() => this.current() ? this.successState() : '');

  constructor() {
    effect((onCleanup) => {
      const organizationId = this.activeId();
      this.reload();
      const generation = ++this.generation;
      this.contextId.set(organizationId);
      this.membersState.set([]);
      this.loadErrorState.set('');
      this.addErrorState.set('');
      this.successState.set('');
      this.addingState.set(false);
      if (!organizationId) {
        this.statusState.set('idle');
        return;
      }
      this.statusState.set('loading');
      const request = this.http.get<unknown>(this.url(organizationId)).pipe(map((value) => {
        if (!Array.isArray(value)) throw new Error('Resposta de membros inválida.');
        return value.map(memberFromResponse);
      })).subscribe({
        next: (members) => {
          if (!this.isCurrent(organizationId, generation)) return;
          this.membersState.set(members);
          this.statusState.set('ready');
        },
        error: (error: unknown) => {
          if (!this.isCurrent(organizationId, generation)) return;
          if (error instanceof HttpErrorResponse && error.status === 403) {
            this.loadErrorState.set('Você não tem permissão para visualizar os membros desta organização.');
          } else if (error instanceof HttpErrorResponse && error.status === 404) {
            this.loadErrorState.set('Organização não encontrada ou acesso indisponível. Atualize suas organizações e tente novamente.');
          } else {
            this.loadErrorState.set('Não foi possível carregar os membros. Verifique a conexão e tente novamente.');
          }
          this.statusState.set('error');
        },
      });
      onCleanup(() => {
        request.unsubscribe();
        this.addRequest?.unsubscribe();
        this.addRequest = null;
      });
    });
  }

  refresh(): void {
    this.reload.update((value) => value + 1);
  }

  add(email: string, role: AddMemberRole): void {
    const organization = this.organizations.active();
    if (!organization || !this.current() || this.statusState() !== 'ready' || this.addingState()) return;
    if ((organization.role !== 'OWNER' && organization.role !== 'ADMIN') ||
      (role !== 'MEMBER' && !(role === 'ADMIN' && organization.role === 'OWNER'))) {
      this.addErrorState.set('Você não tem permissão para atribuir esta função.');
      return;
    }
    const generation = this.generation;
    this.addErrorState.set('');
    this.successState.set('');
    this.addingState.set(true);
    this.addRequest = this.http.post<unknown>(this.url(organization.id), { email, role }).pipe(map(addedFromResponse)).subscribe({
      next: (member) => {
        if (!this.isCurrent(organization.id, generation)) return;
        this.membersState.update((members) => [...members.filter((item) => item.id !== member.id), member]);
        this.addingState.set(false);
        this.successState.set('Membro adicionado à organização.');
      },
      error: (error: unknown) => {
        if (!this.isCurrent(organization.id, generation)) return;
        this.addingState.set(false);
        const planLimit = planLimitMessage(error);
        if (planLimit) {
          this.addErrorState.set(planLimit);
        } else if (error instanceof HttpErrorResponse && error.status === 403) {
          this.addErrorState.set('Você não tem permissão para adicionar este membro. Verifique sua função.');
        } else if (error instanceof HttpErrorResponse && error.status === 404) {
          this.addErrorState.set('Usuário não encontrado ou organização indisponível. Verifique o e-mail e o acesso à organização.');
        } else if (error instanceof HttpErrorResponse && error.status === 409) {
          this.addErrorState.set('Este usuário já pertence à organização.');
        } else {
          this.addErrorState.set('Não foi possível confirmar a inclusão. Atualize a lista antes de tentar novamente.');
        }
      },
    });
  }

  private url(organizationId: string): string {
    return `${this.baseUrl}/organizations/${encodeURIComponent(organizationId)}/members`;
  }

  private isCurrent(organizationId: string, generation: number): boolean {
    return this.generation === generation && this.organizations.active()?.id === organizationId;
  }
}
