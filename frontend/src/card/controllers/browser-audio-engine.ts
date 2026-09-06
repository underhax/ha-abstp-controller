import { BrowserAudioPlayer } from '../../audio-player.ts';
import type { HomeAssistant, PlaySession } from '../../types.ts';
import { startBrowserSession, stopBrowserSession } from '../api.ts';
import { calculateBrowserPosition, normalizeSeekPosition } from '../playback.ts';

export interface BrowserAudioCallbacks {
  onPlaying: () => void;
  onStopped: () => void;
  onBuffering: (buffering: boolean) => void;
  onTimeUpdate: (newPosition: number, duration?: number) => void;
}

export class BrowserAudioEngine {
  public readonly player: BrowserAudioPlayer = new BrowserAudioPlayer();
  public currentSession: PlaySession | null = null;
  public streamStartPos: number = 0;
  public awaitingPlaybackStart: boolean = false;
  public awaitingPlaybackStop: boolean = false;
  public playbackStopTimeout: number | null = null;

  public clearStopTimeout(): void {
    if (this.playbackStopTimeout !== null) {
      window.clearTimeout(this.playbackStopTimeout);
      this.playbackStopTimeout = null;
    }
    this.awaitingPlaybackStop = false;
  }

  public setupListeners(callbacks: BrowserAudioCallbacks): void {
    this.player.onState((playing: boolean): void => {
      if (playing) {
        if (!this.awaitingPlaybackStop) {
          this.awaitingPlaybackStart = false;
          callbacks.onPlaying();
        }
      } else {
        if (!this.awaitingPlaybackStart) {
          callbacks.onStopped();
        }
        this.clearStopTimeout();
      }
    });

    this.player.onBuffering((buffering: boolean): void => {
      if (!this.awaitingPlaybackStop) {
        callbacks.onBuffering(buffering);
        if (!buffering && this.awaitingPlaybackStart) {
          this.awaitingPlaybackStart = false;
          callbacks.onPlaying();
        }
      }
    });

    this.player.onTime((pos: number, dur: number): void => {
      if (this.awaitingPlaybackStop) {
        return;
      }
      if (pos <= 0 && this.awaitingPlaybackStart) {
        return;
      }
      if (pos > 0 && this.awaitingPlaybackStart) {
        this.awaitingPlaybackStart = false;
        callbacks.onPlaying();
      }
      callbacks.onTimeUpdate(pos, dur);
    });

    this.player.onError((): void => {
      this.awaitingPlaybackStart = false;
      this.clearStopTimeout();
      callbacks.onStopped();
    });
  }

  public async startSession(
    hass: HomeAssistant,
    itemId: string,
    episodeId: string | undefined,
    speed: number,
    startPosition: number,
    volume: number,
    isMuted: boolean,
  ): Promise<PlaySession> {
    this.streamStartPos = startPosition;
    this.clearStopTimeout();
    this.awaitingPlaybackStart = true;
    const safeStartPos: number = normalizeSeekPosition(startPosition);
    const session: PlaySession = await startBrowserSession(
      hass,
      itemId,
      episodeId,
      speed,
      safeStartPos,
    );
    this.currentSession = session;
    this.player.setVolume(isMuted ? 0 : volume);
    this.player.playStream(session.stream_url);
    return session;
  }

  public async stopSession(hass?: HomeAssistant): Promise<void> {
    this.awaitingPlaybackStart = false;
    this.awaitingPlaybackStop = true;
    if (this.playbackStopTimeout !== null) {
      window.clearTimeout(this.playbackStopTimeout);
    }
    this.playbackStopTimeout = window.setTimeout((): void => {
      this.awaitingPlaybackStop = false;
      this.playbackStopTimeout = null;
    }, 5000);
    const sessionToStop: PlaySession | null = this.currentSession;
    this.currentSession = null;
    this.player.stop();
    if (hass && sessionToStop) {
      try {
        await stopBrowserSession(hass, sessionToStop.session_id);
      } catch {}
    }
  }

  public calculateProgress(
    pos: number,
    dur: number,
    speed: number,
    currentDuration: number,
  ): { position: number; duration: number } {
    const position: number = calculateBrowserPosition(
      this.streamStartPos,
      pos,
      speed,
      currentDuration,
    );
    let duration: number = currentDuration;
    if (Number.isFinite(dur) && dur > 0 && currentDuration <= 0) {
      duration = dur;
    }
    return { duration, position };
  }

  public async restart(
    hass: HomeAssistant,
    itemId: string,
    episodeId: string | undefined,
    speed: number,
    startPosition: number,
    volume: number,
    isMuted: boolean,
  ): Promise<PlaySession> {
    this.streamStartPos = startPosition;
    this.clearStopTimeout();
    this.player.stop();
    this.awaitingPlaybackStart = true;
    const prevSession: PlaySession | null = this.currentSession;
    this.currentSession = null;
    if (prevSession) {
      try {
        await stopBrowserSession(hass, prevSession.session_id);
      } catch {}
    }
    const safeStartPos: number = normalizeSeekPosition(startPosition);
    const session: PlaySession = await startBrowserSession(
      hass,
      itemId,
      episodeId,
      speed,
      safeStartPos,
    );
    this.currentSession = session;
    this.player.setVolume(isMuted ? 0 : volume);
    this.player.playStream(session.stream_url);
    return session;
  }
}
