export type AudioStateCallback = (isPlaying: boolean) => void;
export type AudioTimeCallback = (currentTime: number, duration: number) => void;
export type AudioErrorCallback = (error: string) => void;
export type AudioBufferingCallback = (isBuffering: boolean) => void;

export class BrowserAudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private onStateCallback: AudioStateCallback | null = null;
  private onTimeCallback: AudioTimeCallback | null = null;
  private onErrorCallback: AudioErrorCallback | null = null;
  private onBufferingCallback: AudioBufferingCallback | null = null;

  constructor() {
    if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
      this.audio = new Audio();
      this.setupListeners();
    }
  }

  public onState(cb: AudioStateCallback): void {
    this.onStateCallback = cb;
  }

  public onTime(cb: AudioTimeCallback): void {
    this.onTimeCallback = cb;
  }

  public onError(cb: AudioErrorCallback): void {
    this.onErrorCallback = cb;
  }

  public onBuffering(cb: AudioBufferingCallback): void {
    this.onBufferingCallback = cb;
  }

  private setupListeners(): void {
    if (!this.audio) {
      return;
    }

    this.audio.addEventListener('play', (): void => {
      this.onBufferingCallback?.(true);
    });

    this.audio.addEventListener('playing', (): void => {
      this.onBufferingCallback?.(false);
      this.onStateCallback?.(true);
    });

    this.audio.addEventListener('waiting', (): void => {
      this.onBufferingCallback?.(true);
    });

    this.audio.addEventListener('pause', (): void => {
      this.onStateCallback?.(false);
    });

    this.audio.addEventListener('ended', (): void => {
      this.onBufferingCallback?.(false);
      this.onStateCallback?.(false);
    });

    this.audio.addEventListener('timeupdate', (): void => {
      if (this.audio) {
        const rawDur: number = this.audio.duration;
        const safeDur: number = Number.isFinite(rawDur) && !Number.isNaN(rawDur) ? rawDur : 0;
        this.onTimeCallback?.(this.audio.currentTime, safeDur);
      }
    });

    this.audio.addEventListener('error', (): void => {
      this.onBufferingCallback?.(false);
      this.onErrorCallback?.('Audio playback error');
      this.onStateCallback?.(false);
    });
  }

  public playStream(url: string): void {
    if (!this.audio) {
      return;
    }

    this.audio.src = url;
    this.audio.currentTime = 0;
    this.audio.play().catch((err: Error): void => {
      this.onErrorCallback?.(err.message);
    });
  }

  public setPlaybackRate(speed: number): void {
    if (this.audio && speed > 0) {
      this.audio.playbackRate = speed;
    }
  }

  public setVolume(volume: number): void {
    if (this.audio) {
      this.audio.volume = Math.max(0, Math.min(1, volume));
    }
  }

  public getVolume(): number {
    return this.audio?.volume ?? 1.0;
  }

  public pause(): void {
    this.audio?.pause();
  }

  public resume(): void {
    this.audio?.play().catch((err: Error): void => {
      this.onErrorCallback?.(err.message);
    });
  }

  public stop(): void {
    if (!this.audio) {
      return;
    }
    this.audio.pause();
    this.audio.currentTime = 0;
    this.audio.src = '';
    this.onBufferingCallback?.(false);
    this.onStateCallback?.(false);
  }

  public seek(timeSeconds: number): void {
    if (this.audio) {
      this.audio.currentTime = Math.max(0, timeSeconds);
    }
  }

  public isPlaying(): boolean {
    return Boolean(
      this.audio && !this.audio.paused && !this.audio.ended && this.audio.readyState > 2,
    );
  }

  public getCurrentTime(): number {
    return this.audio?.currentTime || 0;
  }

  public getDuration(): number {
    return this.audio?.duration || 0;
  }
}
