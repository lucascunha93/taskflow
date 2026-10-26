# Instruções do GitHub Copilot — TaskFlow

Estas instruções definem os padrões de engenharia do TaskFlow. Siga-as ao gerar, revisar ou modificar código neste repositório. Se uma solicitação entrar em conflito com estas regras, priorize segurança, consistência de dados e o requisito explícito mais recente do usuário.

## 1. Contexto do produto

TaskFlow é um SaaS B2B para gestão de tarefas e operações empresariais, com:
- Aplicação web para gestores.
- Aplicativo mobile para colaboradores.
- API REST própria.
- Suporte a trabalho offline no mobile e sincronização confiável quando a conexão retornar.
- Isolamento de dados entre organizações (multi-tenancy).

O produto deve ter aparência e comportamento de um SaaS corporativo premium. Priorize clareza, acessibilidade, consistência visual, feedback de estado e fluxos previsíveis.

## 2. Stack e arquitetura

Stack planejada:
- Monorepo com npm workspaces, salvo decisão documentada em contrário.
- `apps/api`: Node.js + TypeScript + NestJS.
- `apps/web`: Angular + TypeScript.
- `apps/mobile`: Ionic + Angular + Capacitor.
- PostgreSQL como banco central.
- Prisma ORM e migrations.
- SQLite no dispositivo mobile para cache e fila offline.
- Docker Compose para ambiente local.
- OpenAPI/Swagger para documentar a API.
- GitHub Actions para CI.

Use um **monólito modular** no backend. Não crie microserviços, filas externas ou infraestrutura adicional sem uma necessidade concreta e documentada.

## 3. Estrutura esperada

```text
apps/
  api/
    src/
      common/       # guards, decorators, filters e interceptors reutilizáveis
      config/
      database/
      modules/
        auth/
        organizations/
        memberships/
        tasks/
        sync/
        audit/
    test/
  web/
    src/app/
      core/
      shared/
      features/
  mobile/
    src/app/
      core/
      shared/
      features/
packages/
  api-contracts/
prisma/
  schema.prisma
  migrations/
infra/
  docker/
  scripts/
.github/
  copilot-instructions.md
  workflows/
README.md
```

A estrutura pode evoluir, mas mudanças estruturais devem preservar limites claros entre domínios. Não crie abstrações genéricas antes de existir mais de um caso de uso que as justifique.

## 4. Princípios obrigatórios de engenharia

1. **TypeScript estrito:** evite `any`; prefira tipos explícitos, `unknown` com narrowing e contratos bem definidos.
2. **Separação de responsabilidades:** controllers tratam HTTP; serviços implementam casos de uso; repositórios/acesso a dados ficam isolados quando isso trouxer valor real.
3. **Validação na fronteira:** valide todos os parâmetros, query strings e corpos de requisição recebidos pela API.
4. **Erros consistentes:** use códigos HTTP corretos e um formato de erro documentado. Nunca exponha stack traces, segredos ou detalhes internos ao cliente.
5. **Código simples:** aplique SOLID e padrões apenas quando ajudarem a clareza, testabilidade ou evolução.
6. **Sem duplicação evitável:** reutilize regras de domínio, mas não acople web e mobile a componentes de interface compartilhados.
7. **Documentação:** atualize README, OpenAPI e exemplos quando contratos ou comandos mudarem.
8. **Sem funcionalidades fictícias:** não crie mocks ou dados simulados em produção sem identificá-los claramente como dados de demonstração.
9. **Dependências:** prefira dependências mantidas e justificadas. Não adicione uma biblioteca para resolver algo trivial sem explicar o benefício.
10. **Mudanças focadas:** não reescreva módulos não relacionados à solicitação.

## 5. Segurança e multi-tenancy

