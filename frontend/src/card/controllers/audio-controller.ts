import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { AbstpCardConfig, HomeAssistant } from '../../types.ts';
import { setSpeakerMute, setSpeakerVolume } from '../api.ts';
import {
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_VOLUME_LEVEL,
  SPEED_HOLD_DELAY_MS,
  SPEED_HOLD_INTERVAL_MS,
} from '../constants.ts';
import { calculateNextSpeed, clampVolume, isSpeedOutOfRange } from '../playback.ts';
import { getCardStorageKey, loadSelectedSpeed, setStorageItem } from '../storage.ts';

export interface AudioControllerOptions {
  getConfig: () => AbstpCardConfig | undefined;
}

export class AudioController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly options: AudioControllerOptions;

  public currentSpeed: number = DEFAULT_PLAYBACK_SPEED;
  public volumeLevel: number = DEFAULT_VOLUME_LEVEL;
  public isMuted: boolean = false;

  public speedHoldTimer: number | null = null;
  public speedHoldInterval: number | null = null;

  private playbackSpeedDirty: boolean = false;

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
    this.currentSpeed = loadSelectedSpeed(config);
    this.playbackSpeedDirty = false;
  }

  public persistSelectedSpeed(): void {
    const config: AbstpCardConfig | undefined = this.options.getConfig();
    setStorageItem(getCardStorageKey('selected_speed', config), String(this.currentSpeed));
  }

  public markSpeedDirty(): void {
    this.playbackSpeedDirty = true;
  }

  public adjustSpeed(newSpeed: number): void {
    this.currentSpeed = calculateNextSpeed(newSpeed, 0);
    this.playbackSpeedDirty = true;
    this.persistSelectedSpeed();
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

  public async setVolume(val: number, selectedPlayer: string, hass?: HomeAssistant): Promise<void> {
    const roundedVol: number = clampVolume(val);
    this.volumeLevel = roundedVol;
    if (selectedPlayer && hass) {
      await setSpeakerVolume(hass, selectedPlayer, roundedVol);
    }
    this.host.requestUpdate();
  }

  public async toggleMute(selectedPlayer: string, hass?: HomeAssistant): Promise<void> {
    this.isMuted = !this.isMuted;
    if (selectedPlayer && hass) {
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

  public resetPlaybackSpeed(): void {
    const config: AbstpCardConfig | undefined = this.options.getConfig();
    this.currentSpeed = config?.default_speed ?? DEFAULT_PLAYBACK_SPEED;
    this.playbackSpeedDirty = false;
    this.host.requestUpdate();
  }

  public syncPlaybackSpeed(playbackSpeed?: number): void {
    if (!this.playbackSpeedDirty && playbackSpeed !== undefined && playbackSpeed > 0) {
      this.currentSpeed = playbackSpeed;
    }
    this.host.requestUpdate();
  }

  public syncSpeakerSpeed(playbackSpeed?: number): void {
    const config: AbstpCardConfig | undefined = this.options.getConfig();
    this.currentSpeed =
      playbackSpeed !== undefined && playbackSpeed > 0
        ? playbackSpeed
        : (config?.default_speed ?? DEFAULT_PLAYBACK_SPEED);
    this.playbackSpeedDirty = false;
    this.host.requestUpdate();
  }
}
