# TaskFlow Web

Aplicação Angular standalone com layout responsivo, cadastro e autenticação.
Organizações, membros e tarefas ainda não estão integrados. `core`, `shared` e
os diretórios de `features` organizam a evolução por domínio.

## Layout e estilos

O layout em `src/app/core/layout` separa cabeçalho, sidebar e navegação. Em
celulares, o menu expande a navegação no fluxo da página e pode ser fechado
com Escape. O perfil exibe os dados recebidos de `/auth/me` e permite sair.
Busca, seleção de organização e navegação de negócio permanecem desabilitadas.

Tokens e estilos reutilizáveis ficam em `src/styles/`: cores e dimensões usam
propriedades CSS, enquanto os breakpoints são variáveis SCSS. Os ícones são
SVGs locais, sem biblioteca externa.

## Autenticação e sessão

`/register` cria o usuário e encaminha para `/login`; o cadastro não autentica
automaticamente. O login recebe o Bearer JWT e consulta `/auth/me` antes de
abrir `/`. Os guards aguardam a validação da sessão antes de mostrar o layout
privado; usuários autenticados são redirecionados das telas públicas para `/`.
`/session-error` permite tentar novamente quando a validação falha por rede ou
armazenamento, sem confundir uma indisponibilidade com um 401.

O token é mantido em memória e no `sessionStorage` para restaurar a sessão ao
recarregar a aba. Não persistimos senhas. O armazenamento é acessível a scripts
da origem e **não protege contra XSS**; abas abertas com um opener podem receber
uma cópia inicial do armazenamento. Evite registrar tokens e considere CSP,
proteções contra XSS e a evolução para cookies `HttpOnly`, `Secure` e `SameSite`
antes da publicação, avaliando também CSRF.

O backend atual emite tokens com duração de 15 minutos, sem refresh ou
revogação. O logout remove a sessão local, mas não invalida um token já emitido
no servidor; ele permanece válido até expirar. A expiração é detectada ao
validar ou fazer uma requisição protegida. Respostas 401 dessas requisições
encerram a sessão e direcionam para o login.

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
  a mesma origem. O proxy da CLI encaminha `/auth/**` para
  `http://localhost:3000`; inicie a API separadamente.
- `src/environments/environment.ts`: produção, por padrão vazio, representando
  a mesma origem da aplicação. O servidor de produção deve encaminhar as rotas
  da API para o backend, ou a URL deve ser configurada antes do build.

O Angular substitui o arquivo de produção pelo de desenvolvimento no build
`development`. Valores são incorporados ao bundle público: nunca coloque
segredos ou credenciais nesses arquivos. A API atual não configura CORS: uma
URL de API em outra origem exige política CORS apropriada no backend. Em
produção, configure o servidor para encaminhar `/auth` à API e servir o
frontend nas rotas da aplicação. Os testes usam HTTP simulado e não substituem
testes de integração com a API e banco reais.
