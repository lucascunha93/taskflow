# TaskFlow — Instruções de Desenvolvimento para GitHub Copilot

## 1. Visão geral do projeto

O TaskFlow é uma plataforma SaaS B2B de gerenciamento de tarefas, desenvolvida para organizações que precisam organizar equipes, acompanhar atividades e gerenciar fluxos de trabalho.

O objetivo é construir um produto com qualidade comercial, arquitetura escalável, segurança, boa experiência de utilização e uma base técnica que demonstre domínio de desenvolvimento Full Stack moderno.

O sistema deve possuir:

- Aplicação Web responsiva.
- API REST.
- Autenticação e autorização.
- Gestão de organizações e membros.
- Gestão de tarefas.
- Controle de acesso por organização.
- Estrutura preparada para planos e funcionalidades SaaS.
- Aplicação mobile futuramente, com suporte a funcionamento offline e sincronização.

**Importante:** não implementar funcionalidades apenas para demonstrar tecnologia. Cada decisão deve contribuir para um produto utilizável e coerente.

---

## 2. Diretrizes obrigatórias para o Copilot

Antes de implementar qualquer funcionalidade:

1. Analise a estrutura atual do repositório.
2. Leia este documento e os arquivos de instruções existentes.
3. Verifique os módulos, serviços, DTOs, modelos e convenções já implementados.
4. Reutilize o código existente sempre que possível.
5. Não recrie funcionalidades que já existem.
6. Não altere contratos da API sem avaliar os impactos no restante do sistema.
7. Não invente funcionalidades ou regras de negócio sem justificativa.
8. Não utilize dados fictícios como se fossem dados reais.
9. Não deixe implementações incompletas, métodos vazios ou comentários TODO como substitutos de funcionalidades solicitadas.
10. Após cada etapa, execute os testes e a compilação.

### Forma de trabalho

O desenvolvimento deve ser incremental.

- Implemente uma funcionalidade por vez.
- Separe responsabilidades em componentes, serviços e módulos.
- Evite arquivos excessivamente grandes.
- Não faça refatorações amplas sem necessidade.
- Explique brevemente as decisões técnicas relevantes.
- Informe quais arquivos foram criados ou modificados.
- Execute os testes correspondentes antes de considerar uma etapa concluída.

Não implemente todo o projeto de uma só vez. Primeiro apresente uma sequência de etapas coerente e depois desenvolva cada uma individualmente.

---

## 3. Arquitetura do repositório

O projeto utiliza um monorepositório com npm workspaces.

Estrutura esperada:

```text
taskflow/
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   ├── src/
│   │   ├── test/
│   │   └── package.json
│   │
│   ├── web/
│   │   ├── src/
│   │   ├── public/
│   │   └── package.json
│   │
│   └── mobile/              # Futuro
│
├── packages/
│   ├── shared-types/        # Futuro, se necessário
│   └── shared-utils/        # Futuro, se necessário
│
├── .github/
│   └── copilot-instructions.md
│
├── package.json
└── README.md
```

Não criar pacotes compartilhados prematuramente. Eles devem existir somente quando houver uma necessidade real de compartilhamento entre aplicações.

---

## 4. Backend — API

### Tecnologias

- Node.js 24.
- NestJS.
- TypeScript com strict mode.
- ESM.
- Prisma ORM.
- PostgreSQL.
- JWT.
- Argon2id.
- class-validator.
- Vitest.

### Arquitetura

Manter a arquitetura modular do NestJS.

Cada domínio deve possuir suas próprias responsabilidades:

```text
src/
├── auth/
├── organizations/
├── tasks/
├── prisma/
├── observe/
├── app.module.ts
└── main.ts
```

Organizar cada módulo em:

- Controller: exposição dos endpoints.
- Service: regras de negócio.
- DTO: validação dos dados de entrada.
- Guard: proteção de rotas, quando necessário.
- Outros componentes: somente quando houver necessidade.

### Regras de implementação

- Controllers não devem concentrar regras de negócio.
- Serviços devem centralizar a lógica de domínio.
- Utilizar DTOs para validar entradas.
- Utilizar tratamento adequado de exceções HTTP.
- Evitar consultas desnecessárias ao banco.
- Utilizar transações quando houver operações dependentes.
- Evitar retornar entidades com informações sensíveis.
- Não utilizar `any` sem justificativa técnica.
- Manter TypeScript strict.
- Utilizar imports compatíveis com ESM e NodeNext.

