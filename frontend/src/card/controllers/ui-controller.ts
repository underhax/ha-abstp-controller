import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { DEFAULT_PLAYBACK_SPEED } from '../constants.ts';

export interface UiControllerOptions {
  onApplySpeed?: (speedOnOpen: number) => void | Promise<void>;
  onChaptersOpened?: () => void | Promise<void>;
  onPageHide?: () => void;
}

export class UiController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly options: UiControllerOptions;

  public showLibrary: boolean = false;
  public showChapters: boolean = false;
  public showSpeedPopover: boolean = false;
  public showVolumePopover: boolean = false;
  public showDeviceMenu: boolean = false;
  public speedOnOpen: number = DEFAULT_PLAYBACK_SPEED;

  public constructor(host: ReactiveControllerHost, options: UiControllerOptions = {}) {
    this.host = host;
    this.options = options;
    this.host.addController(this);
  }

  public hostConnected(): void {
    window.addEventListener('keydown', this.handleGlobalKeydown);
    window.addEventListener('pointerdown', this.handleGlobalPointerDown);
    window.addEventListener('pagehide', this.handlePageHide);
  }

  public hostDisconnected(): void {
    window.removeEventListener('keydown', this.handleGlobalKeydown);
    window.removeEventListener('pointerdown', this.handleGlobalPointerDown);
    window.removeEventListener('pagehide', this.handlePageHide);
  }

  private handlePageHide = (): void => {
    this.options.onPageHide?.();
  };

  private handleGlobalKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      void this.closeAllPopovers();
    }
  };

  private handleGlobalPointerDown = (e: PointerEvent): void => {
    const path: EventTarget[] = e.composedPath();

    if (this.showSpeedPopover) {
      const insideSpeed: boolean = path.some(
        (el: EventTarget): boolean =>
          el instanceof HTMLElement &&
          (el.classList.contains('speed-popover') || el.classList.contains('ctrl-btn-speed')),
      );
      if (!insideSpeed) {
        void this.closeSpeedPopover();
      }
    }

    if (this.showVolumePopover) {
      const insideVolume: boolean = path.some(
        (el: EventTarget): boolean =>
          el instanceof HTMLElement &&
          (el.classList.contains('volume-popover') || el.classList.contains('ctrl-btn-volume')),
      );
      if (!insideVolume) {
        this.showVolumePopover = false;
        this.host.requestUpdate();
      }
    }

    if (this.showDeviceMenu) {
      const insideDevice: boolean = path.some(
        (el: EventTarget): boolean =>
          el instanceof HTMLElement &&
          (el.classList.contains('device-menu-popover') || el.classList.contains('device-badge')),
      );
      if (!insideDevice) {
        this.showDeviceMenu = false;
        this.host.requestUpdate();
      }
    }
  };

  public toggleLibrary(): void {
    void this.closeSpeedPopover();
    this.showChapters = false;
    this.showLibrary = !this.showLibrary;
    this.showVolumePopover = false;
    this.showDeviceMenu = false;
    this.host.requestUpdate();
  }

  public toggleChapters(hasNoChapters: boolean): void {
    if (hasNoChapters) {
      return;
    }
    void this.closeSpeedPopover();
    this.showLibrary = false;
    this.showChapters = !this.showChapters;
    this.showVolumePopover = false;
    this.showDeviceMenu = false;
    if (this.showChapters) {
      void this.options.onChaptersOpened?.();
    }
    this.host.requestUpdate();
  }

  public toggleSpeedPopover(currentSpeed: number): void {
    if (this.showSpeedPopover) {
      void this.closeSpeedPopover();
    } else {
      this.speedOnOpen = currentSpeed;
      this.showSpeedPopover = true;
      this.showVolumePopover = false;
      this.showDeviceMenu = false;
      this.host.requestUpdate();
    }
  }

  public async closeSpeedPopover(): Promise<void> {
    if (!this.showSpeedPopover) {
      return;
    }
    this.showSpeedPopover = false;
    this.host.requestUpdate();
    await this.options.onApplySpeed?.(this.speedOnOpen);
  }

  public toggleVolumePopover(): void {
    void this.closeSpeedPopover();
    this.showVolumePopover = !this.showVolumePopover;
    this.showDeviceMenu = false;
    this.host.requestUpdate();
  }

  public toggleDeviceMenu(): void {
    this.showDeviceMenu = !this.showDeviceMenu;
    this.showSpeedPopover = false;
    this.showVolumePopover = false;
    this.host.requestUpdate();
  }

  public closeDeviceMenu(): void {
    if (this.showDeviceMenu) {
      this.showDeviceMenu = false;
      this.host.requestUpdate();
    }
  }

  public async closeAllPopovers(): Promise<void> {
    this.showVolumePopover = false;
    this.showDeviceMenu = false;
    await this.closeSpeedPopover();
    this.host.requestUpdate();
  }
}
