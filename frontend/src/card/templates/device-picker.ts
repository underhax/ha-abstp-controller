import { html, type TemplateResult } from 'lit-html';
import { browserIcon, chevronDownIcon, speakerIcon } from '../../icons.ts';
import { localize } from '../../localize.ts';
import type { AbstpCardConfig, HassEntity, HomeAssistant } from '../../types.ts';

export interface DevicePickerContext {
  allowedPlayers: string[];
  config?: AbstpCardConfig | undefined;
  hass?: HomeAssistant | undefined;
  lang: string;
  selectedPlayer: string;
  showDeviceMenu: boolean;
  onSelectPlayer: (id: string) => void | Promise<void>;
  onToggleDeviceMenu: () => void;
}

export function renderPlayerIcon(
  entity: HassEntity | undefined,
  entityId?: string,
): TemplateResult {
  if (!entity && !entityId) {
    return browserIcon;
  }
  const id: string = (entityId ?? entity?.entity_id ?? '').toLowerCase();
  const entityAttrs = entity?.attributes as
    | { icon?: string; device_class?: string; app_name?: string }
    | undefined;
  const iconAttr: string | undefined = entityAttrs?.icon;
  if (iconAttr) {
    return html`<ha-icon class="icon icon-device" .icon=${iconAttr}></ha-icon>`;
  }

  if (id.includes('chromecast') || id.includes('_cast') || entityAttrs?.app_name === 'Cast') {
    return html`<ha-icon class="icon icon-device" icon="mdi:cast"></ha-icon>`;
  }
  if (id.includes('androidtv') || id.includes('android_tv') || id.includes('remote')) {
    return html`<ha-icon class="icon icon-device" icon="mdi:remote-tv"></ha-icon>`;
  }
  if (id.includes('yandex') || id.includes('station') || id.includes('alice')) {
    return speakerIcon;
  }

  const deviceClass: string | undefined = entityAttrs?.device_class;
  if (deviceClass === 'tv') {
    return html`<ha-icon class="icon icon-device" icon="mdi:television"></ha-icon>`;
  }
  if (deviceClass === 'speaker') {
    return html`<ha-icon class="icon icon-device" icon="mdi:speaker"></ha-icon>`;
  }
  if (deviceClass === 'receiver') {
    return html`<ha-icon class="icon icon-device" icon="mdi:audio-video"></ha-icon>`;
  }
  return speakerIcon;
}

export function resolveDeviceSubtitle(
  id: string,
  entity: HassEntity | undefined,
  lang: string,
): string {
  if (entity?.state === 'unavailable') {
    return localize('card.unavailable', lang);
  }
  const lowerId: string = id.toLowerCase();
  if (lowerId.includes('chromecast') || lowerId.includes('_cast')) {
    return 'Chromecast';
  }
  if (
    lowerId.includes('androidtv') ||
    lowerId.includes('android_tv') ||
    lowerId.includes('remote')
  ) {
    return 'Android TV Remote';
  }
  if (lowerId.includes('yandex') || lowerId.includes('station')) {
    return 'Yandex Station';
  }
  return id.replace('media_player.', '');
}

export function renderSpeakerMenuItem(
  id: string,
  lang: string,
  hass: HomeAssistant | undefined,
  selectedPlayer: string,
  onSelectPlayer: (id: string) => void | Promise<void>,
): TemplateResult {
  const entity: HassEntity | undefined = hass?.states[id];
  const friendlyName: string = entity?.attributes.friendly_name ?? id;
  const isUnavailable: boolean = entity?.state === 'unavailable';
  const isSelected: boolean = selectedPlayer === id;
  const subtitle: string = resolveDeviceSubtitle(id, entity, lang);

  return html`
    <div
      class="device-menu-item ${isSelected ? 'active' : ''} ${isUnavailable ? 'disabled' : ''}"
      @click=${(): void => {
        if (!isUnavailable) {
          void onSelectPlayer(id);
        }
      }}
    >
      ${renderPlayerIcon(entity, id)}
      <div class="device-item-info">
        <span class="device-item-name">${friendlyName}</span>
        ${subtitle ? html`<span class="device-item-area">${subtitle}</span>` : html``}
      </div>
    </div>
  `;
}

export function renderDeviceMenuPopover(
  lang: string,
  allowBrowser: boolean,
  isBrowser: boolean,
  allowedSpeakers: string[],
  hass: HomeAssistant | undefined,
  selectedPlayer: string,
  onSelectPlayer: (id: string) => void | Promise<void>,
): TemplateResult {
  return html`
    <div class="device-menu-popover">
      ${
        allowBrowser
          ? html`
            <div
              class="device-menu-item ${isBrowser ? 'active' : ''}"
              @click=${(): void => {
                void onSelectPlayer('');
              }}
            >
              ${browserIcon}
              <div class="device-item-info">
                <span class="device-item-name">${localize('card.browser', lang)}</span>
              </div>
            </div>
          `
          : html``
      }
      ${allowedSpeakers.map(
        (id: string): TemplateResult =>
          renderSpeakerMenuItem(id, lang, hass, selectedPlayer, onSelectPlayer),
      )}
    </div>
  `;
}

export function renderDevicePicker(context: DevicePickerContext): TemplateResult {
  const allowBrowser: boolean =
    context.config?.player_entities === undefined || context.config.player_entities.includes('');
  const allowedSpeakers: string[] = context.allowedPlayers.filter(
    (id: string): boolean => id !== '',
  );
  const totalOptionsCount: number = (allowBrowser ? 1 : 0) + allowedSpeakers.length;
  const isSingleConfigured: boolean = totalOptionsCount <= 1;

  const isBrowser: boolean = context.selectedPlayer === '';
  const currentEntity: HassEntity | undefined = !isBrowser
    ? context.hass?.states[context.selectedPlayer]
    : undefined;
  const currentName: string = isBrowser
    ? localize('card.browser', context.lang)
    : (currentEntity?.attributes.friendly_name ?? context.selectedPlayer);

  if (isSingleConfigured) {
    return html`
      <div class="device-picker-row">
        <div class="device-badge device-badge-btn" title="${currentName}">
          ${isBrowser ? browserIcon : renderPlayerIcon(currentEntity, context.selectedPlayer)}
          <span class="device-name">${currentName}</span>
        </div>
      </div>
    `;
  }

  return html`
    <div class="device-picker-row">
      <div
        class="device-badge device-badge-btn clickable"
        @click=${(): void => context.onToggleDeviceMenu()}
        title="${localize('card.target_device', context.lang)}"
      >
        ${isBrowser ? browserIcon : renderPlayerIcon(currentEntity, context.selectedPlayer)}
        <span class="device-name">${currentName}</span>
        ${chevronDownIcon}
      </div>

      ${
        context.showDeviceMenu
          ? renderDeviceMenuPopover(
              context.lang,
              allowBrowser,
              isBrowser,
              allowedSpeakers,
              context.hass,
              context.selectedPlayer,
              context.onSelectPlayer,
            )
          : html``
      }
    </div>
  `;
}
