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
| `CORS_ORIGINS` | Opcional. Origens exatas permitidas, separadas por vírgula (ex.: `https://app.example.com`). Para o app mobile, inclua `capacitor://localhost` (iOS) e `https://localhost` (Android). Sem valor, o CORS fica desabilitado. |
| `TRUST_PROXY` | Opcional. Número de proxies reversos confiáveis (0 a 10), para que o rate limiting use o IP real do cliente. |
| `REFRESH_TOKEN_TTL_DAYS` | Opcional. Validade do refresh token, de 1 a 90 dias; padrão `7`. Renovada a cada uso. |
| `REFRESH_COOKIE_SECURE` | Opcional. `true` (padrão) ou `false`. Use `false` somente em desenvolvimento HTTP quando o navegador recusar cookies `Secure` em `localhost`. |
| `REFRESH_COOKIE_PATH` | Opcional. Caminho do cookie; padrão `/auth`. Deve corresponder ao caminho público dos endpoints de autenticação (ex.: `/api/auth`). |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Opcionais, mas juntas: habilitam anexos em armazenamento compatível com S3. Sem elas, os endpoints de anexos respondem 503. |
| `S3_ENDPOINT` | Endpoint usado pela API (ex.: `http://127.0.0.1:8333`); omitido, usa a AWS. |
| `S3_PUBLIC_ENDPOINT` | Endereço acessível pelo navegador para as URLs assinadas de download; padrão: `S3_ENDPOINT`. |
| `S3_REGION`, `S3_FORCE_PATH_STYLE` | Região (padrão `us-east-1`) e endereçamento por caminho (`true` para SeaweedFS/MinIO). |
| `S3_CREATE_BUCKET` | `true` cria o bucket ausente ao iniciar; use somente em desenvolvimento. |
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
funciona diretamente se já existirem usuários na tabela. A migration
`add_user_session_security` apenas adiciona colunas com valores padrão
(`sessionVersion`, `failedLoginAttempts`, `lockedUntil`) e é compatível com
usuários existentes. Nenhum comando acima deve ser substituído por reset ou
exclusão de volume para contornar falhas.

## Comandos

```powershell
npm run start:dev --workspace api
npm run build --workspace api
npm run lint --workspace api
npm run test --workspace api
npm run test:e2e --workspace api
npm run plan:set --workspace api -- <slug-da-organização> <FREE|PRO|BUSINESS>
```

Os testes unitários verificam regras dos serviços e fazem requisições HTTP com
Prisma simulado. O teste de montagem do `AppModule` também substitui Prisma e
Observe: ele não valida conexão real, migrations ou isolamento no PostgreSQL.

## Integração com PostgreSQL real

A suíte `test:integration` usa os módulos reais de autenticação, organizações,
tarefas, projetos, armazenamento e Prisma por HTTP, sem iniciar o Observe. Ela
cobre isolamento, concorrência, transações, integridade referencial e anexos
em um S3 real. Exige banco e S3 dedicados:
**não use um banco de desenvolvimento, produção ou de outra pessoa**. O
arquivo `compose.integration.yaml` é independente do Compose de desenvolvimento,
usa PostgreSQL 17 e SeaweedFS (S3) com armazenamento temporário em memória, sem
volume persistente. Ao parar os contêineres, os dados de teste são perdidos.

Exemplo em PowerShell, na raiz, com Docker e daemon disponíveis:

