import { Injectable, signal } from '@angular/core';
import type { Track } from 'livekit-client';

type SinkCapableElement = HTMLAudioElement & {
  setSinkId?: (deviceId: string) => Promise<void>;
};

const SINK_ID_SUPPORTED =
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

/**
 * Toca o áudio remoto (participantes reais e falsos) através de um compressor/limiter em
 * vez de um <audio> cru, e permite escolher o dispositivo de saída (alto-falante/fone).
 * Isso não resolve eco acústico entre dois aparelhos físicos próximos (aquilo é um
 * problema de captação de microfone, não de software — use fone de ouvido ao testar com
 * dois dispositivos na mesma sala), mas evita que picos de volume e artefatos
 * agudos/estourados cheguem sem tratamento, e deixa escolher pra onde o som vai.
 */
@Injectable({ providedIn: 'root' })
export class AudioOutputService {
  private context?: AudioContext;
  private outputDeviceId?: string;
  private readonly liveElements = new Set<SinkCapableElement>();

  readonly sinkIdSupported = SINK_ID_SUPPORTED;
  readonly outputDevice = signal<string | undefined>(undefined);

  private getContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
    }
    if (this.context.state === 'suspended') {
      void this.context.resume();
    }
    return this.context;
  }

  /** Conecta o áudio de um participante remoto a um limiter suave; retorna como desconectar. */
  connect(track: Track): { disconnect(): void } {
    const ctx = this.getContext();
    const stream = new MediaStream([track.mediaStreamTrack]);
    const source = ctx.createMediaStreamSource(stream);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -28;
    compressor.knee.value = 24;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    // Corta um pouco de agudo excessivo (feedback/artefatos de compressão de vídeo captureStream).
    const highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 6000;
    highShelf.gain.value = -6;

    // Sai por um <audio> (em vez de ctx.destination) só pra poder escolher o dispositivo
    // de saída via setSinkId — Web Audio puro não permite escolher o alto-falante.
    const destinationNode = ctx.createMediaStreamDestination();
    source.connect(compressor).connect(highShelf).connect(destinationNode);

    const audioEl: SinkCapableElement = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.srcObject = destinationNode.stream;
    if (this.outputDeviceId && this.sinkIdSupported) {
      void audioEl.setSinkId?.(this.outputDeviceId).catch(() => {});
    }
    this.liveElements.add(audioEl);

    return {
      disconnect: () => {
        this.liveElements.delete(audioEl);
        audioEl.pause();
        audioEl.srcObject = null;
        source.disconnect();
        compressor.disconnect();
        highShelf.disconnect();
        destinationNode.disconnect();
      }
    };
  }

  /** Troca o alto-falante/fone usado para tocar todo áudio remoto já conectado (e o futuro). */
  async setOutputDevice(deviceId: string): Promise<void> {
    this.outputDeviceId = deviceId;
    this.outputDevice.set(deviceId);
    if (!this.sinkIdSupported) return;
    await Promise.all([...this.liveElements].map((el) => el.setSinkId?.(deviceId).catch(() => {})));
  }
}
