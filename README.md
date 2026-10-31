# TaskFlow

TaskFlow é uma plataforma SaaS B2B de gestão de tarefas para organizações. O
repositório usa npm workspaces e está em desenvolvimento inicial: a API NestJS
e a fundação do frontend Angular estão configuradas; a aplicação mobile ainda
não está configurada.

## Estado atual

- Cadastro, login com Argon2id e JWT, e perfil autenticado.
- Criação e listagem de organizações; inclusão e listagem de membros com
  verificação de permissões.
- Criação, listagem, consulta, atualização e exclusão de tarefas por organização,
  com validação de associação, controle de versão, filtros e paginação.
- PostgreSQL com Prisma e migrations versionadas; health check da API.
- Frontend Angular standalone com autenticação, organizações, membros, gestão
  de tarefas e dashboard com indicadores reais da organização ativa.

As atualizações e exclusões usam concorrência otimista por `version`. O funcionamento
offline e a sincronização mobile são planos futuros, não funcionalidades
disponíveis.

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
5. Execute `npm run db:generate --workspace api` e, para um banco novo ou
   depois de avaliar o estado do banco existente,
   `npm run db:migrate:deploy --workspace api`.
6. Inicie com `npm run start:dev --workspace api`. O padrão é a porta 3000.
7. Para o frontend, execute `npm run start --workspace web` e acesse
   `http://localhost:4200`.

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
