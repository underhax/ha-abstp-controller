import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { BrowserAudioPlayer } from '../../audio-player.ts';
import type { AbstpCardConfig, HomeAssistant } from '../../types.ts';
import { setSpeakerMute, setSpeakerVolume } from '../api.ts';
import {
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_VOLUME_LEVEL,
  SPEED_HOLD_DELAY_MS,
  SPEED_HOLD_INTERVAL_MS,
} from '../constants.ts';
import { calculateNextSpeed, clampVolume, isSpeedOutOfRange } from '../playback.ts';
import {
  getCardStorageKey,
  loadBrowserAudioSettings,
  loadSelectedSpeed,
  setStorageItem,
} from '../storage.ts';

export interface AudioControllerOptions {
  getConfig: () => AbstpCardConfig | undefined;
}

export class AudioController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly options: AudioControllerOptions;

  public currentSpeed: number = DEFAULT_PLAYBACK_SPEED;
  public volumeLevel: number = DEFAULT_VOLUME_LEVEL;
  public isMuted: boolean = false;
  public browserVolume: number = DEFAULT_VOLUME_LEVEL;
  public browserMuted: boolean = false;

  public speedHoldTimer: number | null = null;
  public speedHoldInterval: number | null = null;

  public constructor(host: ReactiveControllerHost, options: AudioControllerOptions) {
    this.host = host;
    this.options = options;
    this.host.addController(this);
  }

  public hostConnected(): void {
    this.initSettings();
  }

  public hostDisconnected(): void {
    this.stopSpeedHold();
  }

  public initSettings(): void {
    const config: AbstpCardConfig | undefined = this.options.getConfig();
    const { browserMuted, browserVolume } = loadBrowserAudioSettings(config);
    this.browserVolume = browserVolume;
    this.browserMuted = browserMuted;
    this.currentSpeed = loadSelectedSpeed(config);
  }

  public adjustSpeed(newSpeed: number): void {
    this.currentSpeed = calculateNextSpeed(newSpeed, 0);
    const config: AbstpCardConfig | undefined = this.options.getConfig();
    setStorageItem(getCardStorageKey('selected_speed', config), String(this.currentSpeed));
    this.host.requestUpdate();
  }

  public startSpeedHold(delta: number): void {
    this.stopSpeedHold();
    this.adjustSpeed(calculateNextSpeed(this.currentSpeed, delta));
    this.speedHoldTimer = window.setTimeout((): void => {
      this.speedHoldInterval = window.setInterval((): void => {
        const nextSpeed: number = calculateNextSpeed(this.currentSpeed, delta);
        if (isSpeedOutOfRange(nextSpeed)) {
          this.stopSpeedHold();
          return;
        }
        this.adjustSpeed(nextSpeed);
      }, SPEED_HOLD_INTERVAL_MS);
    }, SPEED_HOLD_DELAY_MS);
  }

  public stopSpeedHold(): void {
    if (this.speedHoldTimer !== null) {
      window.clearTimeout(this.speedHoldTimer);
      this.speedHoldTimer = null;
    }
    if (this.speedHoldInterval !== null) {
      window.clearInterval(this.speedHoldInterval);
      this.speedHoldInterval = null;
    }
  }

  public async setVolume(
    val: number,
    selectedPlayer: string,
    hass?: HomeAssistant,
    browserPlayer?: BrowserAudioPlayer,
  ): Promise<void> {
    const roundedVol: number = clampVolume(val);
    this.volumeLevel = roundedVol;
    const config: AbstpCardConfig | undefined = this.options.getConfig();
    if (selectedPlayer === '') {
      this.browserVolume = roundedVol;
      if (this.isMuted && roundedVol > 0) {
        this.isMuted = false;
        this.browserMuted = false;
        setStorageItem(getCardStorageKey('browser_muted', config), 'false');
      }
      setStorageItem(getCardStorageKey('browser_volume', config), String(roundedVol));
      browserPlayer?.setVolume(this.isMuted ? 0 : roundedVol);
    } else if (hass) {
      await setSpeakerVolume(hass, selectedPlayer, roundedVol);
    }
    this.host.requestUpdate();
  }

  public async toggleMute(
    selectedPlayer: string,
    hass?: HomeAssistant,
    browserPlayer?: BrowserAudioPlayer,
  ): Promise<void> {
    this.isMuted = !this.isMuted;
    const config: AbstpCardConfig | undefined = this.options.getConfig();
    if (selectedPlayer === '') {
      this.browserMuted = this.isMuted;
      setStorageItem(getCardStorageKey('browser_muted', config), String(this.browserMuted));
      browserPlayer?.setVolume(this.isMuted ? 0 : this.volumeLevel);
    } else if (hass) {
      await setSpeakerMute(hass, selectedPlayer, this.isMuted);
    }
    this.host.requestUpdate();
  }

  public syncSpeakerVolume(volumeLevel?: number, isMuted?: boolean): void {
    if (volumeLevel !== undefined) {
      this.volumeLevel = volumeLevel;
    }
    if (isMuted !== undefined) {
      this.isMuted = isMuted;
    }
    this.host.requestUpdate();
  }

  public syncBrowserVolume(browserPlayer?: BrowserAudioPlayer): void {
    this.volumeLevel = this.browserVolume;
    this.isMuted = this.browserMuted;
    browserPlayer?.setVolume(this.browserMuted ? 0 : this.browserVolume);
    this.host.requestUpdate();
  }
}
