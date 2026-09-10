import { Injectable } from '@angular/core';

/**
 * Synthesizes the teleport whoosh/suction sound via Web Audio oscillators and filtered
 * white noise instead of a bundled audio file — cheap to version, identical on every
 * device, and trivial to keep in sync with the CSS effect's timing.
 *
 * Scheduling below is relative to `ctx.currentTime` and mirrors the phase boundaries in
 * call-room.component.ts (TELEPORT_PHASE_*): the suction ramps through the shake + vortex
 * phases (0 - 4.5s) and the impact burst lands on the flash (~4.5s), decaying into silence
 * before the blackout window starts (~5.1-5.2s). Keep both files' numbers in sync when
 * tuning the effect.
 */
@Injectable({ providedIn: 'root' })
export class TeleportSoundService {
  private audioContext?: AudioContext;

  play(): void {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      // Non-owner participants receive the teleport pulse over the data channel, not from
      // their own click, so there may be no fresh user gesture to satisfy autoplay policy.
      // resume() is fire-and-forget: if the browser refuses, the effect just plays silently
      // for that participant, same as any other autoplay-blocked audio in this app.
      void ctx.resume();
    }

    const now = ctx.currentTime;
    this.playSuction(ctx, now);
    this.playImpact(ctx, now);
  }

  private ensureContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  private playSuction(ctx: AudioContext, now: number): void {
    const noise = ctx.createBufferSource();
    noise.buffer = this.whiteNoiseBuffer(ctx, 5.2);

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.Q.value = 0.7;
    bandpass.frequency.setValueAtTime(220, now);
    bandpass.frequency.exponentialRampToValueAtTime(3200, now + 4.5);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.05, now + 1.2);
    noiseGain.gain.exponentialRampToValueAtTime(0.55, now + 4.3);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 5.2);

    const sweep = ctx.createOscillator();
    sweep.type = 'sawtooth';
    sweep.frequency.setValueAtTime(60, now);
    sweep.frequency.exponentialRampToValueAtTime(520, now + 4.5);

    const sweepGain = ctx.createGain();
    sweepGain.gain.setValueAtTime(0.0001, now);
    sweepGain.gain.exponentialRampToValueAtTime(0.12, now + 4.3);
    sweepGain.gain.exponentialRampToValueAtTime(0.0001, now + 5.2);

    noise.connect(bandpass).connect(noiseGain).connect(ctx.destination);
    sweep.connect(sweepGain).connect(ctx.destination);

    noise.start(now);
    noise.stop(now + 5.2);
    sweep.start(now);
    sweep.stop(now + 5.2);
  }

  private playImpact(ctx: AudioContext, now: number): void {
    const t = now + 4.5;

    const noise = ctx.createBufferSource();
    noise.buffer = this.whiteNoiseBuffer(ctx, 0.6);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(4000, t);
    lowpass.frequency.exponentialRampToValueAtTime(200, t + 0.6);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.8, t + 0.03);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);

    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(180, t);
    boom.frequency.exponentialRampToValueAtTime(40, t + 0.5);

    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.0001, t);
    boomGain.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);

    noise.connect(lowpass).connect(noiseGain).connect(ctx.destination);
    boom.connect(boomGain).connect(ctx.destination);

    noise.start(t);
    noise.stop(t + 0.6);
    boom.start(t);
    boom.stop(t + 0.6);
  }

  private whiteNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}