### Segurança

- Nunca armazenar senhas em texto puro.
- Utilizar Argon2id para hashing.
- Proteger rotas com autenticação.
- Validar autorização no backend, nunca apenas no frontend.
- Não confiar em IDs de usuário enviados pelo cliente.
- Validar a associação dos usuários à organização.
- Não expor hashes, tokens ou segredos nas respostas.
- Tratar corretamente erros de autenticação e autorização.

### Multi-tenancy

O TaskFlow é uma aplicação multi-tenant.

Uma organização representa um tenant.

Toda operação que envolva dados de uma organização deve verificar a associação do usuário com ela.

**Regra fundamental:** nenhuma consulta ou alteração de tarefas pode permitir acesso a dados de outra organização.

O `organizationId` deve ser validado no backend e não pode ser considerado confiável apenas porque veio da rota.

---

## 5. Estado atual do backend

O Copilot deve considerar que já existem implementações em andamento e evoluí-las em vez de substituí-las.

### Prisma

O projeto já utiliza PostgreSQL e Prisma 7, com adapter para PostgreSQL.

Existem os seguintes modelos:

- Organization
- User
- Membership
- Task

Também existem enums:

- OrganizationRole: OWNER, ADMIN, MEMBER.
- TaskStatus: TODO, IN_PROGRESS, DONE, CANCELLED.

O modelo Task já contempla:

- Identificador.
- Título.
- Descrição.
- Organização.
- Criador.
- Responsável.
- Status.
- Versão para controle de concorrência.
- Data de vencimento.
- Datas de criação e atualização.

Não modificar o schema sem avaliar migrações, compatibilidade e impacto nas funcionalidades existentes.

### Autenticação

Já implementado:

- Cadastro de usuários.
- Login.
- Hash de senha com Argon2id.
- Emissão de JWT.
- Endpoint de perfil autenticado.
- Guard de autenticação.

Endpoints:

```http
POST /auth/register
POST /auth/login
GET  /auth/me
```

### Organizações

Já implementado:

- Criação de organização.
- Criação automática de associação OWNER.
- Listagem das organizações do usuário.
- Inclusão de membros.
- Listagem de membros.
- Controle de permissões para inclusão de membros.

Endpoints:

```http
POST /organizations
GET  /organizations
POST /organizations/:organizationId/members
GET  /organizations/:organizationId/members
```

### Tarefas

O módulo de tarefas está em implementação.

Já existe a estrutura inicial de:

- TasksModule.
- TasksController.
- TasksService.
- CreateTaskDto.
- UpdateTaskDto.

A criação de tarefas está sendo implementada com validação de associação à organização.

O Copilot deve verificar a implementação atual antes de continuar.

---

## 6. Funcionalidades que faltam no backend

Desenvolver incrementalmente:

### Gestão de tarefas

- Criar tarefa.
- Listar tarefas de uma organização.
- Buscar tarefa por identificador.
- Atualizar tarefa.
- Alterar status.
- Atribuir responsável.
- Remover responsável.
- Definir prazo.
- Excluir tarefa.
- Filtrar por status.
- Filtrar por responsável.
- Filtrar por período.
- Pesquisar por título.
- Ordenar resultados.
- Paginar resultados.

### Regras de negócio

- Um usuário só pode consultar tarefas de organizações das quais participa.
- O responsável precisa ser membro da organização.
- O criador deve ser identificado pelo JWT.
- O cliente não pode definir livremente o criador.
- A atualização deve respeitar o controle de versão da tarefa.
- Implementar concorrência otimista utilizando o campo `version`.
- Uma atualização com versão desatualizada deve retornar conflito HTTP 409.
- A exclusão deve respeitar as regras de autorização.

### Evoluções futuras

Depois das funcionalidades principais:

- Histórico de alterações.
- Comentários em tarefas.
- Notificações.
- Anexos.
- Atividades recentes.
- Dashboard.
- Gestão de projetos e quadros.
- Permissões mais granulares.
- Planos e limites SaaS.

Não implementar essas evoluções antes de concluir e testar o fluxo principal.

---

# 7. Frontend — Angular

