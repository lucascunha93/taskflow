# TaskFlow Mobile

Aplicativo Ionic (Angular 22, componentes standalone) empacotado com Capacitor
para Android e iOS. O app foi feito para funcionar offline: as tarefas ficam no
aparelho e as alterações são enviadas quando houver conexão.

## O que o app faz

- Login com a mesma conta da web e escolha da organização.
- Lista de tarefas com filtro por status, busca pelo título e "puxar para
  sincronizar".
- Criação, edição (título, descrição, status, responsável, projeto e prazo) e
  exclusão de tarefas, com ou sem conexão.
- Indicador de sincronização com o tamanho da fila e uma tela para resolver
  conflitos e recusas.

Comentários, anexos, notificações, membros e configurações continuam na web.

## Sessão

- O login usa `POST /auth/mobile/login`, que devolve o refresh token no corpo.
  No WebView do Capacitor o cookie `SameSite=Strict` da web não funciona.
- O refresh token fica no armazenamento seguro do sistema (Keychain no iOS,
  Keystore no Android). O access token fica só em memória.
- No navegador (`ng serve`), usado apenas em desenvolvimento, o refresh token
  fica na `sessionStorage` da aba.
- Renovações simultâneas compartilham uma única requisição, porque a API
  rotaciona o token a cada uso. Diante de um 401, o interceptor renova uma vez e
  repete a chamada.
- Ao abrir o app sem conexão com uma sessão guardada, ele entra no modo offline
  com os dados do aparelho e renova a sessão quando a rede voltar.
- Sessão expirada ou revogada: o app volta ao login e mantém a fila. Se o mesmo
  usuário entrar de novo, a sincronização continua de onde parou.
- Sair encerra a sessão no servidor e apaga todos os dados do aparelho. Se
  houver alterações não enviadas, o app tenta sincronizar e pede confirmação.
- Entrar com outro usuário apaga os dados do anterior.

## Funcionamento offline e sincronização

As regras estão em `src/app/offline/sync-engine.ts` e são testadas em
`sync-engine.spec.ts`.

**Dados no aparelho (IndexedDB).** Os dados ficam separados por usuário e
organização:

- Cópia das 500 tarefas atualizadas mais recentemente.
- Membros e projetos, usados nos seletores.
- Lista de organizações.
- Fila de operações (outbox).

Tarefas com alterações na fila continuam no cache mesmo fora dessa janela.

**Alterações locais.** Toda criação, edição ou exclusão é aplicada na hora no
aparelho e registrada na fila. A lista mostra o estado do servidor com a fila
aplicada por cima e marca cada tarefa como "Não enviada", "Conflito" ou
"Recusada".

- O app gera o UUID das tarefas novas. A API aceita esse `id`, e reenviar a
  mesma criação devolve a tarefa existente, sem duplicar.
- Edições seguidas da mesma tarefa, ainda não enviadas, viram uma só operação.
  Uma edição que volta aos valores originais é descartada.
- Criar e excluir antes do envio descarta as duas operações.

**Envio.** As operações seguem a ordem em que foram feitas, uma por vez, usando
a concorrência otimista da API (`version`).

- **Conflito na edição (409).** O app busca a versão atual e compara campo a
  campo a base local, a alteração local e o servidor:
  - Campo alterado só no aparelho: é mesclado e reenviado automaticamente.
  - Servidor já com o mesmo valor: nada a fazer.
  - Mesmo campo alterado nos dois lados com valores diferentes: conflito. O
    usuário escolhe "Manter meus valores" ou "Usar os do servidor"; na segunda
    opção, os campos sem conflito ainda são enviados.

  Nada é sobrescrito sem decisão do usuário.
- **Exclusão de tarefa alterada no servidor (409).** O usuário escolhe "Excluir
  mesmo assim" ou "Manter a tarefa". Excluir algo que já não existe (404) conta
  como concluído.
- **Edição de tarefa excluída no servidor.** O usuário pode recriá-la com as
  alterações, com o mesmo identificador, ou descartar.
- **Recusa da API (400, 403, 404 da organização, limite do plano).** A operação
  fica como "Recusada", com a mensagem da API. O usuário pode tentar de novo ou
  descartar; descartar uma criação descarta também as edições seguintes daquela
  tarefa.
- Enquanto uma tarefa tem conflito ou recusa, novas alterações nela ficam
  bloqueadas. As outras tarefas continuam sincronizando.
- **Falha de rede ou erro 5xx.** Nova tentativa com espera exponencial, de 5 s
  até 5 min.
- **401 após a renovação falhar.** O envio para e a fila fica guardada.
- Uma edição feita enquanto a operação anterior da mesma tarefa está em envio é
  reposicionada sobre a versão retornada pelo servidor, sem gerar conflito com a
  própria alteração.

**Quando sincroniza:**

- Ao abrir o app e ao entrar.
- Ao reconectar e ao voltar ao primeiro plano.
- Logo após cada alteração local.
- A cada minuto com o app aberto.
- Ao puxar a lista.

A sincronização envia a fila de todas as organizações e atualiza a cópia da
organização ativa.

**Segurança.**

- O cache local não é criptografado além da proteção do próprio sistema
  operacional. Por isso, sair apaga tudo.
- O token de acesso nunca é gravado em disco.
- Todas as regras de permissão e de plano continuam sendo aplicadas pela API;
  o app só reflete as recusas.

## Requisitos e comandos

Instale as dependências na raiz do monorepositório (`npm install`).

```powershell
npm run start --workspace mobile       # http://localhost:8100, com proxy para a API em :3000
npm run test --workspace mobile
npm run lint --workspace mobile
npm run build --workspace mobile
```

## Testar no Android com a API local

Requer o Android Studio com o SDK e um emulador instalados (no primeiro uso, o
assistente do Android Studio baixa o SDK) e o JDK 21.

1. Em `apps/api/.env`, mantenha `CORS_ORIGINS=https://localhost` (origem do
   WebView do Android) e inicie a API: `npm run start:dev --workspace api`.
2. Execute `npm run android:local --workspace mobile`. O script gera o build
   `native-local`, sincroniza o projeto `android/` liberando HTTP somente para
   este teste e abre o Android Studio.
3. No Android Studio, escolha o emulador e clique em Run.

O build local usa `http://10.0.2.2:3000`, o endereço do computador visto pelo
emulador. Para um celular físico na mesma rede Wi-Fi, troque o endereço em
`src/environments/environment.local.ts` pelo IP do computador, libere a porta
3000 no firewall do Windows e rode o script de novo.

A liberação de HTTP fica num manifesto gerado e ignorado pelo git. Um `npx cap
sync` normal volta a exigir HTTPS.

Para testar o modo offline no emulador, use o modo avião ou desligue a rede em
"Extended controls → Cellular/Wi-Fi". Faça alterações, veja o contador da fila e
reative a rede para sincronizar.

## Build nativo (Android e iOS)

1. Defina a URL pública da API, em HTTPS, em
   `src/environments/environment.native.ts`.
2. Na API, inclua em `CORS_ORIGINS` as origens do WebView:
   `capacitor://localhost` (iOS) e `https://localhost` (Android).
3. Gere o build e adicione as plataformas (requer Android Studio ou Xcode):

```powershell
npm run build:native --workspace mobile
cd apps/mobile
npx cap sync android   # para iOS: npx cap add ios && npx cap sync ios
npx cap open android
```

O projeto `android/` já está no repositório. Um projeto `ios/` gerado também
deve ser versionado. O
identificador do app é `app.taskflow.mobile`, em `capacitor.config.ts`.
