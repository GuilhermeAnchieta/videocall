# CLAUDE.md

Guidance for working in this repo. The app itself lives in `fakevideo/` (Angular + Capacitor); `netlify/functions` issues LiveKit tokens; `functions/` is Firebase Cloud Functions.

## Não reintroduzir estes bugs de áudio

Dois bugs sérios de áudio já foram corrigidos aqui e podem voltar se alguém (humano ou IA) mexer nessas áreas sem saber do histórico. Antes de tocar em áudio remoto ou em captura de microfone, leia isto.

### 1. Nunca processe o áudio remoto via Web Audio API antes de tocar

`fakevideo/src/app/services/audio-output.service.ts` toca as tracks remotas anexando-as **diretamente** ao `srcObject` de um `<audio>` (`new MediaStream([track.mediaStreamTrack])`), sem nenhum `AudioContext`/`compressor`/`filter` no meio.

Já existiu uma versão que passava o áudio remoto por um `AudioContext` (compressor + filtro de agudos) antes de tocar, usando `createMediaStreamDestination()` para gerar uma track sintética. Isso quebrou o cancelamento de eco nativo do navegador (`echoCancellation`, ativo na captura local): o browser não reconhece uma track sintetizada pelo Web Audio como "o que está saindo do alto-falante", então no dispositivo sem fone de ouvido o próprio microfone captava de volta o áudio remoto e reenviava para a chamada — um loop que virava um apito agudo crescente (efeito Larsen via software).

**Se precisar de algum processamento no áudio remoto (compressor, equalização, etc.):** não é proibido, mas precisa ser testado em pelo menos dois dispositivos físicos reais, um deles no alto-falante (sem fone), verificando explicitamente que não aparece zumbido/eco crescente durante uma conversa de verdade. Nunca considere isso validado só porque compilou ou porque "tocou som" num teste rápido sozinho.

### 2. Cuidado com libs de áudio que dependem de `SharedArrayBuffer`/WASM multi-thread

O filtro de ruído por IA `@livekit/krisp-noise-filter` foi removido de `fakevideo/src/app/services/livekit.service.ts`. Ele usa `SharedArrayBuffer` internamente, que só fica disponível no navegador se a página for servida com os headers `Cross-Origin-Opener-Policy: same-origin` e `Cross-Origin-Embedder-Policy: require-corp` (ou `credentialless`). O Netlify (`netlify.toml`) não envia esses headers. Sem eles, a inicialização do processor falhava de forma silenciosa dentro do worklet de áudio (sem lançar exceção capturável), e a track publicada saía muda — sem nenhum aviso na tela ou no console visível para o usuário. Como cada participante aplica esse processamento no próprio microfone antes de publicar, o efeito era simétrico: ninguém ouvia ninguém.

**Se reconsiderar Krisp (ou qualquer lib parecida) no futuro:**
- Primeiro configure `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` em `netlify.toml` (via `[[headers]]`) ou um arquivo `_headers`.
- Depois teste se isso não quebra recursos cross-origin existentes — em especial a fonte do Google Fonts carregada em `fakevideo/src/index.html` (Material Symbols), que precisaria responder com `Cross-Origin-Resource-Policy` para não ser bloqueada sob `require-corp`.
- Teste a chamada de voz de ponta a ponta em produção (Netlify), não só em `ng serve` local — o comportamento de rede/CDN é diferente.
- Note que o modelo WASM do Krisp adicionava ~6.4 MB ao bundle da sala de chamada (chunk foi de 8.87 MB para 2.50 MB ao remover) — isso também é relevante em redes móveis mais lentas.

### Onde a lógica de reprodução de áudio remoto vive

- `fakevideo/src/app/services/audio-output.service.ts` — cria/gerencia os `<audio>` de cada participante remoto, escolha de dispositivo de saída (`setSinkId`), e o desbloqueio de autoplay (`playbackBlocked` signal + banner "Tap to enable audio" em `call-room.component.html`).
- `fakevideo/src/app/components/video-tile/video-tile.component.ts` — conecta `audioOutput.connect(track)` sempre que a track de áudio de um participante remoto (não local) muda.
- `fakevideo/src/app/services/livekit.service.ts` — configura a captura local (`audioCaptureDefaults`: `echoCancellation`, `noiseSuppression`, `autoGainControl`) e publica a track de microfone.