- Toda consulta e mutação de dados pertencentes a uma organização deve ser limitada ao contexto da organização autenticada e validada no servidor.
- Nunca confie em `organizationId`, `userId`, papel ou permissões enviados pelo cliente sem validar a associação no backend.
- O isolamento não pode depender apenas da interface ou de filtros no frontend.
- Use RBAC inicial com `admin`, `manager` e `member`, combinado com autorização sobre o recurso e a ação solicitada.
- Verifique propriedade e organização do recurso em cada endpoint relevante.
- Armazene senhas usando Argon2id ou uma alternativa segura e bem configurada.
- Não armazene segredos, senhas ou tokens em arquivos versionados.
- Nunca registre tokens, senhas ou dados pessoais desnecessários em logs.
- Proteja endpoints sensíveis contra abuso com rate limiting.
- Para web, avalie CSRF de acordo com o mecanismo de sessão/cookies adotado.
- Para mobile, use armazenamento seguro nativo para refresh tokens; não use `localStorage` ou preferências comuns para segredos.
- Dados locais devem ser removidos ou isolados corretamente em logout, troca de conta ou troca de organização.
- Inclua testes negativos para tentativas de acesso cruzado entre organizações.

## 6. API REST

- Prefixo de API: `/api/v1`.
- Use nomes de recursos consistentes e métodos HTTP semanticamente corretos.
- Documente contratos em OpenAPI.
- Valide paginação, filtros e ordenação; imponha limites máximos.
- Não exponha diretamente entidades internas do Prisma como contratos públicos.
- Use DTOs/schemas explícitos para entrada e saída.
- Para atualizações concorrentes, use versionamento otimista quando aplicável.
- Mudanças de status de tarefa devem passar por regras de domínio explícitas; não aceite qualquer transição por um `PATCH` genérico.
- Use UTC em timestamps de servidor e ISO 8601 nas APIs.
- Mudanças incompatíveis no contrato exigem decisão e documentação explícitas.

Endpoints planejados para o MVP:
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `POST /api/v1/organizations`
- `GET /api/v1/organizations/current`
- `GET /api/v1/organizations/current/members`
- `POST /api/v1/tasks`
- `GET /api/v1/tasks`
- `GET /api/v1/tasks/:taskId`
- `PATCH /api/v1/tasks/:taskId`
- `POST /api/v1/tasks/:taskId/transitions`
- `GET /api/v1/tasks/:taskId/events`
- `POST /api/v1/sync/push`
- `GET /api/v1/sync/pull`
- `GET /api/v1/dashboard/summary`

A lista é uma referência inicial, não autorização para implementar todos os endpoints de uma vez. Desenvolva por fluxo vertical e mantenha a documentação sincronizada.

## 7. Modelo de domínio

Entidades iniciais:
- `Organization`: organização cliente.
- `User`: identidade global.
- `Membership`: associação usuário-organização, papel e estado.
- `Task`: tarefa, organização, criador, responsável, prioridade, status, prazo e versão.
- `ChecklistItem`: item de checklist associado à tarefa.
- `TaskEvent`: trilha de auditoria de alterações relevantes.
- `SyncOperation`: registro de idempotência das operações recebidas do mobile.

Regras:
- Use UUIDs para entidades que precisem ser criadas offline.
- Crie constraints e índices para integridade e consultas frequentes.
- Uma tarefa deve pertencer a uma única organização.
- Atribuições e relações devem validar o escopo da organização.
- A auditoria é produzida pelo servidor e não pode ser editada livremente pelo cliente.
- Não remova dados de forma que quebre a sincronização; avalie tombstones/eventos de exclusão para dados replicados em dispositivos.

## 8. Regras de sincronização offline — críticas

O mobile deve salvar primeiro a alteração no SQLite e depois tentar sincronizá-la. Não dependa de uma chamada de rede para persistir uma ação do usuário.

- Mantenha uma fila durável de operações pendentes.
- Cada operação tem `operationId` único e estável entre tentativas.
- A API deve aplicar idempotência no servidor usando constraint de unicidade e transação; uma consulta prévia isolada não é suficiente.
- A mudança de domínio, o evento de auditoria e o resultado idempotente devem ser persistidos atomicamente quando fizerem parte da mesma operação.
- Use `baseVersion`/versão de entidade para detectar alterações concorrentes.
- Não use “última gravação vence” indiscriminadamente.
- Trate resultados individuais por operação: `applied`, `already_applied`, `conflict` ou `rejected` (ou enum equivalente documentado).
- Retentativas devem usar backoff exponencial com jitter e limites razoáveis.
- Falhas de rede não devem apagar operações pendentes.
- O cursor de pull deve ser opaco e desenhado para não perder mudanças confirmadas; não use apenas `updated_at` como cursor sem garantir ordenação consistente.
- Respeite permissões e escopo de organização tanto no push quanto no pull.
- Considere logout, troca de usuário/organização, remoções de acesso, exclusões e dados obsoletos no dispositivo.
- Nunca alegue “sincronizado” antes de o servidor confirmar o resultado.
- Crie testes para duplicação, respostas perdidas, operações fora de ordem, conflitos, rejeições e reinicialização do aplicativo.

