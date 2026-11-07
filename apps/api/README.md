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
| `CORS_ORIGINS` | Opcional. Origens exatas permitidas, separadas por vírgula (ex.: `https://app.example.com`). Sem valor, o CORS fica desabilitado. |
| `TRUST_PROXY` | Opcional. Número de proxies reversos confiáveis (0 a 10), para que o rate limiting use o IP real do cliente. |
| `OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET` | Par de configuração do NestJS Observe, quando utilizado. |

As variáveis são validadas na inicialização (`src/config/environment.ts`): um
`JWT_SECRET` curto, uma `DATABASE_URL` que não seja PostgreSQL, uma porta
inválida ou uma origem CORS com caminho, barra final ou `*` impedem a API de
subir e listam todos os problemas encontrados.

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

## Integração com PostgreSQL real

A suíte `test:integration` usa os módulos reais de autenticação, organizações,
tarefas e Prisma por HTTP, sem iniciar o Observe. Ela cobre isolamento,
concorrência, transações e integridade referencial. Exige banco dedicado:
**não use um banco de desenvolvimento, produção ou de outra pessoa**. O
arquivo `compose.integration.yaml` é independente do Compose de desenvolvimento,
usa PostgreSQL 17 e armazenamento temporário em memória, sem volume persistente.
Ao parar o contêiner, os dados desse banco de teste são perdidos.

Exemplo em PowerShell, na raiz, com Docker e daemon disponíveis:

```powershell
$project = "taskflow-it-$([guid]::NewGuid().ToString('N').Substring(0, 12))"
$env:TASKFLOW_TEST_PORT = "55432" # escolha outra porta livre se necessário
$env:TASKFLOW_TEST_PASSWORD = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
docker compose -p $project -f .\compose.integration.yaml up -d --wait
```

Confirme que o contêiner criado por esse comando está saudável antes de
continuar. Em seguida, no mesmo terminal, configure explicitamente a URL
do banco recém-criado; os valores hexadecimais da senha não precisam de
codificação adicional na URL:

```powershell
$previousDatabaseUrl = $env:DATABASE_URL
$env:TASKFLOW_INTEGRATION_URL = "postgresql://taskflow_test:$($env:TASKFLOW_TEST_PASSWORD)@127.0.0.1:$($env:TASKFLOW_TEST_PORT)/taskflow_integration_test"
$env:DATABASE_URL = $env:TASKFLOW_INTEGRATION_URL
$env:TASKFLOW_INTEGRATION_CONFIRM = "isolated-test-database"
npm run db:generate --workspace api
npm run db:migrate:deploy --workspace api
npm run test:integration --workspace api
```

Pare imediatamente se a criação do contêiner, geração ou migration falhar.
O comando de migration altera o banco indicado por `DATABASE_URL`; confirme a
porta e a finalidade antes de executá-lo. A suíte exige confirmação explícita,
host `127.0.0.1`, usuário `taskflow_test`, banco `taskflow_integration_test`
e porta diferente de 5432. Essas verificações são barreiras contra enganos,
não comprovam por si só que o banco é descartável. Ela cria identificadores
únicos e remove somente os registros identificados que criou; uma interrupção
abrupta pode deixar dados de teste.

Ao terminar, pare **somente o projeto Compose gerado acima** e restaure a
variável anterior, sem editar `.env`:

```powershell
docker compose -p $project -f .\compose.integration.yaml down
if ($null -eq $previousDatabaseUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
else { $env:DATABASE_URL = $previousDatabaseUrl }
Remove-Item Env:TASKFLOW_INTEGRATION_URL, Env:TASKFLOW_INTEGRATION_CONFIRM, Env:TASKFLOW_TEST_PASSWORD, Env:TASKFLOW_TEST_PORT -ErrorAction SilentlyContinue
```

Para executar toda a validação, rode também os comandos de API e frontend da
seção de verificação do README principal. Sem Docker, pode-se usar outro
PostgreSQL recém-criado e comprovadamente isolado com o mesmo usuário e nome
de banco; nunca aponte os comandos acima para uma instância existente.
Os testes HTTP de integração não substituem uma validação de infraestrutura
de produção.