## Tecnologias obrigatórias

Utilizar:

- Angular na versão estável mais recente disponível no momento da implementação.
- TypeScript strict.
- Standalone Components.
- Angular Router.
- Signals.
- Reactive Forms tipados.
- HttpClient.
- Functional Interceptors.
- Functional Guards.
- Lazy Loading.
- Componentes reutilizáveis.
- SCSS.

Antes de iniciar, verificar a versão estável do Angular e compatibilidade com Node.js e TypeScript.

Não utilizar versões beta, release candidates ou APIs experimentais em funcionalidades essenciais.

## Filosofia de desenvolvimento Angular

O projeto deve utilizar os conceitos e as sintaxes modernas do Angular.

Priorizar:

- Componentes standalone.
- `signal()`.
- `computed()`.
- `effect()` somente quando realmente necessário.
- `input()` e `output()`.
- `model()` quando houver necessidade de two-way binding em componentes.
- `@if`.
- `@else`.
- `@for`.
- `@switch`.
- `@defer` quando houver benefício real.
- `inject()` para injeção de dependências.
- Typed Reactive Forms.
- Functional Interceptors.
- Functional Guards.
- Lazy Loading.
- Change Detection moderna.
- Arquitetura baseada em features.

### Sintaxe moderna de templates

Utilizar:

```html
@if (loading()) {
  <app-loading />
} @else if (tasks().length > 0) {
  @for (task of tasks(); track task.id) {
    <app-task-card [task]="task" />
  }
} @else {
  <app-empty-state />
}
```

Não utilizar a sintaxe estrutural antiga `*ngIf`, `*ngFor` ou `*ngSwitch` em novos componentes.

### Signals

Utilizar Signals para estados locais e estados de interface.

Exemplo:

```typescript
import { computed, signal } from '@angular/core';

export class TaskListComponent {
  readonly tasks = signal<Task[]>([]);

  readonly completedTasks = computed(() =>
    this.tasks().filter(task => task.status === 'DONE'),
  );

  readonly pendingTasks = computed(() =>
    this.tasks().filter(task => task.status !== 'DONE'),
  );
}
```

Não utilizar Signals indiscriminadamente.

Para fluxos assíncronos complexos, eventos e operações reativas, utilizar RxJS quando fizer sentido.

### Componentes

Utilizar `input()` e `output()` nos novos componentes, conforme a necessidade.

Exemplo:

```typescript
import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-task-card',
  standalone: true,
  templateUrl: './task-card.component.html',
})
export class TaskCardComponent {
  readonly task = input.required<Task>();

  readonly edit = output<Task>();
}
```

Evitar componentes gigantescos.

Um componente deve ter uma responsabilidade clara.

### Estado e comunicação

- Serviços devem centralizar comunicação com a API.
- Componentes não devem realizar chamadas HTTP diretamente.
- Utilizar Signals para estados de interface.
- Utilizar RxJS para operações assíncronas quando apropriado.
- Evitar duplicação de estado.
- Evitar serviços globais com responsabilidades excessivas.
- Não introduzir bibliotecas de gerenciamento de estado sem necessidade real.

### Formulários

Utilizar Reactive Forms tipados.

Validar no frontend para melhorar a experiência, mas sempre validar novamente no backend.

Criar componentes reutilizáveis para campos, mensagens de validação e estados de formulário quando isso reduzir duplicação.

### HTTP

Criar uma camada organizada de comunicação com a API.

Implementar:

- Interceptor de autenticação.
- Tratamento centralizado de erros.
- Tratamento de sessão expirada.
- Tipagem das respostas.
- Loading states.
- Tratamento de erros de rede.

Nunca armazenar segredos no frontend.

Não presumir que esconder um botão significa que o usuário não possui permissão. A API continua sendo responsável pela autorização.

---

## 8. Organização do frontend

Estrutura inicial sugerida:

```text
apps/web/src/app/
├── core/
│   ├── auth/
│   ├── guards/
│   ├── interceptors/
│   ├── services/
│   └── layout/
│
├── shared/
│   ├── components/
│   ├── directives/
│   ├── pipes/
│   └── utils/
│
├── features/
│   ├── authentication/
│   │   ├── pages/
│   │   ├── components/
│   │   └── services/
│   │
│   ├── dashboard/
│   │   ├── pages/
│   │   └── components/
│   │
│   ├── organizations/
│   │   ├── pages/
│   │   ├── components/
│   │   └── services/
│   │
│   ├── tasks/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── services/
│   │   └── models/
│   │
│   └── members/
│       ├── pages/
│       ├── components/
│       └── services/
│
├── app.config.ts
├── app.routes.ts
└── app.component.ts
```

