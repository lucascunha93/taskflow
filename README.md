# TaskFlow

**TaskFlow** é uma plataforma SaaS B2B para gestão de tarefas e operações empresariais, composta por painel web, aplicativo mobile e API própria. Seu principal diferencial é permitir que colaboradores continuem executando tarefas sem conexão e sincronizem as alterações de forma confiável quando a rede voltar.

> Status: em planejamento / desenvolvimento inicial. Funcionalidades e comandos serão atualizados à medida que forem implementados e validados.

## Visão do produto

O TaskFlow centraliza a criação, distribuição, execução e acompanhamento de tarefas empresariais.

- **Web:** gestores organizam equipes, distribuem tarefas e acompanham indicadores.
- **Mobile:** colaboradores consultam tarefas, executam checklists e registram alterações.
- **Offline-first no mobile:** operações são persistidas localmente e sincronizadas quando possível.
- **Multi-tenant:** cada organização acessa apenas os dados autorizados.
- **Rastreabilidade:** mudanças importantes geram histórico auditável.

O objetivo do projeto também é demonstrar engenharia de software aplicada: arquitetura modular, segurança, consistência de dados, testes automatizados, documentação e entrega contínua.

## Funcionalidades planejadas para o MVP

- [ ] Autenticação e gerenciamento de sessão.
- [ ] Organizações e associação de membros.
- [ ] Controle de acesso por papel: `admin`, `manager`, `member`.
- [ ] Criação, consulta, atribuição e atualização de tarefas.
- [ ] Transições de status validadas pelo backend.
- [ ] Checklists associados às tarefas.
- [ ] Histórico de alterações.
- [ ] Dashboard operacional com filtros e indicadores básicos.
- [ ] Aplicativo Ionic com persistência local em SQLite.
- [ ] Fila durável de operações offline.
- [ ] Sincronização push/pull com idempotência e detecção de conflitos.
- [ ] Docker Compose para desenvolvimento local.
- [ ] Testes automatizados e pipeline de CI.

Funcionalidades como notificações push, anexos avançados, relatórios exportáveis e integrações externas ficam para versões posteriores.

## Stack planejada

| Camada | Tecnologia |
|---|---|
| Web | Angular + TypeScript |
| Mobile | Ionic + Angular + Capacitor |
| API | Node.js + TypeScript + NestJS |
| Banco central | PostgreSQL |
| ORM e migrations | Prisma |
| Banco local mobile | SQLite |
| Contratos de API | REST + OpenAPI/Swagger |
| Ambiente local | Docker Compose |
| CI/CD | GitHub Actions |
| Testes | Testes unitários, integração e ponta a ponta conforme o módulo |

A arquitetura inicial será um **monólito modular**. Os módulos compartilham a aplicação backend e o PostgreSQL, mantendo limites claros entre domínios. Microserviços só serão considerados se houver uma necessidade concreta documentada.

## Arquitetura de alto nível

```text
                 ┌──────────────────────┐
                 │     Web Angular      │
                 └──────────┬───────────┘
                            │ HTTPS / REST
                 ┌──────────▼───────────┐
                 │   API NestJS         │
                 │  /api/v1              │
                 │                      │
                 │ Auth / Organizations │
                 │ Memberships / Tasks  │
                 │ Sync / Audit         │
                 └──────────┬───────────┘
                            │
                 ┌──────────▼───────────┐
                 │     PostgreSQL       │
                 └──────────────────────┘

     ┌─────────────────────┐
     │ Ionic + Capacitor   │
     │ Mobile              │
     └──────────┬──────────┘
                │
        ┌───────▼────────┐
        │ SQLite local   │
        │ Cache + fila   │
        └───────┬────────┘
                │ Push / Pull quando possível
                └──────────────► API NestJS
```

## Estrutura prevista do repositório

```text
taskflow/
├── apps/
│   ├── api/                 # API NestJS
│   ├── web/                 # Aplicação Angular
│   └── mobile/              # Aplicação Ionic + Capacitor
├── packages/
│   └── api-contracts/       # Contratos compartilhados e tipos públicos
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── infra/
│   ├── docker/
│   └── scripts/
├── .github/
│   ├── copilot-instructions.md
│   └── workflows/
├── docker-compose.yml
└── README.md
```

A estrutura é uma proposta inicial e pode ser ajustada durante a configuração real do monorepo.

## Princípios de engenharia

1. **Segurança no backend:** validação e autorização não dependem do frontend.
2. **Isolamento multi-tenant:** toda leitura ou escrita é limitada à organização autorizada.
3. **Contratos explícitos:** DTOs e documentação OpenAPI não expõem diretamente entidades do ORM.
4. **Persistência antes da sincronização:** operações offline são gravadas localmente antes de tentar acessar a rede.
5. **Idempotência:** reenvios da mesma operação não podem duplicar efeitos.
6. **Conflitos explícitos:** alterações concorrentes são detectadas e tratadas; não se aplica “última gravação vence” indiscriminadamente.
7. **Testabilidade:** regras de negócio, permissões e cenários de sincronização têm testes.
8. **Entrega reproduzível:** configuração, migrations e comandos ficam documentados.
9. **Complexidade justificada:** novas dependências e serviços precisam resolver um problema concreto.
10. **Documentação honesta:** resultados, cobertura e métricas só são publicados quando medidos.