```powershell
$project = "taskflow-it-$([guid]::NewGuid().ToString('N').Substring(0, 12))"
$env:TASKFLOW_TEST_PORT = "55432" # escolha outra porta livre se necessário
$env:TASKFLOW_TEST_PASSWORD = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$env:TASKFLOW_TEST_S3_PORT = "58333" # outra porta livre se necessário; não use 8333 nem 9000
$env:TASKFLOW_TEST_S3_ACCESS_KEY = "it" + [guid]::NewGuid().ToString('N').Substring(0, 18)
$env:TASKFLOW_TEST_S3_SECRET = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
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
$env:TASKFLOW_INTEGRATION_S3_URL = "http://127.0.0.1:$($env:TASKFLOW_TEST_S3_PORT)"
$env:TASKFLOW_INTEGRATION_S3_ACCESS_KEY = $env:TASKFLOW_TEST_S3_ACCESS_KEY
$env:TASKFLOW_INTEGRATION_S3_SECRET = $env:TASKFLOW_TEST_S3_SECRET
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
Remove-Item Env:TASKFLOW_TEST_S3_PORT, Env:TASKFLOW_TEST_S3_ACCESS_KEY, Env:TASKFLOW_TEST_S3_SECRET, Env:TASKFLOW_INTEGRATION_S3_URL, Env:TASKFLOW_INTEGRATION_S3_ACCESS_KEY, Env:TASKFLOW_INTEGRATION_S3_SECRET -ErrorAction SilentlyContinue
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
| POST | `/auth/refresh`, `/auth/logout` | Cookie de refresh + `X-TaskFlow-Request: 1` |
| POST | `/auth/mobile/login`, `/auth/mobile/refresh`, `/auth/mobile/logout` | Não (refresh token no corpo) |
| GET, POST | `/organizations/:organizationId/tasks/:taskId/attachments` | JWT |
| GET | `/organizations/:organizationId/tasks/:taskId/attachments/:attachmentId/download` | JWT |
| DELETE | `/organizations/:organizationId/tasks/:taskId/attachments/:attachmentId` | JWT |
| PUT | `/auth/me/password` | JWT |
| DELETE | `/auth/me/sessions` | JWT |
| POST, GET | `/organizations` | JWT |
| PATCH | `/organizations/:organizationId` | JWT |
| POST, GET | `/organizations/:organizationId/members` | JWT |
| POST, GET | `/organizations/:organizationId/tasks` | JWT |
| GET | `/organizations/:organizationId/tasks/summary` | JWT |
| GET, PUT, DELETE | `/organizations/:organizationId/tasks/:taskId` | JWT |
| GET, POST | `/organizations/:organizationId/tasks/:taskId/comments` | JWT |
| PATCH, DELETE | `/organizations/:organizationId/tasks/:taskId/comments/:commentId` | JWT |
| GET | `/organizations/:organizationId/activity` | JWT |
| GET | `/organizations/:organizationId/tasks/:taskId/activity` | JWT |
| GET, POST | `/organizations/:organizationId/projects` | JWT |
| GET, PATCH, DELETE | `/organizations/:organizationId/projects/:projectId` | JWT |
| GET | `/notifications` | JWT |
| POST | `/notifications/:notificationId/read`, `/notifications/read-all` | JWT |
| GET | `/plans` | JWT |
| GET | `/organizations/:organizationId/plan` | JWT |

### Refresh token

O login grava o cookie `taskflow_refresh` (`HttpOnly`, `Secure`,
`SameSite=Strict`, caminho `/auth`) com um token opaco aleatório. A API guarda
somente o hash SHA-256 na tabela `refresh_tokens`; o corpo da resposta não
contém o refresh token.

- `POST /auth/refresh` troca o token do cookie por um novo (rotação) e devolve
  um novo access token no mesmo formato do login. Sem cookie, com token
  inválido, expirado ou emitido antes de uma troca de senha ou revogação, a
  resposta é 401 e o cookie é apagado.
- Tokens de uma mesma sessão formam uma família. Reapresentar um token já
  trocado é tratado como reutilização: toda a família é revogada (401). Nos 10
  segundos seguintes à troca, a resposta é 409, porque abas diferentes
  compartilham o cookie e podem renovar ao mesmo tempo; o cliente repete a
  chamada e o navegador já envia o cookie novo.
- `POST /auth/logout` revoga a família do cookie e o apaga (204), mesmo com o
  access token expirado.
- Troca de senha e `DELETE /auth/me/sessions` revogam todos os refresh tokens
  do usuário; a troca de senha grava um novo cookie para a sessão atual.
- Proteção contra CSRF: além do `SameSite=Strict`, os dois endpoints exigem o
  cabeçalho `X-TaskFlow-Request: 1` (403 sem ele). Formulários de outros sites
  não conseguem enviá-lo, e o CORS bloqueia scripts de origens não autorizadas.
- Tokens expirados de um usuário são removidos quando ele inicia uma nova
  sessão; os revogados são mantidos até expirar, para detectar reutilização.

### Sessão do app mobile

O WebView do Capacitor roda em outra origem (`capacitor://localhost` no iOS,
`https://localhost` no Android), onde o cookie `SameSite=Strict` não é enviado.
Por isso, o app usa endpoints próprios, com o refresh token no corpo:

- `POST /auth/mobile/login` recebe `{ email, password }` e responde 200 com o
  mesmo corpo do login web, mais `refreshToken` e `refreshExpiresAt`. O
  limite por IP e o bloqueio da conta valem da mesma forma.
- `POST /auth/mobile/refresh` recebe `{ refreshToken }` e devolve um novo par
  (rotação). `POST /auth/mobile/logout` revoga a família do token (204).
- As regras de rotação, reutilização, revogação por troca de senha e expiração
  são as mesmas do cookie. Não há cookie nem credencial automática, portanto
  não há CSRF. O app guarda o token no Keychain ou no Keystore.