A estrutura pode ser ajustada conforme o crescimento do projeto, desde que mantenha separação por domínio e responsabilidade.

---

# 9. Experiência visual e interface

O TaskFlow deve apresentar uma experiência visual de produto SaaS profissional.

Referências de qualidade:

- Linear.
- Notion.
- ClickUp.
- Asana.
- Monday.com.

Essas referências servem como inspiração de usabilidade e organização, não para copiar interfaces ou identidade visual.

### Diretrizes visuais

- Interface limpa e moderna.
- Hierarquia visual clara.
- Espaçamento consistente.
- Tipografia profissional.
- Componentes padronizados.
- Feedback visual para ações.
- Estados de carregamento.
- Estados vazios.
- Mensagens de erro claras.
- Responsividade.
- Acessibilidade.

Evitar:

- Aparência de painel administrativo genérico.
- Excesso de cores.
- Gradientes exagerados.
- Muitos cards sem propósito.
- Ícones inconsistentes.
- Botões sem feedback.
- Interfaces com aparência de protótipo.

### Layout principal

A aplicação autenticada deve possuir:

- Sidebar com navegação.
- Identificação da organização atual.
- Área principal de conteúdo.
- Menu do usuário.
- Acesso às configurações.
- Layout responsivo para dispositivos menores.

### Páginas principais

1. Login.
2. Cadastro.
3. Seleção/criação de organização.
4. Dashboard.
5. Lista de tarefas.
6. Detalhes da tarefa.
7. Criação e edição de tarefas.
8. Gestão de membros.
9. Configurações da organização.
10. Perfil do usuário.

---

# 10. Autenticação e navegação

Implementar o fluxo:

1. Usuário acessa a aplicação.
2. Caso não esteja autenticado, é direcionado ao login.
3. Após autenticação, o frontend consulta `/auth/me`.
4. O usuário consulta suas organizações.
5. Caso não tenha organização, é direcionado para criar uma.
6. Caso tenha uma organização, pode selecioná-la.
7. A organização selecionada passa a ser o contexto de navegação.
8. As chamadas de tarefas utilizam o identificador da organização selecionada.

Criar guards funcionais para proteger rotas.

Criar interceptor funcional para adicionar o Bearer Token.

Tratar sessão expirada de forma consistente.

A estratégia de armazenamento de tokens deve considerar os riscos de XSS e as limitações da arquitetura atual. Avaliar uma evolução para cookies HttpOnly, Secure e SameSite antes de uma publicação em produção. Não apresentar localStorage como armazenamento seguro por padrão.

---

# 11. Integração entre frontend e backend

O frontend deve consumir exclusivamente a API.

Não acessar o banco diretamente.

Centralizar a URL da API em configuração de ambiente.

Criar modelos TypeScript alinhados aos contratos reais do backend.

Evitar duplicar regras de negócio no frontend.

Não inventar endpoints. Conferir os controllers existentes antes de implementar cada integração.

Se um endpoint necessário ainda não existir:

1. Identificar a necessidade.
2. Implementar o endpoint no backend.
3. Validar sua autorização.
4. Testar a API.
5. Integrar o frontend.

---

# 12. Qualidade e testes

A qualidade deve ser tratada como parte da implementação.

### Backend

- Testes unitários dos serviços.
- Testes dos controllers quando apropriado.
- Testes de integração.
- Testes de autenticação.
- Testes de autorização.
- Testes de isolamento entre organizações.
- Testes de concorrência otimista.

### Frontend

- Testes unitários dos serviços.
- Testes de componentes.
- Testes de formulários.
- Testes de guards.
- Testes de interceptors.
- Testes dos principais fluxos de navegação.
- Testes de integração quando apropriado.

### Regras

- Não considerar uma funcionalidade pronta sem testes relevantes.
- Não remover testes para fazer a compilação passar.
- Não ignorar erros de TypeScript.
- Não desabilitar regras do ESLint sem justificativa.
- Não utilizar mocks para mascarar falhas de integração.

