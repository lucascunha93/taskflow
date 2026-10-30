# TaskFlow API

API NestJS em TypeScript/ESM, com PostgreSQL, Prisma 7, autenticação JWT e
Argon2id. O diretório é um workspace npm; execute os comandos abaixo na raiz
do repositório, após instalar dependências e configurar o ambiente conforme o
[README principal](../../README.md).

## Variáveis de ambiente

Copie `apps/api/.env.example` para `apps/api/.env` somente se o destino ainda
não existir. Preencha valores próprios:

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão PostgreSQL usada pela API e pelos comandos Prisma. |
| `JWT_SECRET` | Segredo de assinatura JWT, com pelo menos 32 caracteres. |
| `PORT` | Porta HTTP; padrão `3000`. |
| `OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET` | Par de configuração do NestJS Observe, quando utilizado. |

O workspace da API executa seus scripts a partir de `apps/api`, onde o
`dotenv` do Prisma e o `ConfigModule` do Nest leem `.env`. Variáveis já
definidas no processo também podem ser usadas. O Compose, executado na raiz,
usa as variáveis `POSTGRES_*` da raiz; configure `DATABASE_URL` para o mesmo
banco. Não registre nem compartilhe segredos.

## Prisma e migrations

O arquivo `prisma7.config.ts` configura o schema, o diretório de migrations e
`DATABASE_URL`. Os scripts informam explicitamente esse arquivo:

```powershell
npm run db:generate --workspace api
npm run db:migrate:status --workspace api
npm run db:migrate:deploy --workspace api
```

O primeiro comando gera o Prisma Client em `src/generated/prisma`; esse
diretório é ignorado pelo Git e deve ser gerado após uma instalação limpa,
antes do build e dos testes. `db:migrate:status` consulta o estado do banco;
`db:migrate:deploy` aplica migrations pendentes e altera o banco.

Não aplique migrations a um banco existente sem revisar seu estado e impacto.
Em particular, a migration que adiciona `passwordHash` obrigatório não
funciona diretamente se já existirem usuários na tabela. Nenhum comando acima
deve ser substituído por reset ou exclusão de volume para contornar falhas.

## Comandos

```powershell
npm run start:dev --workspace api
npm run build --workspace api
npm run lint --workspace api
npm run test --workspace api
npm run test:e2e --workspace api
```

Os testes unitários verificam regras dos serviços e fazem requisições HTTP com
Prisma simulado. O teste de montagem do `AppModule` também substitui Prisma e
Observe: ele não valida conexão real, migrations ou isolamento no PostgreSQL.
Esses cenários precisam de testes de integração contra um banco de teste
dedicado, sem reutilizar dados de desenvolvimento ou produção.

## Endpoints existentes

| Método | Rota | Autenticação |
| --- | --- | --- |
| GET | `/health` | Não |
| POST | `/auth/register` | Não |
| POST | `/auth/login` | Não |
| GET | `/auth/me` | JWT |
| POST, GET | `/organizations` | JWT |
| POST, GET | `/organizations/:organizationId/members` | JWT |
| POST, GET | `/organizations/:organizationId/tasks` | JWT |
| GET | `/organizations/:organizationId/tasks/:taskId` | JWT |

A criação de tarefas valida a associação do solicitante e do responsável.
As consultas exigem associação à organização e retornam os campos da tarefa
mais `creator` e `assignee` com `id` e `name`; `assignee` pode ser `null`.
A listagem retorna um array ordenado por `updatedAt` decrescente, com `id`
decrescente como desempate. Ainda não há filtros ou paginação: a listagem
retorna todas as tarefas da organização. O detalhe retorna 404 para tarefa
inexistente na organização, inclusive quando pertence a outro tenant.
Organizações inacessíveis também retornam 404.

Ainda não existem endpoints para atualizar ou excluir tarefas nem controle
de concorrência otimista, apesar do campo `version` no modelo.

O Observe é configurado em `AppModule`; revise suas credenciais e política de
telemetria antes de uso. Rate limiting, renovação de sessão e configuração
de produção ainda precisam ser avaliados.