## Estratégia de sincronização offline

O mobile terá uma cópia local das tarefas necessárias ao trabalho e uma fila persistente de operações pendentes.

Fluxo esperado:

1. O usuário realiza uma alteração no aplicativo.
2. A alteração é salva no SQLite junto com uma operação identificada por UUID.
3. Se houver conexão, a operação é enviada à API; caso contrário, permanece pendente.
4. A API valida identidade, permissões, versão da entidade e idempotência.
5. A mudança de domínio e seu registro de auditoria são persistidos de forma transacional.
6. O cliente recebe o resultado por operação e atualiza o estado local.
7. Alterações remotas são recuperadas por um mecanismo de pull com cursor consistente.

Os casos de teste devem incluir perda de conexão, resposta perdida, reenvio, conflito de versão, operação rejeitada, reinício do app e troca de usuário ou organização.

## Segurança

- Senhas armazenadas com algoritmo de hash seguro.
- Access tokens de curta duração e renovação controlada de sessão.
- Armazenamento seguro de refresh tokens no mobile.
- Cookies web configurados com atributos de segurança quando utilizados.
- Validação de entrada e limites de paginação.
- Rate limiting em endpoints sensíveis.
- Segredos apenas em variáveis de ambiente não versionadas.
- Testes negativos de acesso entre organizações.
- Dados locais isolados e tratados corretamente em logout ou troca de contexto.

## Desenvolvimento local

Os comandos definitivos serão documentados depois que os workspaces e os scripts forem criados. A intenção é que a configuração local permita:

1. Instalar dependências.
2. Configurar variáveis de ambiente a partir de `.env.example`.
3. Iniciar PostgreSQL e demais dependências com Docker Compose.
4. Aplicar migrations do Prisma.
5. Executar API, web e mobile.
6. Rodar lint, verificação de tipos e testes.

**Não execute comandos presumindo que a estrutura já foi implementada.** Os scripts devem ser adicionados e validados no repositório antes de serem tratados como disponíveis.

## Roadmap

### Fase 1 — Fundação
- [ ] Criar monorepo e workspaces.
- [ ] Configurar Angular, Ionic e NestJS.
- [ ] Configurar TypeScript, lint e testes.
- [ ] Configurar PostgreSQL, Prisma e Docker Compose.
- [ ] Criar health check e pipeline inicial.

### Fase 2 — Segurança e domínio
- [ ] Implementar usuários, organizações e memberships.
- [ ] Implementar login, refresh e logout.
- [ ] Criar regras de autorização multi-tenant.
- [ ] Criar tarefas, checklists e auditoria.
- [ ] Documentar API com OpenAPI.

### Fase 3 — Fluxo vertical
- [ ] Criar tarefa pela web.
- [ ] Persistir e consultar pela API.
- [ ] Exibir tarefa no mobile.
- [ ] Concluir tarefa online pelo aplicativo.

### Fase 4 — Offline e sincronização
- [ ] Criar persistência local SQLite.
- [ ] Implementar fila durável.
- [ ] Implementar push e pull.
- [ ] Implementar idempotência e controle de versão.
- [ ] Tratar conflitos e retentativas.
- [ ] Automatizar testes dos cenários de falha.

### Fase 5 — Experiência e publicação
- [ ] Refinar dashboard e experiência responsiva.
- [ ] Adicionar estados visíveis de sincronização.
- [ ] Completar testes ponta a ponta.
- [ ] Configurar logs e monitoramento básico.
- [ ] Publicar uma demonstração com dados fictícios.
- [ ] Documentar decisões arquiteturais e gravar uma demonstração.

## Critérios de aceite do MVP

- Uma organização não consegue ler nem modificar dados de outra.
- Gestor consegue criar e atribuir tarefas pela web.
- Colaborador consegue consultar e executar tarefas pelo mobile.
- Uma alteração feita offline persiste após fechar e reabrir o aplicativo.
- A sincronização não duplica efeitos quando a mesma operação é reenviada.
- Conflitos e operações rejeitadas são apresentados de forma explícita.
- Testes relevantes são executados no pipeline.
- A aplicação e suas decisões principais estão documentadas.

## Contribuição e uso do Copilot

As instruções de engenharia para o GitHub Copilot estão em `.github/copilot-instructions.md`. Elas definem convenções de arquitetura, segurança, multi-tenancy, sincronização offline, testes e documentação.

Antes de considerar uma funcionalidade concluída, execute os testes e verificações pertinentes, atualize a documentação e informe claramente quaisquer limitações conhecidas.

## Estado do projeto

Este repositório começa como projeto pessoal de portfólio e demonstração de engenharia. Não é apresentado como produto de produção auditado nem como serviço com disponibilidade garantida. Não inclua dados pessoais reais ou credenciais no ambiente de demonstração.

---

**TaskFlow** — operações organizadas, mesmo quando a conexão não está.