---

# 13. Performance e escalabilidade

Considerar desde o início:

- Paginação no backend.
- Índices adequados no banco.
- Consultas eficientes.
- Lazy Loading no Angular.
- Evitar renderizações desnecessárias.
- Evitar chamadas HTTP repetidas.
- Cache somente quando houver estratégia clara.
- Controle de concorrência.
- Logs estruturados.
- Observabilidade.
- Tratamento de erros.

Não implementar otimizações prematuras sem identificar um problema ou necessidade.

---

# 14. Segurança e produção

Antes de disponibilizar o sistema publicamente, avaliar:

- Rate limiting.
- CORS restritivo.
- Helmet.
- Validação de variáveis de ambiente.
- Gestão segura de segredos.
- Política de expiração e renovação de tokens.
- Proteção contra brute force.
- Proteção contra XSS e CSRF conforme a estratégia de autenticação.
- Logs sem informações sensíveis.
- Backup do PostgreSQL.
- Migrações de banco controladas.
- Health checks.
- Monitoramento de erros.

Nunca versionar `.env`, credenciais ou tokens.

---

# 15. Roadmap de desenvolvimento

Seguir esta sequência, validando cada etapa antes de avançar.

## Fase 1 — Finalização do backend principal

- CRUD completo de tarefas.
- Filtros e paginação.
- Validação de responsáveis.
- Controle de permissões.
- Controle de concorrência.
- Testes de isolamento multi-tenant.

## Fase 2 — Estrutura do Angular

- Criar aplicação Angular.
- Configurar TypeScript strict.
- Configurar SCSS.
- Configurar rotas.
- Criar estrutura por features.
- Criar layout principal.
- Criar componentes compartilhados.

## Fase 3 — Autenticação

- Login.
- Cadastro.
- Interceptor.
- Guards.
- Recuperação do perfil.
- Tratamento de sessão.

## Fase 4 — Organizações

- Listagem.
- Criação.
- Seleção de organização.
- Listagem de membros.
- Inclusão de membros.
- Controle visual de permissões.

## Fase 5 — Tarefas

- Listagem.
- Criação.
- Edição.
- Exclusão.
- Alteração de status.
- Atribuição de responsáveis.
- Filtros.
- Paginação.

## Fase 6 — Dashboard

- Resumo de tarefas.
- Tarefas pendentes.
- Tarefas concluídas.
- Tarefas atrasadas.
- Distribuição por status.
- Atividades recentes, quando houver suporte no backend.

Os indicadores devem ser calculados a partir de dados reais.

## Fase 7 — Qualidade e acabamento

- Testes.
- Responsividade.
- Acessibilidade.
- Performance.
- Tratamento de erros.
- Revisão de segurança.
- Documentação.

## Fase 8 — Evoluções do produto

- Comentários.
- Histórico.
- Notificações.
- Projetos e quadros.
- Anexos.
- Funcionalidades SaaS.
- Aplicação mobile.
- Funcionamento offline e sincronização.

---

# 16. Critérios de conclusão

Uma funcionalidade somente pode ser considerada concluída quando:

- Está implementada.
- Está integrada ao restante do sistema.
- Possui validação adequada.
- Respeita as permissões.
- Não compromete o isolamento entre organizações.
- Possui tratamento de erros.
- Possui testes relevantes.
- O projeto compila.
- A documentação foi atualizada quando necessário.

---

# 17. Primeira instrução para o Copilot

Ao receber este documento pela primeira vez, NÃO comece a implementar todas as funcionalidades.

Primeiro:

1. Analise o repositório completo.
2. Identifique o que já está implementado.
3. Verifique o estado atual do backend.
4. Verifique a configuração do monorepositório.
5. Verifique se a aplicação Angular já existe.
6. Identifique inconsistências entre o código e este documento.
7. Apresente um diagnóstico objetivo.
8. Sugira a próxima etapa de desenvolvimento.

Aguarde a aprovação antes de executar mudanças estruturais.

**Objetivo final:** construir um SaaS B2B Full Stack profissional, seguro, escalável e com uma experiência de usuário de qualidade comercial, utilizando Angular moderno e NestJS com TypeScript.