## Endpoints existentes

| Método | Rota | Autenticação |
| --- | --- | --- |
| GET | `/health` | Não |
| POST | `/auth/register` | Não |
| POST | `/auth/login` | Não |
| GET, PATCH | `/auth/me` | JWT |
| POST, GET | `/organizations` | JWT |
| PATCH | `/organizations/:organizationId` | JWT |
| POST, GET | `/organizations/:organizationId/members` | JWT |
| POST, GET | `/organizations/:organizationId/tasks` | JWT |
| GET | `/organizations/:organizationId/tasks/summary` | JWT |
| GET, PUT, DELETE | `/organizations/:organizationId/tasks/:taskId` | JWT |

### Perfil e organização

`PATCH /auth/me` aceita somente `{ "name": "..." }` (2 a 120 caracteres após
remover espaços) e altera o usuário identificado pelo JWT. E-mail, senha e
outros campos são rejeitados com 400; a resposta tem o mesmo formato de
`GET /auth/me`, sem o hash da senha.

`PATCH /organizations/:organizationId` aceita somente `{ "name": "..." }`, com
as mesmas regras de tamanho. Somente OWNER e ADMIN podem renomear (MEMBER
recebe 403); quem não pertence à organização recebe 404. A autorização é
repetida na própria escrita, condicionada à associação com papel OWNER ou
ADMIN, em uma única operação. O `slug` não muda. A resposta contém `id`,
`name`, `slug`, `createdAt` e o `role` do solicitante.

### Tarefas

A criação de tarefas valida a associação do solicitante e do responsável.
O `POST` aceita `title`, `description`, `assigneeId`, `dueDate` e `status`
opcional (`TODO`, `IN_PROGRESS`, `DONE` ou `CANCELLED`). Sem `status`, a
tarefa é criada como `TODO`. A resposta de criação contém os campos da tarefa,
mas não inclui os objetos `creator` e `assignee`.
As consultas exigem associação à organização e retornam os campos da tarefa
mais `creator` e `assignee` com `id` e `name`; `assignee` pode ser `null`.
O detalhe retorna 404 para tarefa inexistente na organização, inclusive quando
pertence a outro tenant. Organizações inacessíveis também retornam 404.

### Resumo para o dashboard

`GET /organizations/:organizationId/tasks/summary` exige JWT e associação à
organização. Retorna `total` e `counts` com as contagens completas por status
(`TODO`, `IN_PROGRESS`, `DONE`, `CANCELLED`), além de `asOf` e `dueUntil`
como instantes ISO. Os resultados são obtidos em um snapshot de leitura.

As listas `myTasks`, `dueSoon` e `recentlyUpdated` contêm até cinco tarefas,
com `id`, `organizationId`, `title`, `status`, `dueDate` e `updatedAt`.
`myTasks` contém tarefas atribuídas ao usuário do JWT, de qualquer status,
ordenadas por prazo crescente (nulos por último) e ID. `dueSoon` contém tarefas
`TODO` ou `IN_PROGRESS` com prazo entre `asOf` e `dueUntil`, inclusive;
`dueUntil` corresponde a sete períodos de 24 horas após `asOf`. Tarefas
atrasadas não são incluídas. A ordenação é por prazo e ID crescentes.
`recentlyUpdated` usa atualização e ID decrescentes; não representa histórico
de atividades.

### Listagem de tarefas

`GET /organizations/:organizationId/tasks` retorna:

