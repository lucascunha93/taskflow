# TaskFlow Web

Aplicação Angular standalone com layout responsivo, autenticação, organizações,
membros e tarefas. `core`, `shared` e
os diretórios de `features` organizam a evolução por domínio.

## Layout e estilos

O layout em `src/app/core/layout` separa cabeçalho, sidebar e navegação. Em
celulares, o menu expande a navegação no fluxo da página e pode ser fechado
com Escape. O perfil exibe os dados recebidos de `/auth/me` e permite sair.
O seletor permite escolher organizações reais. A navegação leva ao dashboard, a
"Minhas tarefas" (`/tasks?assignee=me`), a todas as tarefas, aos membros e às
configurações da organização; o menu do usuário dá acesso ao perfil. A busca do
cabeçalho abre `/tasks?search=<texto>` na organização ativa e limpa o campo.

Tokens e estilos reutilizáveis ficam em `src/styles/`: cores e dimensões usam
propriedades CSS, enquanto os breakpoints são variáveis SCSS. Os ícones são
SVGs locais, sem biblioteca externa.

## Autenticação e sessão

`/register` cria o usuário e encaminha para `/login`; o cadastro não autentica
automaticamente. O login recebe o Bearer JWT e consulta `/auth/me` antes de
abrir `/`. Os guards aguardam a validação da sessão antes de mostrar o layout
privado; usuários autenticados são redirecionados das telas públicas para `/`.
`/session-error` permite tentar novamente quando a validação falha por rede,
sem confundir uma indisponibilidade com um 401.

O access token (15 minutos) fica **somente em memória**. A sessão continua por
um refresh token em cookie `HttpOnly`, `Secure` e `SameSite=Strict`, gravado
pela API e inacessível a scripts. Ao abrir ou recarregar a aplicação,
`POST /auth/refresh` obtém um novo access token antes de consultar `/auth/me`;
sem cookie válido, o usuário vai para o login. Tokens deixados no
`sessionStorage` por versões anteriores são removidos. Não persistimos senhas.

Quando uma requisição protegida recebe 401, o interceptor faz um único refresh
(compartilhado entre requisições simultâneas) e repete a requisição com o novo
token. Se o refresh também responder 401, a sessão é encerrada e o usuário vai
para o login; uma falha de rede no refresh não encerra a sessão. Um 409
(outra aba renovando o mesmo cookie) é repetido uma vez.

O botão Sair limpa a sessão local e chama `POST /auth/logout`, que revoga o
refresh token desta sessão. "Encerrar todas as sessões", no perfil, revoga
todas. As chamadas de sessão enviam `X-TaskFlow-Request: 1`, exigido pela API
contra CSRF. XSS continua sendo um risco para o access token em memória e para
as ações feitas em nome do usuário: mantenha CSP e as proteções do Angular. Login e cadastro
informam quando a API recusa tentativas em excesso (429), seja pelo limite por
IP, seja pelo bloqueio temporário da conta.

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

## Dashboard

Em `/`, a organização ativa apresenta indicadores de todas as suas tarefas e
distribuição por status, obtidos de `GET /organizations/:organizationId/tasks/summary`.
As listas mostram até cinco tarefas atribuídas ao usuário, próximas do
vencimento e recentemente atualizadas. Somente tarefas em aberto com prazo entre
o instante de referência da API e sete períodos de 24 horas depois aparecem
como próximas do vencimento; as atrasadas ficam de fora dessa lista. Na seção
pessoal, tarefas em aberto atrasadas ou próximas recebem destaque visual.
As datas são exibidas no horário local.

As tarefas abrem detalhes e permitem edição ou exclusão com as mesmas regras
da página de tarefas; após uma alteração, o dashboard é atualizado. O botão
Atualizar também consulta novamente a API. A lista de atualizações recentes
não é um histórico de atividades. Ao trocar de organização, dados anteriores
são ocultados e requisições pendentes canceladas ou ignoradas; a autorização
continua sendo responsabilidade do backend.

## Perfil

Em `/profile`, o usuário consulta e-mail e data de cadastro, vê o papel em cada
organização e altera o nome de exibição por `PATCH /auth/me`. O nome atualizado
passa a ser exibido no cabeçalho e na sidebar. O e-mail não pode ser alterado.

A troca de senha pede a senha atual e a confirmação da nova. A API revoga os
tokens anteriores e devolve um novo, que a aba passa a usar; as outras sessões
são encerradas. Se a resposta se perder, a troca pode ter sido aplicada: a
próxima requisição com o token antigo recebe 401 e leva ao login. "Encerrar
todas as sessões" pede confirmação, chama `DELETE /auth/me/sessions`, limpa a
sessão local e abre o login com um aviso.

## Configurações da organização

Em `/settings`, a página mostra identificador (`slug`), data de criação e o
papel do usuário na organização ativa. Proprietários e administradores podem
renomeá-la por `PATCH /organizations/:organizationId`; membros veem os dados
somente para leitura. Trocar de organização descarta edições e mensagens
pendentes. Um 403 ou 404 da API é informado; a permissão visual é apenas
orientação.

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
paginação. A URL aceita dois filtros iniciais: `assignee=me`, que filtra pelo
usuário autenticado e muda o título para "Minhas tarefas", e `search`. Os demais
filtros ficam no estado da página, não na URL. Trocar de organização ou de
parâmetros da URL reinicia os filtros. As opções de pessoas usam os membros e as pessoas das
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
npm run test:proxy --workspace web
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
  a mesma origem. O cookie de refresh usa o caminho `/auth`, preservado pelo
  proxy. O proxy da CLI encaminha `/auth`, `/organizations` e os
  endpoints de membros e tarefas para `http://localhost:3000`, preservando
  a rota Angular `/organizations/new`. `PATCH /organizations/:id` é
  encaminhado somente quando o ID tem formato UUID. Inicie a API separadamente.
- `src/environments/environment.ts`: produção, por padrão vazio, representando
  a mesma origem da aplicação. O servidor de produção deve encaminhar as rotas
  da API para o backend, ou a URL deve ser configurada antes do build.

O Angular substitui o arquivo de produção pelo de desenvolvimento no build
`development`. Valores são incorporados ao bundle público: nunca coloque
segredos ou credenciais nesses arquivos. Por padrão a API não habilita CORS:
uma URL de API em outra origem exige configurar `CORS_ORIGINS` no backend. Em
produção, encaminhe os endpoints da API sem interceptar a rota do frontend
`/organizations/new`, e sirva o frontend nas rotas da aplicação. Os testes usam HTTP simulado e não substituem
testes de integração com a API e banco reais.