### Sessões, senha e bloqueio de login

O JWT carrega `ver`, a versão de sessão do usuário no momento da emissão. O
guard consulta essa versão a cada requisição autenticada: tokens de usuários
removidos ou com versão diferente da atual recebem 401. Tokens sem `ver`
equivalem à versão 0, então sessões emitidas antes desta mudança continuam
válidas até a primeira revogação.

- `PUT /auth/me/password` recebe `{ currentPassword, newPassword }` (nova senha
  com 12 a 128 caracteres). Senha atual incorreta retorna 403, e não 401, para
  não ser confundida com sessão expirada. Repetir a senha atual retorna 400. O
  sucesso troca o hash, incrementa a versão (revogando todos os tokens
  anteriores) e retorna um novo token no mesmo formato do login. Uma troca ou
  revogação concorrente retorna 409. O endpoint também tem o limite por IP.
- `DELETE /auth/me/sessions` incrementa a versão e encerra todas as sessões do
  usuário, inclusive a atual. Retorna 204.
- Login: após 5 senhas incorretas consecutivas, a conta fica bloqueada por 15
  minutos. Durante o bloqueio, o login responde 429 sem verificar a senha; um
  login bem-sucedido zera o contador. Para e-mails inexistentes, a senha é
  verificada contra um hash descartável, para aproximar o tempo de resposta.
  O bloqueio só ocorre em contas existentes, o que revela a existência do
  e-mail a quem provocar o bloqueio; isso foi aceito em troca da proteção
  contra força bruta por conta. Um atacante também pode bloquear
  temporariamente a conta de outra pessoa.

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
O `POST` também aceita `id` (UUID) gerado pelo cliente, usado pelo app mobile
offline. A criação fica idempotente: se a tarefa com esse `id` já foi criada
pelo mesmo usuário na mesma organização, a resposta devolve a existente, sem
duplicar a tarefa nem o histórico. Envios simultâneos com o mesmo `id` também
resultam em uma só tarefa. O mesmo `id` usado por outro usuário ou em outra
organização retorna 409.
As consultas exigem associação à organização e retornam os campos da tarefa
mais `creator` e `assignee` com `id` e `name`; `assignee` pode ser `null`.
O detalhe retorna 404 para tarefa inexistente na organização, inclusive quando
pertence a outro tenant. Organizações inacessíveis também retornam 404.

### Comentários

Qualquer membro da organização lê e comenta tarefas dela. Organização
inacessível ou tarefa de outra organização retornam 404. O corpo aceita
`{ "body": "..." }` com 1 a 5000 caracteres após remover espaços nas pontas.

- `GET .../comments?limit=50&after=<commentId>` lista em ordem cronológica
  (`createdAt` e `id`), com `limit` de 1 a 100, e retorna
  `{ data, nextCursor }`; `nextCursor` é `null` na última página. Um cursor de
  outra tarefa retorna 400.
- `POST` cria o comentário com o autor do JWT e retorna `id`, `taskId`, `body`,
  `editedAt`, `createdAt` e `author` (`id`, `name`).
- `PATCH .../comments/:commentId` é permitido somente ao autor (403 para os
  demais) e preenche `editedAt`.
- `DELETE` é permitido ao autor, a OWNER e a ADMIN; responde 204.

No banco, `task_comments` referencia a tarefa por `(taskId, organizationId)`,
o que impede um comentário de apontar para uma tarefa de outra organização.
Comentários são excluídos junto com a tarefa.

### Histórico de alterações

Criação, alteração e exclusão de tarefas e novos comentários geram registros em
`task_activities`, na mesma transação da operação: se o registro falhar, a
operação também é desfeita. Cada item tem `id`, `type` (`TASK_CREATED`,
`TASK_UPDATED`, `TASK_DELETED`, `COMMENT_ADDED`), `taskId`, `taskTitle`,
`changes`, `createdAt` e `actor` (`id`, `name`).

- Em `TASK_UPDATED`, `changes` lista `{ field, from, to }` para `title`,
  `status`, `assignee` (nomes), `dueDate` (ISO) e `description`. A descrição
  registra apenas que mudou, com `from` e `to` nulos. Uma atualização que só
  incrementa a versão não gera registro.
- O conteúdo dos comentários não é copiado para o histórico.
- `taskTitle` guarda o título no momento do evento. Ao excluir a tarefa,
  `taskId` passa a ser `null` nos registros dela, que continuam no histórico da
  organização.
