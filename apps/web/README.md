# TaskFlow Web

Aplicação Angular standalone com layout responsivo, autenticação, organizações,
membros e tarefas. `core`, `shared` e
os diretórios de `features` organizam a evolução por domínio.

## Layout e estilos

O layout em `src/app/core/layout` separa cabeçalho, sidebar e navegação. Em
celulares, o menu expande a navegação no fluxo da página e pode ser fechado
com Escape. O perfil exibe os dados recebidos de `/auth/me` e permite sair.
O seletor permite escolher organizações reais; membros e todas as tarefas estão
disponíveis na navegação. A busca do cabeçalho, o dashboard e os demais itens
ainda não estão conectados.

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

## Organizações

Após validar a sessão, o frontend consulta `GET /organizations`. Na página
inicial `/`, o usuário pode criar sua primeira organização ou escolher entre
as disponíveis. Uma única organização é selecionada automaticamente; com várias,
é necessário escolher uma caso não exista seleção válida. O seletor na sidebar
permite alternar ou acessar `/organizations/new`, onde `POST /organizations`
cria uma organização pelo nome e a seleciona. Erros de carregamento oferecem uma
nova tentativa; a tela não trata falhas como uma lista vazia.

A seleção é armazenada no `sessionStorage` junto ao ID do usuário autenticado.
Após recarregar, ela é restaurada somente depois de validar a sessão e confirmar
que a organização está na lista retornada pela API. Logout ou expiração limpam
o contexto e tentam remover a seleção; falhas de armazenamento são informadas.
O ID armazenado é apenas contexto de navegação, não prova de autorização:
o backend continua responsável por verificar a associação em cada operação.
Páginas dependentes de organização precisam tratar a ausência de contexto.

## Membros

Em `/members`, a aplicação consulta `GET /organizations/:organizationId/members`
para a organização ativa. Uma troca de organização ou saída da página limpa a
lista e cancela requisições pendentes; respostas de outro contexto não são
exibidas. Sem organização ativa, a página orienta a selecionar ou criar uma.

Proprietários podem adicionar usuários já cadastrados como ADMIN ou MEMBER;
administradores podem adicionar somente MEMBER. Membros podem consultar a lista,
mas não adicionar pessoas. O formulário chama
`POST /organizations/:organizationId/members` com `{ email, role }`; não envia
convites. Erros 403 e 409 são informados, assim como 404, que a API usa tanto
para usuário inexistente quanto para organização inacessível. As permissões
visuais são apenas orientação: o backend verifica cada operação. Uma requisição
cancelada no navegador ainda pode ter sido processada pelo servidor.

## Tarefas

Em `/tasks`, a organização ativa determina todas as operações. A página consulta
o resultado paginado da API, permite buscar por título, filtrar por status,
responsável, criador e período de vencimento e escolher ordenação e tamanho da
página. A pesquisa e os filtros aguardam 300 ms antes da consulta e reiniciam a
paginação. Os filtros ficam no estado da página, não na URL; são reiniciados ao
trocar de organização. As opções de pessoas usam os membros e as pessoas das
tarefas carregadas. Para filtros por data, o backend interpreta dias em UTC.

Criação e edição permitem título, descrição, status, responsável e prazo. A
criação envia o status diretamente; o criador é identificado pelo JWT. Na
edição, campos não alterados são omitidos, e limpar descrição, responsável ou
prazo envia `null`. O formulário interpreta o vencimento no horário local e
envia um instante ISO. O prazo original não é modificado se o campo não mudar.

Atualização e exclusão enviam a versão obtida da API. Uma resposta 409 bloqueia
a nova tentativa até o usuário recarregar a tarefa; não há repetição automática.
A troca de organização ou a saída da página cancela requisições e oculta dados
anteriores, mas uma operação cancelada pode já ter sido processada no servidor.
O backend continua responsável por validar associação, responsável e versão.

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
  a mesma origem. O proxy da CLI encaminha `/auth` e `/organizations` para
  `http://localhost:3000`; inicie a API separadamente.
- `src/environments/environment.ts`: produção, por padrão vazio, representando
  a mesma origem da aplicação. O servidor de produção deve encaminhar as rotas
  da API para o backend, ou a URL deve ser configurada antes do build.

O Angular substitui o arquivo de produção pelo de desenvolvimento no build
`development`. Valores são incorporados ao bundle público: nunca coloque
segredos ou credenciais nesses arquivos. A API atual não configura CORS: uma
URL de API em outra origem exige política CORS apropriada no backend. Em
produção, configure o servidor para encaminhar `/auth` e `/organizations` à API e servir o
frontend nas rotas da aplicação. Os testes usam HTTP simulado e não substituem
testes de integração com a API e banco reais.