## 9. Frontend Angular e Ionic

- Organize código por funcionalidade/domínio (`features`), com `core` para serviços singleton e infraestrutura e `shared` para elementos realmente reutilizáveis.
- Prefira componentes pequenos e com responsabilidades claras.
- Use Signals para estado local síncrono quando apropriado e RxJS para fluxos assíncronos/eventos.
- Evite subscriptions sem necessidade; gerencie corretamente o ciclo de vida e cancelamento.
- Use formulários reativos e validação coerente com a API.
- Implemente estados de carregamento, erro, vazio, sucesso e offline; não deixe ações sem feedback.
- Garanta responsividade, navegação por teclado, labels acessíveis e contraste adequado.
- Não trate a interface como fronteira de segurança: todas as regras de autorização também devem existir no backend.
- No mobile, torne visível o estado da fila: pendente, sincronizando, sincronizado, conflito ou falha.
- Não assuma que o aplicativo estará sempre online ou que eventos de rede são infalíveis.

## 10. Testes e definição de pronto

Ao implementar uma funcionalidade:
- Adicione testes unitários para regras de negócio relevantes.
- Adicione testes de integração para persistência, autorização e transações quando aplicável.
- Teste casos negativos, limites e falhas, não apenas o caminho feliz.
- Para mudanças de API, atualize OpenAPI e contratos.
- Para mudanças de banco, crie migration versionada; não dependa de alteração manual do banco.
- Execute lint, typecheck, testes e build pertinentes antes de declarar a tarefa concluída.
- Nunca afirme que testes passaram se não foram executados.
- Não diminua a qualidade ou remova testes para fazer o pipeline passar sem entender a causa.

Definição de pronto:
1. Funcionalidade atende aos critérios de aceite.
2. Validação e autorização estão no servidor.
3. Erros e estados de interface são tratados.
4. Testes relevantes foram adicionados e executados.
5. Documentação/contratos foram atualizados.
6. Não há segredos ou dados reais sensíveis no repositório.

## 11. Docker, configuração e execução

- Mantenha segredos em variáveis de ambiente não versionadas.
- Forneça `.env.example` com valores fictícios e nomes de variáveis documentados.
- Não inclua `.env` real no Git.
- Docker Compose deve permitir iniciar os serviços necessários para desenvolvimento local.
- Use migrations explícitas para preparar o banco.
- Documente comandos para instalar, executar, testar e reconstruir o ambiente.
- Configure health checks quando apropriado e aguarde dependências prontas nos scripts de inicialização.

## 12. Como o Copilot deve trabalhar

Ao receber uma solicitação:
1. Inspecione a estrutura e os padrões já existentes antes de propor mudanças.
2. Identifique o fluxo de negócio e os módulos afetados.
3. Faça a menor alteração coerente que resolva o problema.
4. Considere segurança, multi-tenancy, offline e compatibilidade de contratos.
5. Adicione ou atualize testes.
6. Atualize documentação quando necessário.
7. Resuma arquivos alterados, decisões, comandos de teste executados e limitações conhecidas.
8. Se faltar informação importante, explicite a suposição; não invente requisitos ou resultados.
9. Não gere toda a aplicação em uma única mudança. Prefira entregas pequenas, compiláveis e verificáveis.
10. Não adicione serviços ou tecnologias fora da stack aprovada sem apresentar a justificativa.

## 13. Idioma e documentação

- Documentação do projeto, comentários explicativos e mensagens para o time: português brasileiro.
- Identificadores, nomes de classes, funções, variáveis, endpoints e tipos: inglês.
- Mensagens visíveis ao usuário final: português brasileiro no MVP, com estrutura que permita internacionalização futura.
- Use linguagem técnica clara, sem prometer escalabilidade, segurança ou disponibilidade que não tenham sido demonstradas.

Estas instruções são a referência padrão do repositório e devem evoluir junto com as decisões arquiteturais do TaskFlow.