- `GET /organizations/:organizationId/activity?limit=20&before=<id>` lista o
  histórico da organização do mais recente para o mais antigo; `limit` vai de 1
  a 100. `GET .../tasks/:taskId/activity` (padrão 50) lista o de uma tarefa
  existente. Ambos retornam `{ data, nextCursor }` e exigem associação (404).

### Anexos

Os arquivos ficam em um armazenamento compatível com S3; o banco guarda os
metadados em `task_attachments`, ligada à tarefa por `(taskId, organizationId)`.
Qualquer membro lista, envia e baixa; quem enviou, OWNER e ADMIN excluem.
Organização inacessível ou tarefa de outra organização retornam 404.

- `POST .../attachments` recebe `multipart/form-data` com um único campo `file`.
  O tamanho máximo depende do plano (10 MB no Gratuito, 25 MB nos pagos; acima
  do plano, 403 `PLAN_LIMIT_REACHED`; acima de 25 MB, 413) e há no máximo 20
  anexos por tarefa (409). A soma dos anexos respeita a cota do plano.
- Tipos aceitos, pela extensão: `png`, `jpg`, `jpeg`, `gif`, `webp`, `pdf`,
  `txt`, `md`, `csv`, `zip`, `docx`, `xlsx`, `pptx`, `odt`, `ods`, `odp`,
  `doc`, `xls` e `ppt`. Outros tipos, inclusive HTML e SVG, retornam 415.
- O tipo enviado pelo navegador é ignorado. O conteúdo precisa ter a assinatura
  binária da extensão (texto precisa ser UTF-8 sem bytes nulos), caso contrário
  retorna 415, e o arquivo é servido com o tipo canônico da extensão.
- O nome é limpo (sem caminho e sem caracteres de controle, até 255
  caracteres). A chave no storage é `organizations/<org>/tasks/<tarefa>/<uuid>`
  e nunca usa o nome enviado.
- O objeto é gravado antes do registro. Se a gravação no banco falhar, o objeto
  é removido.
- `GET .../download` retorna `{ url, expiresAt }`, uma URL assinada válida por 60
  segundos que baixa o arquivo como `attachment`, com o nome original (RFC 6266).
  O bucket não tem acesso anônimo.
- `DELETE` remove o registro e, em seguida, o objeto. Excluir a tarefa remove
  os registros em cascata e os objetos depois do commit; a linha da tarefa é
  travada antes da leitura das chaves, para que um envio simultâneo não deixe
  arquivo órfão. Uma falha ao remover um objeto já sem registro é registrada no
  log.
- O histórico registra `ATTACHMENT_ADDED` e `ATTACHMENT_REMOVED`, com
  `{ field: "attachment" }` e o nome do arquivo.
- Sem `S3_BUCKET` e credenciais, os endpoints de anexos respondem 503.

No Compose local, o serviço `object-storage` usa SeaweedFS
(`chrislusf/seaweedfs:4.50`), porque a MinIO deixou de publicar imagens
comunitárias atualizadas. O código usa apenas a API S3, então em produção pode
ser AWS S3, Cloudflare R2 ou outro serviço compatível. Revise backup,
criptografia e política de retenção do bucket antes de publicar.

### Planos e limites

Cada organização tem um plano (`organizations.plan`), `FREE` por padrão. Os
limites ficam em `src/plans/plan-limits.ts`:

| Recurso | Gratuito (`FREE`) | Profissional (`PRO`) | Empresarial (`BUSINESS`) |
| --- | --- | --- | --- |
| Membros | 5 | 50 | 250 |
| Projetos | 3 | Sem limite | Sem limite |
| Tarefas | 2.000 | Sem limite | Sem limite |
| Armazenamento de anexos | 1 GB | 20 GB | 200 GB |
| Tamanho por arquivo | 10 MB | 25 MB | 25 MB |

Além disso, cada usuário pode ser proprietário de até 3 organizações no plano
Gratuito, para que os limites não sejam contornados criando organizações.

- Ao atingir um limite, a criação retorna 403 com
  `{ code: "PLAN_LIMIT_REACHED", limit, plan, message }`. `limit` é `members`,
  `projects`, `tasks`, `storage`, `fileSize` ou `freeOrganizations`.
- A verificação trava a linha da organização (`FOR NO KEY UPDATE`) na mesma
  transação da criação: pedidos simultâneos não ultrapassam o limite. A trava
  não bloqueia as chaves estrangeiras que apontam para a organização.
- Anexos são verificados antes do envio ao storage e de novo, com a trava, antes
  do registro; se a cota acabou nesse intervalo, o objeto enviado é removido.
- Reduzir o plano não apaga dados. O que excede o novo limite permanece e
  somente novas criações daquele recurso ficam bloqueadas.
