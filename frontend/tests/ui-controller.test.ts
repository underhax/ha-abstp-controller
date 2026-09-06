import type { ReactiveControllerHost } from 'lit';
import { describe, expect, it, vi } from 'vitest';
import { UiController } from '../src/card/controllers/ui-controller.ts';

describe('UiController', (): void => {
  const createMockHost = (
    element?: HTMLElement,
  ): ReactiveControllerHost & { element: HTMLElement } => {
    const el = element ?? document.createElement('div');
    return {
      addController: vi.fn(),
      element: el,
      removeController: vi.fn(),
      requestUpdate: vi.fn(),
      updateComplete: Promise.resolve(true),
    };
  };

  it('initializes with all popovers and panels closed', (): void => {
    const host = createMockHost();
    const ui = new UiController(host);

    expect(ui.showLibrary).toBe(false);
    expect(ui.showChapters).toBe(false);
    expect(ui.showSpeedPopover).toBe(false);
    expect(ui.showVolumePopover).toBe(false);
    expect(ui.showDeviceMenu).toBe(false);
    expect(ui.speedOnOpen).toBe(1.0);
    expect(host.addController).toHaveBeenCalledWith(ui);
  });

  it('toggles speed popover and captures speed on open', (): void => {
    const host = createMockHost();
    const ui = new UiController(host);

    ui.toggleSpeedPopover(1.75);
    expect(ui.showSpeedPopover).toBe(true);
    expect(ui.speedOnOpen).toBe(1.75);
    expect(host.requestUpdate).toHaveBeenCalled();

    ui.toggleSpeedPopover(1.75);
    expect(ui.showSpeedPopover).toBe(false);
  });

  it('closes speed popover and invokes onApplySpeed callback', async (): Promise<void> => {
    const host = createMockHost();
    const onApplySpeed = vi.fn().mockResolvedValue(undefined);
    const ui = new UiController(host, { onApplySpeed });

    ui.toggleSpeedPopover(2.0);
    await ui.closeSpeedPopover();

    expect(ui.showSpeedPopover).toBe(false);
    expect(onApplySpeed).toHaveBeenCalledWith(2.0);
  });

  it('toggles volume popover and closes other popovers', (): void => {
    const host = createMockHost();
    const ui = new UiController(host);

    ui.showSpeedPopover = true;
    ui.showDeviceMenu = true;

    ui.toggleVolumePopover();
    expect(ui.showVolumePopover).toBe(true);
    expect(ui.showSpeedPopover).toBe(false);
    expect(ui.showDeviceMenu).toBe(false);

    ui.toggleVolumePopover();
    expect(ui.showVolumePopover).toBe(false);
  });

  it('toggles device menu and closes other popovers', (): void => {
    const host = createMockHost();
    const ui = new UiController(host);

    ui.showVolumePopover = true;

    ui.toggleDeviceMenu();
    expect(ui.showDeviceMenu).toBe(true);
    expect(ui.showVolumePopover).toBe(false);

    ui.toggleDeviceMenu();
    expect(ui.showDeviceMenu).toBe(false);
  });

  it('toggles library panel and mutually closes chapters panel', (): void => {
    const host = createMockHost();
    const ui = new UiController(host);

    ui.showChapters = true;

    ui.toggleLibrary();
    expect(ui.showLibrary).toBe(true);
    expect(ui.showChapters).toBe(false);

    ui.toggleLibrary();
    expect(ui.showLibrary).toBe(false);
  });

  it('toggles chapters panel and invokes onChaptersOpened callback', async (): Promise<void> => {
    const host = createMockHost();
    const onChaptersOpened = vi.fn().mockResolvedValue(undefined);
    const ui = new UiController(host, { onChaptersOpened });

    ui.showLibrary = true;

    ui.toggleChapters(false);
    expect(ui.showChapters).toBe(true);
    expect(ui.showLibrary).toBe(false);
    expect(onChaptersOpened).toHaveBeenCalled();

    ui.toggleChapters(false);
    expect(ui.showChapters).toBe(false);
  });

  it('does not open chapters panel when chapters are unavailable', (): void => {
    const host = createMockHost();
    const onChaptersOpened = vi.fn();
    const ui = new UiController(host, { onChaptersOpened });

    ui.toggleChapters(true);
    expect(ui.showChapters).toBe(false);
    expect(onChaptersOpened).not.toHaveBeenCalled();
  });

  it('closes open popovers on Escape keydown', (): void => {
    const host = createMockHost();
    const ui = new UiController(host);
    ui.hostConnected();

    ui.showSpeedPopover = true;
    ui.showVolumePopover = true;
    ui.showDeviceMenu = true;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(ui.showSpeedPopover).toBe(false);
    expect(ui.showVolumePopover).toBe(false);
    expect(ui.showDeviceMenu).toBe(false);

    ui.hostDisconnected();
  });

  it('closes open popovers when clicking outside the host element', (): void => {
    const hostEl = document.createElement('div');
    document.body.appendChild(hostEl);
    const host = createMockHost(hostEl);
    const ui = new UiController(host);
    ui.hostConnected();

    ui.showSpeedPopover = true;

    const outsideTarget = document.createElement('div');
    document.body.appendChild(outsideTarget);
    outsideTarget.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(ui.showSpeedPopover).toBe(false);

    ui.hostDisconnected();
    document.body.removeChild(hostEl);
    document.body.removeChild(outsideTarget);
  });

  it('does not close popovers when clicking inside popover element', (): void => {
    const hostEl = document.createElement('div');
    const childEl = document.createElement('span');
    childEl.className = 'speed-popover';
    hostEl.appendChild(childEl);
    document.body.appendChild(hostEl);

    const host = createMockHost(hostEl);
    const ui = new UiController(host);
    ui.hostConnected();

    ui.showSpeedPopover = true;

    childEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(ui.showSpeedPopover).toBe(true);

    ui.hostDisconnected();
    document.body.removeChild(hostEl);
  });

  it('triggers onPageHide callback on pagehide event', (): void => {
    const host = createMockHost();
    const onPageHide = vi.fn();
    const ui = new UiController(host, { onPageHide });
    ui.hostConnected();

    window.dispatchEvent(new Event('pagehide'));
    expect(onPageHide).toHaveBeenCalled();

    ui.hostDisconnected();
  });
});