```json
{
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

Esse formato substitui o array retornado anteriormente. Uma página além da
última tem `data` vazio e mantém o total e o número de páginas correspondentes
ao filtro. Todos os parâmetros são opcionais:

| Parâmetro | Descrição |
| --- | --- |
| `page` | Inteiro positivo; padrão `1`. |
| `limit` | Inteiro entre 1 e 100; padrão `20`. |
| `status` | `TODO`, `IN_PROGRESS`, `DONE` ou `CANCELLED`. |
| `assigneeId`, `creatorId` | UUID do responsável ou criador. |
| `search` | Trecho literal do título, sem diferenciar maiúsculas de minúsculas; não pode ser vazio. |
| `dueDateFrom`, `dueDateTo` | Limites inclusivos de prazo em formato ISO. |
| `sortBy` | `createdAt`, `updatedAt`, `dueDate` ou `title`; padrão `updatedAt`. |
| `sortOrder` | `asc` ou `desc`; padrão `desc`. |

Exemplo:

```http
GET /organizations/:organizationId/tasks?status=TODO&sortBy=dueDate&sortOrder=asc&page=1&limit=20
```

O desempate é por `id` no mesmo sentido de `sortOrder`. Em ordenação por prazo,
os valores nulos seguem o PostgreSQL: por último em `asc` e primeiro em `desc`.
Para limites de prazo, uma data `YYYY-MM-DD` representa o início ou o final
desse dia em UTC, conforme seja `dueDateFrom` ou `dueDateTo`. Timestamps devem
conter fuso explícito, por exemplo `2026-10-10T12:30:00Z` ou
`2026-10-10T12:30:00-03:00`; são comparados como instantes. Quando há filtro de
prazo, tarefas sem prazo não são incluídas. O limite inicial não pode ser
posterior ao final. Parâmetros inválidos ou uma página cujo deslocamento exceda
2.147.483.647 resultam em 400.

A contagem e os dados usam os mesmos filtros e um snapshot de leitura
consistente. Os índices atuais cobrem organização/status/atualização e
organização/responsável; a ordenação padrão sem status e a pesquisa textual
devem ser avaliadas com consultas reais antes de propor novos índices.

O `PUT` aceita atualizações parciais de `title`, `description`, `status`,
`assigneeId` e `dueDate`. A `version` atual é obrigatória: se estiver
desatualizada, a resposta é 409; quando a atualização é bem-sucedida, a versão
é incrementada. Campos omitidos são preservados. Para remover o responsável,
o prazo ou a descrição, envie o campo correspondente com valor `null`. Título e
descrição não aceitam strings vazias ou somente espaços, e título e status não
aceitam `null`. O responsável informado precisa pertencer à organização.

Exemplo de remoção do prazo:

```json
{ "version": 1, "dueDate": null }
```

Uma atualização contendo apenas `version` também incrementa a versão. O
criador e a organização não são alteráveis pelo cliente.

Para excluir uma tarefa, envie a versão atual como parâmetro de consulta:
`DELETE /organizations/:organizationId/tasks/:taskId?version=1`. A versão
é obrigatória e deve ser um inteiro positivo. A exclusão condiciona a operação
ao identificador, à organização, à associação e à versão em uma única
operação. O sucesso retorna 204 sem corpo; organização inacessível ou tarefa
inexistente na organização retorna 404; versão desatualizada retorna 409.

## Segurança HTTP

- **Helmet** adiciona cabeçalhos de segurança padrão e remove `X-Powered-By`.
- **CORS** é opt-in por `CORS_ORIGINS`, com origens exatas, métodos
  `GET, POST, PUT, PATCH, DELETE` e cabeçalhos `Authorization` e
  `Content-Type`. Não há cookies: a autenticação usa Bearer token.
- **Rate limiting** (`@nestjs/throttler`): `POST /auth/login` e
  `POST /auth/register` aceitam 10 requisições por minuto por IP e rota; o
  excedente recebe 429. A contagem fica em memória, então cada instância conta
  separadamente e os contadores reiniciam com o processo. Para várias instâncias,
  avalie um armazenamento compartilhado. Atrás de um proxy reverso, configure
  `TRUST_PROXY`; caso contrário, todos os clientes compartilham o IP do proxy.

O Observe é configurado em `AppModule` e é registrado mesmo sem
`OBSERVE_APP_KEY`/`OBSERVE_APP_SECRET`, usando valores de exemplo; revise suas
credenciais e política de telemetria antes do uso. Renovação e revogação de
sessão, proteção de brute force por conta (além do limite por IP) e a
configuração de produção ainda precisam ser avaliadas.
