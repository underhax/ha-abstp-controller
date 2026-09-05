import { render, type TemplateResult } from 'lit-html';
import { describe, expect, it, vi } from 'vitest';
import {
  type DevicePickerContext,
  renderDevicePicker,
  renderPlayerIcon,
  resolveDeviceSubtitle,
} from '../src/card/templates/device-picker.ts';
import type { HassEntity, HomeAssistant } from '../src/types.ts';

describe('renderPlayerIcon()', (): void => {
  it('renders browser icon when entity and entityId are absent', (): void => {
    const result: TemplateResult = renderPlayerIcon(undefined, undefined);
    expect(result).toBeDefined();
  });

  it('renders custom icon when icon attribute is provided', (): void => {
    const entity: HassEntity = {
      attributes: { icon: 'mdi:custom-speaker' },
      entity_id: 'media_player.custom',
      state: 'idle',
    };
    const result: TemplateResult = renderPlayerIcon(entity);
    expect(result.strings.join('')).toContain('icon-device');
  });

  it('renders cast icon for chromecast devices', (): void => {
    const entity: HassEntity = {
      attributes: { friendly_name: 'Living Room Cast' },
      entity_id: 'media_player.living_room_chromecast',
      state: 'idle',
    };
    const result: TemplateResult = renderPlayerIcon(entity);
    expect(result.strings.join('')).toContain('mdi:cast');
  });

  it('renders remote tv icon for android tv devices', (): void => {
    const entity: HassEntity = {
      attributes: { friendly_name: 'Bedroom Android TV' },
      entity_id: 'media_player.bedroom_androidtv',
      state: 'idle',
    };
    const result: TemplateResult = renderPlayerIcon(entity);
    expect(result.strings.join('')).toContain('mdi:remote-tv');
  });

  it('renders speaker icon for yandex station devices', (): void => {
    const entity: HassEntity = {
      attributes: { friendly_name: 'Alice Station' },
      entity_id: 'media_player.yandex_station_123',
      state: 'idle',
    };
    const result: TemplateResult = renderPlayerIcon(entity);
    expect(result).toBeDefined();
  });

  it('renders device class tv icon when device_class is tv', (): void => {
    const entity: HassEntity = {
      attributes: { device_class: 'tv' },
      entity_id: 'media_player.samsung_tv',
      state: 'idle',
    };
    const result: TemplateResult = renderPlayerIcon(entity);
    expect(result.strings.join('')).toContain('mdi:television');
  });

  it('renders device class speaker icon when device_class is speaker', (): void => {
    const entity: HassEntity = {
      attributes: { device_class: 'speaker' },
      entity_id: 'media_player.kitchen_audio',
      state: 'idle',
    };
    const result: TemplateResult = renderPlayerIcon(entity);
    expect(result.strings.join('')).toContain('mdi:speaker');
  });

  it('renders receiver icon when device_class is receiver', (): void => {
    const entity: HassEntity = {
      attributes: { device_class: 'receiver' },
      entity_id: 'media_player.denon_avr',
      state: 'idle',
    };
    const result: TemplateResult = renderPlayerIcon(entity);
    expect(result.strings.join('')).toContain('mdi:audio-video');
  });
});

describe('resolveDeviceSubtitle()', (): void => {
  it('returns unavailable string when entity state is unavailable', (): void => {
    const entity: HassEntity = {
      attributes: {},
      entity_id: 'media_player.speaker',
      state: 'unavailable',
    };
    expect(resolveDeviceSubtitle('media_player.speaker', entity, 'en')).toBe('Unavailable');
  });

  it('returns Chromecast subtitle for cast identifiers', (): void => {
    expect(resolveDeviceSubtitle('media_player.chromecast_ultra', undefined, 'en')).toBe(
      'Chromecast',
    );
  });

  it('returns Android TV Remote subtitle for android tv identifiers', (): void => {
    expect(resolveDeviceSubtitle('media_player.android_tv', undefined, 'en')).toBe(
      'Android TV Remote',
    );
  });

  it('returns Yandex Station subtitle for yandex identifiers', (): void => {
    expect(resolveDeviceSubtitle('media_player.yandex_station_hall', undefined, 'en')).toBe(
      'Yandex Station',
    );
  });

  it('strips domain prefix for standard media player identifiers', (): void => {
    expect(resolveDeviceSubtitle('media_player.kitchen_sound', undefined, 'en')).toBe(
      'kitchen_sound',
    );
  });
});

describe('renderDevicePicker()', (): void => {
  it('renders single badge when only one device option exists', (): void => {
    const context: DevicePickerContext = {
      allowedPlayers: ['media_player.hall'],
      config: { player_entities: ['media_player.hall'], type: 'custom:abstp-player-card' },
      lang: 'en',
      onSelectPlayer: vi.fn(),
      onToggleDeviceMenu: vi.fn(),
      selectedPlayer: 'media_player.hall',
      showDeviceMenu: false,
    };
    const container: HTMLDivElement = document.createElement('div');
    render(renderDevicePicker(context), container);
    expect(container.querySelector('.device-picker-row')).not.toBeNull();
    expect(container.querySelector('.clickable')).toBeNull();
  });

  it('renders clickable badge and menu popover when multiple options exist and menu is open', (): void => {
    const mockHass = {
      states: {
        'media_player.hall': {
          attributes: { friendly_name: 'Hall Speaker' },
          entity_id: 'media_player.hall',
          state: 'idle',
        },
      },
    } as unknown as HomeAssistant;

    const toggleFn = vi.fn();
    const selectFn = vi.fn();

    const context: DevicePickerContext = {
      allowedPlayers: ['', 'media_player.hall'],
      config: { player_entities: ['', 'media_player.hall'], type: 'custom:abstp-player-card' },
      hass: mockHass,
      lang: 'en',
      onSelectPlayer: selectFn,
      onToggleDeviceMenu: toggleFn,
      selectedPlayer: '',
      showDeviceMenu: true,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderDevicePicker(context), container);
    const badge: HTMLElement | null = container.querySelector('.clickable');
    expect(badge).not.toBeNull();
    badge?.click();
    expect(toggleFn).toHaveBeenCalled();

    const popover: HTMLElement | null = container.querySelector('.device-menu-popover');
    expect(popover).not.toBeNull();

    const items: NodeListOf<HTMLElement> = container.querySelectorAll('.device-menu-item');
    expect(items.length).toBe(2);
    items[1]?.click();
    expect(selectFn).toHaveBeenCalledWith('media_player.hall');
  });
});
