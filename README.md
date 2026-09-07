# FakeVideo Meet

App de videochamada estilo Google Meet (Angular + Capacitor + LiveKit + Firebase) com um recurso extra:
qualquer participante pode trocar sua câmera real por um vídeo pré-gravado em loop (com áudio), publicado
no lugar da própria câmera, sem sair da chamada.

## Estrutura

```
fakevideo/            App Angular (web + Capacitor). Todo o front-end mora aqui.
  src/app/pages/         join-room (tela inicial) e call-room (tela da chamada)
  src/app/components/    video-tile, controls-bar, participants-panel, chat-panel, media-switch-modal
  src/app/services/      livekit.service, media-source.service (o núcleo da troca de mídia),
                         clip-library.service, room.service, firebase-app, current-user
  android/, ios/         projetos nativos gerados pelo Capacitor
netlify/functions/     Netlify Functions: generateLiveKitToken, createRoom (substituem as antigas Firebase Functions)
firestore.rules        Regras do Firestore (salas + biblioteca de clipes)
storage.rules          Regras do Storage (clipes compartilhados x pessoais)
firebase.json          Config do Firebase (Functions + emuladores)
```

## Como tudo se conecta

- O front-end nunca fala direto com a API do LiveKit usando a secret key. Ele chama a Cloud Function
  `generateLiveKitToken`, que gera um JWT assinado no servidor e devolve junto a URL do LiveKit.
- Autenticação é anônima (Firebase Auth `signInAnonymously`) só para dar um `uid` estável a cada
  aparelho — usado para saber quais clipes pessoais pertencem a quem, sem exigir cadastro/login.
- A troca câmera ↔ clipe (`media-source.service.ts`) funciona assim: o clipe toca em loop num
  `<video>` oculto, `video.captureStream(30)` gera um `MediaStream` com vídeo+áudio, e essas tracks
  substituem as tracks publicadas via `LocalTrack.replaceTrack()` do LiveKit — sem unpublish/publish,
  sem renegociação, sem piscar a chamada para quem está do outro lado.

## Rodando localmente (sem nenhuma conta na nuvem, 100% de graça)

Tudo funciona local: um LiveKit server de desenvolvimento + o Firebase Emulator Suite (só
Firestore/Storage/Auth) + `netlify dev` (rodando o Angular junto com as duas funções).

### 1. LiveKit local

```bash
brew install livekit
livekit-server --dev
```

Sobe o LiveKit em `ws://localhost:7880` com as credenciais de desenvolvimento padrão
(`devkey` / `secret`) — já configuradas no `.env` da raiz do projeto.

### 2. Firebase Emulator Suite (Firestore + Storage + Auth — sem Functions)

Requer **Java 21+**.

```bash
firebase emulators:start --only firestore,storage,auth
```

Emulator UI fica em http://127.0.0.1:4000.

### 3. App Angular + Netlify Functions juntos

```bash
npm install -g netlify-cli   # só na primeira vez
cd fakevideo && npm install && cd ..
netlify dev
```

Abre `http://localhost:8888` (não `4200` — é a porta do `netlify dev`, que já embute o Angular
e as duas functions no mesmo lugar) em duas abas/navegadores diferentes para simular duas
pessoas na mesma sala.

O `.env` da raiz já vem preenchido com tudo que é preciso pra isso funcionar sem cadastrar
nada em lugar nenhum: LiveKit local + emulador do Firestore.

### Semeando um clipe na biblioteca compartilhada

A biblioteca "compartilhada" (visível para todos na sala) é curada — não existe upload de clipe
compartilhado pelo próprio app (só clipes pessoais). Para testar localmente, suba um vídeo pelo
Emulator UI (Storage, em `clips/shared/`) e crie um documento correspondente na coleção `clips` do
Firestore com o formato:

```json
{
  "name": "Nome do clipe",
  "url": "http://127.0.0.1:9199/v0/b/demo-fakevideo.appspot.com/o/clips%2Fshared%2Farquivo.mp4?alt=media",
  "scope": "shared",
  "durationSeconds": 8
}
```

## Indo para produção — também 100% de graça, sem cartão de crédito

Cloud Functions do Firebase exige o plano pago Blaze mesmo pra uso gratuito, então esse projeto
não usa mais Firebase Functions: as duas funções (gerar token do LiveKit e criar sala) viraram
**Netlify Functions**, que rodam de graça sem pedir cartão. O Firebase continua sendo usado só
pra Firestore + Storage + Auth anônimo, que funcionam no plano gratuito **Spark** (sem cartão).

1. **LiveKit Cloud** (plano *Build*, grátis, sem cartão — 5.000 minutos de participante/mês
   inclusos): crie um projeto em https://cloud.livekit.io e copie, em *Settings > Keys*, a
   WebSocket URL, a API Key e o API Secret.
2. **Firebase** (plano *Spark*, grátis, sem cartão — **não faça upgrade pro Blaze**): crie um
   projeto em https://console.firebase.google.com, habilite Firestore (modo produção), Storage
   e Authentication (método Anônimo). Em *Configurações do projeto > Contas de serviço*, clique
   em "Gerar nova chave privada" — isso baixa um JSON com `project_id`, `client_email` e
   `private_key`, que é o que as Netlify Functions usam pra escrever no Firestore sem precisar
   do SDK cliente autenticado.
3. Atualize `fakevideo/src/environments/environment.ts` com a config web real do Firebase
   (*Configurações do projeto > Geral > Seus apps > `</>` Web*).
4. **Netlify** (grátis, sem cartão): crie uma conta em https://app.netlify.com, "Add new site >
   Import an existing project" (conecta no GitHub) ou `netlify deploy` pela CLI direto desta
   pasta. Configure as variáveis de ambiente do site (*Site configuration > Environment
   variables*) com o conteúdo de `.env.example`: `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
   `LIVEKIT_API_SECRET`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
   (a chave privada do JSON, com as quebras de linha `\n` mantidas como estão no arquivo).
5. Deploy das regras do Firestore/Storage (não precisa de Blaze pra isso):
   ```bash
   firebase deploy --only firestore:rules,storage:rules
   ```
6. `netlify deploy --prod` (ou deixe a Netlify buildar automaticamente a cada push, se conectou
   via GitHub) — o comando de build já compila o Angular em modo produção.

Ao final desse passo a passo você tem uma URL pública (tipo `fakevideo-xxx.netlify.app`) que
qualquer pessoa abre no navegador, de qualquer rede, sem custo nenhum enquanto o uso ficar
dentro das cotas gratuitas de cada serviço (bem acima do que uma brincadeira com o time
consome).

## Uso responsável

A troca de câmera por um clipe gravado só aparece marcada (ícone de claquete) na tela de quem está
controlando aquele participante — para os demais, o vídeo aparece normalmente, como se fosse a câmera
real. Use apenas em contextos em que todos os participantes sabem e consentem com a brincadeira ou
teste; evite cenários que dependam de presença real verificada (provas, entrevistas, etc.).
