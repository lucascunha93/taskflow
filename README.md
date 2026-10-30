# TaskFlow

TaskFlow é uma plataforma SaaS B2B de gestão de tarefas para organizações. O
repositório usa npm workspaces e está em desenvolvimento inicial: a API NestJS
existe; as aplicações web e mobile ainda não estão configuradas.

## Estado atual

- Cadastro, login com Argon2id e JWT, e perfil autenticado.
- Criação e listagem de organizações; inclusão e listagem de membros com
  verificação de permissões.
- Criação de tarefas com validação da associação do criador e do responsável.
  Listagem, atualização, exclusão, filtros e concorrência otimista ainda faltam.
- PostgreSQL com Prisma e migrations versionadas; health check da API.

O campo `version` já existe no banco, mas ainda não implementa controle de
concorrência. O funcionamento offline e a sincronização mobile são planos
futuros, não funcionalidades disponíveis.

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
```

Os testes de serviço e HTTP usam dependências simuladas; os testes de
montagem também substituem o banco e a observabilidade. Eles não comprovam
integração real com PostgreSQL. Antes de produção, são necessários testes de
integração em banco dedicado, incluindo isolamento entre organizações.

Consulte [apps/api/README.md](apps/api/README.md) para detalhes dos scripts,
variáveis, endpoints e limitações. Nunca versione arquivos `.env` ou segredos.
