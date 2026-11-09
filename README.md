# TaskFlow

TaskFlow é uma plataforma SaaS B2B de gestão de tarefas para organizações. O
repositório usa npm workspaces com três aplicações: a API NestJS (`apps/api`), o
frontend Angular (`apps/web`) e o app mobile Ionic com Capacitor
(`apps/mobile`), que funciona offline.

## Estado atual

- Cadastro, login com Argon2id e JWT, perfil autenticado e alteração do nome.
- Troca de senha, encerramento de todas as sessões (revogação de JWT por versão
  de sessão) e bloqueio temporário da conta após falhas seguidas de login.
- Criação, listagem e renomeação de organizações; inclusão e listagem de
  membros com verificação de permissões.
- Criação, listagem, consulta, atualização e exclusão de tarefas por organização,
  com validação de associação, controle de versão, filtros e paginação.
- Comentários, anexos (armazenamento compatível com S3), histórico de
  alterações, notificações no app e projetos com quadro por status.
- Planos Gratuito, Profissional e Empresarial com limites de membros, projetos,
  tarefas e armazenamento, tela de plano e uso e contratação com checkout
  simulado (`BILLING_PROVIDER=fake`, sem cobrança real).
- Sessão com access token em memória e refresh token rotativo em cookie
  `HttpOnly`.
- PostgreSQL com Prisma e migrations versionadas; health check da API.
- Validação de variáveis de ambiente, Helmet, CORS opt-in e rate limiting em
  login e cadastro.
- Frontend Angular standalone com autenticação, organizações, configurações da
  organização, perfil, membros, gestão de tarefas ("Minhas tarefas" e busca no
  cabeçalho) e dashboard com indicadores reais da organização ativa.

- App mobile (Ionic + Capacitor) com tarefas offline: alterações ficam numa fila
  no aparelho e são sincronizadas com mesclagem automática por campo e
  resolução de conflitos pelo usuário. As regras estão em
  `apps/mobile/README.md`.

As atualizações e exclusões usam concorrência otimista por `version`.

## Requisitos

- Node.js 24.15 ou superior dentro da versão 24 e npm 11.
- PostgreSQL acessível ou Docker com Docker Compose.

## Desenvolvimento local

Execute os comandos na raiz do repositório. Não substitua arquivos `.env` já
existentes:

1. Instale as dependências do lockfile: `npm ci`.
2. Se ainda não houver arquivos de ambiente, copie `.env.example` para `.env`
   na raiz e `apps/api/.env.example` para `apps/api/.env`.
3. Configure valores próprios. As variáveis `POSTGRES_DB`, `POSTGRES_USER` e
   `POSTGRES_PASSWORD` da raiz são utilizadas pelo Compose; `DATABASE_URL` na
   API deve apontar para o mesmo banco e codificar caracteres especiais de
   usuário e senha como componentes de URL. Defina `JWT_SECRET` como um valor
   aleatório e exclusivo de pelo menos 32 caracteres. Os exemplos contêm
   apenas marcadores e não são credenciais prontas para uso.
4. Se usar o banco do Compose, execute `docker compose up -d postgres`.
   Aguarde o health check antes de continuar. Um volume já inicializado
   mantém os dados e credenciais anteriores; alterar o `.env` não os atualiza.
   Para anexos, defina `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY` no `.env` da
   raiz, repita-os com as demais variáveis `S3_*` em `apps/api/.env` (veja o
   exemplo) e execute `docker compose up -d object-storage`. Sem isso, o
   restante da aplicação funciona e os anexos ficam indisponíveis.
5. Execute `npm run db:generate --workspace api` e, para um banco novo ou
   depois de avaliar o estado do banco existente,
   `npm run db:migrate:deploy --workspace api`.
6. Inicie com `npm run start:dev --workspace api`. O padrão é a porta 3000.
7. Para o frontend, execute `npm run start --workspace web` e acesse
   `http://localhost:4200`.
8. Para o app mobile no navegador, execute `npm run start --workspace mobile` e
   acesse `http://localhost:8100`. O build nativo está descrito em
   `apps/mobile/README.md`.

Não execute migrações em um banco existente sem verificar o impacto. A
segunda migration adiciona `passwordHash` obrigatório e falha se houver
usuários sem esse campo. Não apague volumes ou redefina bancos para contornar
esse problema; planeje a migração de dados separadamente.

## Verificação

```powershell
npm run build --workspace api
npm run lint --workspace api
npm run test --workspace api
npm run test:e2e --workspace api
npm run build --workspace web -- --configuration development
npm run build --workspace web
npm run lint --workspace web
npm run test --workspace web
npm run test:proxy --workspace web
npm run build --workspace mobile
npm run lint --workspace mobile
npm run test --workspace mobile
node .\node_modules\typescript\bin\tsc --noEmit --incremental false --project apps\api\tsconfig.json
node .\node_modules\typescript\bin\tsc --noEmit --project apps\web\tsconfig.app.json
node .\node_modules\typescript\bin\tsc --noEmit --project apps\web\tsconfig.spec.json
```

Os testes de serviço e HTTP existentes usam dependências simuladas; a suíte
separada `test:integration` usa PostgreSQL real e deve ser executada somente
em um banco exclusivo para testes. Consulte as instruções de isolamento,
migrations e execução no [README da API](apps/api/README.md).

Consulte [apps/api/README.md](apps/api/README.md) e
[apps/web/README.md](apps/web/README.md) para detalhes de configuração e
limitações. Nunca versione arquivos `.env` ou segredos.
