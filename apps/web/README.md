# TaskFlow Web

Fundação Angular standalone, sem telas ou funcionalidades de negócio. O
roteador está configurado com uma lista de rotas vazia; futuras features podem
ser carregadas sob demanda. `core`, `shared` e os diretórios de `features`
organizam a evolução por domínio.

## Requisitos e comandos

Use Node.js 24.15 ou superior dentro da versão 24 e npm 11. Na raiz do
monorepositório, instale o lockfile com `npm ci` e execute:

```powershell
npm run start --workspace web
npm run build --workspace web
npm run lint --workspace web
npm run test --workspace web
npm run test:watch --workspace web
```

O servidor de desenvolvimento atende em `http://localhost:4200`. O build usa
produção por padrão; para desenvolvimento, execute
`npm run build --workspace web -- --configuration development`.
Os testes utilizam o builder Angular com Vitest e jsdom.

## Ambientes e API

A aplicação disponibiliza a URL pelo token `API_BASE_URL` em
`src/app/core/api-base-url.ts`. Ajuste `apiBaseUrl` em:

- `src/environments/environment.development.ts`: desenvolvimento, por padrão
  `http://localhost:3000`.
- `src/environments/environment.ts`: produção, por padrão vazio, representando
  a mesma origem da aplicação. O servidor de produção deve encaminhar as rotas
  da API para o backend, ou a URL deve ser configurada antes do build.

O Angular substitui o arquivo de produção pelo de desenvolvimento no build
`development`. Valores são incorporados ao bundle público: nunca coloque
segredos ou credenciais nesses arquivos. A API atual não configura CORS; antes
de integrar chamadas entre portas diferentes, configure um proxy de
desenvolvimento ou uma política CORS apropriada no backend. Nenhuma chamada
à API é feita nesta etapa.