- `GET /plans` lista o catálogo. `GET /organizations/:id/plan` retorna plano,
  limites e uso atual para qualquer membro (404 para não membros).
- Não há cobrança integrada. A troca de plano é operacional:
  `npm run plan:set --workspace api -- <slug> <FREE|PRO|BUSINESS>` usa a
  `DATABASE_URL`, registra `planChangedAt` e mostra o uso atual.

Os limites foram escolhidos para manter o custo previsível. O armazenamento de
objetos é o principal custo variável, por isso todos os planos têm cota. No
Gratuito, membros, projetos e tarefas limitam o uso, e o tamanho máximo por
arquivo mantém o upload em memória sob controle. A integração com um provedor
de pagamento e os preços dependem de decisão comercial.

### Projetos

Projetos agrupam tarefas de uma organização. Qualquer membro lista e consulta;
somente OWNER e ADMIN criam, editam e excluem (MEMBER recebe 403). Organização
inacessível ou projeto de outra organização retornam 404.

- `GET .../projects` lista em ordem de nome, com `id`, `organizationId`,
  `name`, `description`, `taskCount`, `createdAt` e `updatedAt`.
- `POST` aceita `{ name, description? }` (nome de 2 a 120 caracteres, único na
  organização: repetido retorna 409; descrição de até 2000).
- `PATCH .../projects/:projectId` altera `name` e/ou `description` (`null` ou
  vazio remove a descrição).
- `DELETE` responde 204. As tarefas do projeto continuam na organização, com
  `projectId` nulo (FK `ON DELETE SET NULL`).

Tarefas aceitam `projectId` na criação e na atualização (`null` remove do
projeto) e retornam `projectId` e `project` (`id`, `name`). Um projeto de outra
organização ou inexistente retorna 400, inclusive se for excluído durante a
operação. A listagem aceita o filtro `projectId`, e o histórico registra a
troca de projeto (`field: "project"`, com nomes). A organização do projeto é
verificada no serviço, pois o Prisma não permite chave composta em relação
opcional.

### Notificações

Notificações no app são gravadas na mesma transação do evento:

- `TASK_ASSIGNED`: o responsável definido na criação ou na troca de
  responsável.
- `TASK_COMMENTED`: o criador e o responsável da tarefa quando alguém comenta.

Quem realizou a ação nunca é notificado, e cada pessoa recebe no máximo uma
notificação por evento. Não há envio por e-mail nem em tempo real.

- `GET /notifications?limit=20&before=<id>&unread=true` lista as notificações do
  usuário do JWT, das mais recentes para as mais antigas (`limit` de 1 a 50),
  com `{ data, nextCursor, unreadCount }`. Cada item tem `id`, `type`,
  `organizationId`, `organization` (`id`, `name`), `taskId` (`null` se a tarefa
  foi excluída), `taskTitle`, `readAt`, `createdAt` e `actor`.
- Somente notificações de organizações das quais o usuário ainda participa são
  listadas, contadas ou alteradas.
- `POST /notifications/:id/read` marca uma como lida (204, idempotente; 404 se
  não pertencer ao usuário). `POST /notifications/read-all` marca todas.

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
`recentlyUpdated` usa atualização e ID decrescentes; para o histórico de
eventos, use os endpoints de atividade.

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
  `GET, POST, PUT, PATCH, DELETE`, cabeçalhos `Authorization`, `Content-Type`
  e `X-TaskFlow-Request` e credenciais habilitadas, para o cookie de refresh.
  Por ser `SameSite=Strict`, o cookie só é enviado entre origens do mesmo site
  (por exemplo, `app.example.com` e `api.example.com`).
- **Rate limiting** (`@nestjs/throttler`): `POST /auth/login` e
  `POST /auth/register` aceitam 10 requisições por minuto por IP e rota; o
  excedente recebe 429. A contagem fica em memória, então cada instância conta
  separadamente e os contadores reiniciam com o processo. Para várias instâncias,
  avalie um armazenamento compartilhado. Atrás de um proxy reverso, configure
  `TRUST_PROXY`; caso contrário, todos os clientes compartilham o IP do proxy.

O Observe é configurado em `AppModule` e fica habilitado somente quando
`OBSERVE_APP_KEY` e `OBSERVE_APP_SECRET` estão definidas; sem elas, não grava
nem envia telemetria. Definir apenas uma das duas impede a inicialização.
Revise a política de telemetria antes de habilitá-lo. A configuração de
produção (HTTPS, proxy reverso, CSP no servidor do frontend) ainda precisa ser
avaliada.
