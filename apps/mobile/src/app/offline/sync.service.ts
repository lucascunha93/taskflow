import { DestroyRef, Injectable, InjectionToken, computed, effect, inject, signal, untracked } from '@angular/core';
import { App } from '@capacitor/app';
import { NetworkService } from '../core/network.service';
import { SessionService } from '../core/session.service';
import { HttpTasksApi, OrganizationSummary } from './http-tasks-api';
import { LocalStore } from './local-store';
import { OutboxOp, Resolution } from './outbox.models';
import { SyncEngine } from './sync-engine';
import { Member, Project, TaskFields, TaskView } from './task.models';

export const LOCAL_STORE = new InjectionToken<LocalStore>('LOCAL_STORE');

/**
 * - `idle`: sincronizado (ou nada a fazer).
 * - `syncing`: enviando e recebendo.
 * - `offline`: sem conexão; as alterações ficam na fila.
 * - `retrying`: o servidor falhou; nova tentativa agendada.
 * - `signed-out`: a sessão expirou; a fila espera um novo login.
 */
export type SyncState = 'idle' | 'syncing' | 'offline' | 'retrying' | 'signed-out';

const PERIODIC_SYNC_MS = 60_000;

/**
 * Orquestra o uso offline: organização ativa, cache de tarefas, membros e
 * projetos, alterações locais e sincronização. Sincroniza ao abrir o app, ao
 * reconectar, ao voltar ao primeiro plano, logo após cada alteração local, a
 * cada minuto com o app aberto e quando o usuário puxa a lista.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly store = inject(LOCAL_STORE);
  private readonly api = inject(HttpTasksApi);
  private readonly session = inject(SessionService);
  private readonly network = inject(NetworkService);
  private readonly engine = new SyncEngine(this.store, this.api);

  private readonly stateSignal = signal<SyncState>('idle');
  private readonly lastSyncSignal = signal<string | null>(null);
  private readonly organizationsSignal = signal<OrganizationSummary[]>([]);
  private readonly activeIdSignal = signal<string | null>(null);
  private readonly tasksSignal = signal<TaskView[]>([]);
  private readonly membersSignal = signal<Member[]>([]);
  private readonly projectsSignal = signal<Project[]>([]);
  private readonly issuesSignal = signal<OutboxOp[]>([]);
  private readonly pendingSignal = signal(0);

  readonly state = this.stateSignal.asReadonly();
  readonly lastSyncAt = this.lastSyncSignal.asReadonly();
  readonly organizations = this.organizationsSignal.asReadonly();
  readonly tasks = this.tasksSignal.asReadonly();
  readonly members = this.membersSignal.asReadonly();
  readonly projects = this.projectsSignal.asReadonly();
  readonly issues = this.issuesSignal.asReadonly();
  readonly pendingCount = this.pendingSignal.asReadonly();
  readonly activeOrganization = computed(() =>
    this.organizationsSignal().find((organization) => organization.id === this.activeIdSignal()) ?? null);

  private readonly scope = computed(() => {
    const userId = this.session.user()?.id;
    const organizationId = this.activeIdSignal();
    return userId && organizationId ? `${userId}:${organizationId}` : null;
  });

  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loadedFor: string | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const stopNetwork = this.network.onChange((online) => {
      if (online) void this.sync();
      else this.stateSignal.set('offline');
    });
    const interval = setInterval(() => void this.sync(), PERIODIC_SYNC_MS);
    const resume = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void this.sync();
    }).catch(() => null);
    destroyRef.onDestroy(() => {
      stopNetwork();
      clearInterval(interval);
      if (this.timer) clearTimeout(this.timer);
      void resume.then((handle) => handle?.remove());
    });

    // Ao entrar (ou trocar de usuário), carrega o que o aparelho já tem e sincroniza.
    effect(() => {
      const userId = this.session.user()?.id ?? null;
      const signedIn = this.session.signedIn();
      untracked(() => {
        if (!userId || !signedIn) {
          this.loadedFor = null;
          return;
        }
        if (this.loadedFor === userId) return;
        this.loadedFor = userId;
        void this.loadUser(userId);
      });
    });
  }

  /** Apaga todos os dados locais (logout ou troca de usuário). */
  async wipe(): Promise<void> {
    await this.store.clear();
    this.organizationsSignal.set([]);
    this.activeIdSignal.set(null);
    this.tasksSignal.set([]);
    this.membersSignal.set([]);
    this.projectsSignal.set([]);
    this.issuesSignal.set([]);
    this.pendingSignal.set(0);
    this.lastSyncSignal.set(null);
  }

  async selectOrganization(organizationId: string): Promise<void> {
    const userId = this.session.user()?.id;
    if (!userId) return;
    this.activeIdSignal.set(organizationId);
    await this.store.setMeta(`active:${userId}`, organizationId);
    await this.refreshLocal();
    void this.sync();
  }

  // --------------------------------------------------------- alterações locais

  async createTask(fields: TaskFields): Promise<string> {
    const { scope, organizationId } = this.requireScope();
    const id = await this.engine.create(scope, organizationId, fields);
    await this.afterLocalChange();
    return id;
  }

  async updateTask(taskId: string, changes: Partial<TaskFields>): Promise<void> {
    const { scope, organizationId } = this.requireScope();
    await this.engine.update(scope, organizationId, taskId, changes);
    await this.afterLocalChange();
  }

  async deleteTask(taskId: string): Promise<void> {
    const { scope, organizationId } = this.requireScope();
    await this.engine.remove(scope, organizationId, taskId);
    await this.afterLocalChange();
  }

  async resolve(seq: number, resolution: Resolution): Promise<void> {
    await this.engine.resolve(seq, resolution);
    await this.afterLocalChange();
  }

  /** Quantidade de alterações deste usuário ainda não enviadas (todas as organizações). */
  async unsentCount(): Promise<number> {
    return this.engine.pendingCount();
  }

  // ------------------------------------------------------------ sincronização

  /** Sincroniza agora; chamadas durante uma sincronização geram mais uma rodada ao final. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.runSync().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.sync();
      }
    });
    return this.running;
  }

  private async runSync(): Promise<void> {
    if (!this.session.signedIn() || !this.session.user()) return;
    if (!this.network.online()) {
      this.stateSignal.set('offline');
      return;
    }
    this.stateSignal.set('syncing');
    try {
      const outcome = await this.engine.push();
      if (outcome === 'auth') {
        this.stateSignal.set('signed-out');
        return;
      }
      await this.refreshOrganizations();
      const scope = this.scope();
      const organizationId = this.activeIdSignal();
      if (scope && organizationId) {
        await this.engine.pull(scope, organizationId);
        const [members, projects] = await Promise.all([this.api.members(organizationId), this.api.projects(organizationId)]);
        await this.store.setMeta(`members:${scope}`, members);
        await this.store.setMeta(`projects:${scope}`, projects);
        const now = new Date().toISOString();
        await this.store.setMeta(`lastSync:${scope}`, now);
      }
      this.stateSignal.set(outcome === 'retry' ? 'retrying' : 'idle');
      if (outcome === 'retry') this.schedule(15_000);
    } catch {
      this.stateSignal.set(this.network.online() ? 'retrying' : 'offline');
      this.schedule(30_000);
    } finally {
      await this.refreshLocal();
    }
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync();
    }, delayMs);
  }

  // ------------------------------------------------------------------ interno

  private async loadUser(userId: string): Promise<void> {
    const [organizations, active] = await Promise.all([
      this.store.getMeta<OrganizationSummary[]>(`organizations:${userId}`),
      this.store.getMeta<string>(`active:${userId}`),
    ]);
    this.organizationsSignal.set(organizations ?? []);
    this.activeIdSignal.set(active ?? null);
    await this.refreshLocal();
    await this.sync();
  }

  private async refreshOrganizations(): Promise<void> {
    const userId = this.session.user()?.id;
    if (!userId) return;
    const organizations = await this.api.organizations();
    await this.store.setMeta(`organizations:${userId}`, organizations);
    this.organizationsSignal.set(organizations);
    const active = this.activeIdSignal();
    // Sem acesso à organização ativa (ou nenhuma escolhida com apenas uma disponível).
    if (active && !organizations.some((organization) => organization.id === active)) this.activeIdSignal.set(null);
    if (!this.activeIdSignal() && organizations.length === 1) {
      this.activeIdSignal.set(organizations[0].id);
      await this.store.setMeta(`active:${userId}`, organizations[0].id);
    }
  }

  /** Recarrega os sinais a partir do armazenamento local. */
  private async refreshLocal(): Promise<void> {
    const scope = this.scope();
    const [tasks, members, projects, lastSync, issues, pending] = await Promise.all([
      scope ? this.engine.view(scope) : Promise.resolve([]),
      scope ? this.store.getMeta<Member[]>(`members:${scope}`) : Promise.resolve(undefined),
      scope ? this.store.getMeta<Project[]>(`projects:${scope}`) : Promise.resolve(undefined),
      scope ? this.store.getMeta<string>(`lastSync:${scope}`) : Promise.resolve(undefined),
      this.engine.issues(),
      this.engine.pendingCount(),
    ]);
    if (scope !== this.scope()) return; // a organização mudou durante a leitura
    this.tasksSignal.set(tasks);
    this.membersSignal.set(members ?? []);
    this.projectsSignal.set(projects ?? []);
    this.lastSyncSignal.set(lastSync ?? null);
    this.issuesSignal.set(issues);
    this.pendingSignal.set(pending);
  }

  private async afterLocalChange(): Promise<void> {
    await this.refreshLocal();
    void this.sync();
  }

  private requireScope(): { scope: string; organizationId: string } {
    const scope = this.scope();
    const organizationId = this.activeIdSignal();
    if (!scope || !organizationId) throw new Error('Escolha uma organização.');
    return { scope, organizationId };
  }
}
