import { customElement, property, state } from 'lit/decorators.js';
import { type CSSResult, css, LitElement } from 'lit-element/lit-element.js';
import { html, type TemplateResult } from 'lit-html';
import { localize } from './localize.ts';
import type { AbstpCardConfig, HomeAssistant } from './types.ts';

interface MediaPlayerOption {
  id: string;
  name: string;
}

@customElement('abstp-player-card-editor')
export class AbstpPlayerCardEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private config?: AbstpCardConfig;
  @state() private playerToAdd: string = '__none__';
  @state() private draggedPlayer: string | null = null;
  @state() private cardIdError: string | null = null;

  public setConfig(config: AbstpCardConfig): void {
    const nextConfig: AbstpCardConfig = config.card_id
      ? config
      : { ...config, card_id: crypto.randomUUID() };
    this.config = nextConfig;
    this.cardIdError = null;
    this.playerToAdd = '__none__';
    if (!config.card_id) {
      queueMicrotask((): void => {
        if (this.config === nextConfig) {
          this.dispatchConfigChanged(nextConfig);
        }
      });
    }
  }

  private dispatchConfigChanged(newConfig: AbstpCardConfig): void {
    this.config = newConfig;
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        bubbles: true,
        composed: true,
        detail: { config: newConfig },
      }),
    );
  }

  private fireConfigChanged(newConfig: AbstpCardConfig): void {
    void this.validateCardId(newConfig.card_id).then((isValid: boolean): void => {
      if (!isValid) {
        return;
      }
      this.dispatchConfigChanged(newConfig);
    });
  }

  private async validateCardId(cardId: string | undefined): Promise<boolean> {
    if (!cardId || !this.hass) {
      return true;
    }
    try {
      const dashboardConfig: unknown = await this.hass.callWS<unknown>({
        type: 'lovelace/config',
        url_path: AbstpPlayerCardEditor.getDashboardPath(),
      });
      const occurrences: number = AbstpPlayerCardEditor.countCardId(dashboardConfig, cardId);
      const currentCardId: string | undefined = this.config?.card_id;
      const isDuplicate: boolean = occurrences > 1 || (cardId !== currentCardId && occurrences > 0);
      this.cardIdError = isDuplicate ? 'Card ID must be unique.' : null;
      return !isDuplicate;
    } catch {
      this.cardIdError = null;
      return true;
    }
  }

  private static getDashboardPath(): string {
    const segments: string[] = window.location.pathname.split('/').filter(Boolean);
    if (segments[0] === 'lovelace') {
      return segments[1] ?? '0';
    }
    return segments[0] ?? 'lovelace';
  }

  private static countCardId(value: unknown, cardId: string): number {
    if (Array.isArray(value)) {
      return value.reduce(
        (count: number, child: unknown): number =>
          count + AbstpPlayerCardEditor.countCardId(child, cardId),
        0,
      );
    }
    if (!value || typeof value !== 'object') {
      return 0;
    }
    const record = value as {
      type?: unknown;
      card_id?: unknown;
      [key: string]: unknown;
    };
    const ownMatch: number =
      record.type === 'custom:abstp-player-card' && record.card_id === cardId ? 1 : 0;
    return (
      ownMatch +
      Object.values(record).reduce(
        (count: number, child: unknown): number =>
          count + AbstpPlayerCardEditor.countCardId(child, cardId),
        0,
      )
    );
  }

  private handleSpeedChange(ev: Event): void {
    if (!this.config) {
      return;
    }
    const target: HTMLInputElement = ev.target as HTMLInputElement;
    const speedVal: number = Number.parseFloat(target.value);
    const clampedSpeed: number = Math.min(
      3.0,
      Math.max(0.5, Number.isNaN(speedVal) ? 1.0 : speedVal),
    );
    this.fireConfigChanged({
      ...this.config,
      default_speed: clampedSpeed,
    });
  }

  private handleSkipSecondsChange(ev: Event): void {
    if (!this.config) {
      return;
    }
    const target: HTMLInputElement = ev.target as HTMLInputElement;
    const skipVal: number = Number.parseInt(target.value, 10);
    const clampedSkip: number = Math.min(60, Math.max(5, Number.isNaN(skipVal) ? 10 : skipVal));
    this.fireConfigChanged({
      ...this.config,
      skip_seconds: clampedSkip,
    });
  }

  private handleAddPlayer(): void {
    if (!this.config || this.playerToAdd === '__none__') {
      return;
    }
    const currentList: string[] = this.getConfiguredPlayerIds();
    if (currentList.includes(this.playerToAdd)) {
      return;
    }
    const updatedList: string[] = [...currentList, this.playerToAdd];
    this.playerToAdd = '__none__';
    this.fireConfigChanged({
      ...this.config,
      player_entities: updatedList,
    });
  }

  private handleRemovePlayer(playerId: string): void {
    if (!this.config) {
      return;
    }
    const updatedList: string[] = this.getConfiguredPlayerIds().filter(
      (id: string): boolean => id !== playerId,
    );
    this.fireConfigChanged({
      ...this.config,
      player_entities: updatedList,
    });
  }

  private handlePlayerDragStart(playerId: string, ev: DragEvent): void {
    this.draggedPlayer = playerId;
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', playerId);
    }
  }

  private static handlePlayerDragOver(ev: DragEvent): void {
    ev.preventDefault();
    if (ev.dataTransfer) {
      ev.dataTransfer.dropEffect = 'move';
    }
  }

  private handlePlayerDrop(targetId: string, ev: DragEvent): void {
    if (!this.config) {
      return;
    }
    ev.preventDefault();
    const sourceId: string = ev.dataTransfer?.getData('text/plain') || this.draggedPlayer || '';
    if (!sourceId || sourceId === targetId) {
      return;
    }

    const currentList: string[] = this.getConfiguredPlayerIds();
    const sourceIndex: number = currentList.indexOf(sourceId);
    const targetIndex: number = currentList.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const updatedList: string[] = [...currentList];
    const [movedPlayer] = updatedList.splice(sourceIndex, 1);
    if (movedPlayer === undefined) {
      return;
    }
    updatedList.splice(targetIndex, 0, movedPlayer);
    this.fireConfigChanged({
      ...this.config,
      player_entities: updatedList,
    });
  }

  private handlePlayerDragEnd(): void {
    this.draggedPlayer = null;
  }

  private handlePlayerSelection(ev: Event): void {
    const target: HTMLSelectElement = ev.target as HTMLSelectElement;
    this.playerToAdd = target.value;
  }

  private handleHideBooksChange(ev: Event): void {
    if (!this.config) {
      return;
    }
    const target: HTMLInputElement = ev.target as HTMLInputElement;
    this.fireConfigChanged({
      ...this.config,
      hide_books: target.checked,
    });
  }

  private handleHidePodcastsChange(ev: Event): void {
    if (!this.config) {
      return;
    }
    const target: HTMLInputElement = ev.target as HTMLInputElement;
    this.fireConfigChanged({
      ...this.config,
      hide_podcasts: target.checked,
    });
  }

  private getMediaPlayers(): string[] {
    if (!this.hass) {
      return [''];
    }
    const virtualPlayers: string[] = Object.keys(this.hass.states).filter((id: string): boolean =>
      id.startsWith('media_player.abstp_'),
    );
    return ['', ...virtualPlayers];
  }

  private getConfiguredPlayerIds(): string[] {
    const configuredPlayers: string[] = this.config?.player_entities ?? [];
    return [...new Set(configuredPlayers)];
  }

  private getPlayerOption(id: string, lang: string): MediaPlayerOption {
    if (id === '') {
      return { id: '', name: localize('card.browser', lang) };
    }
    const friendlyName: string | undefined = this.hass?.states[id]?.attributes.friendly_name;
    const name: string = friendlyName ?? id;
    return { id, name };
  }

  private static formatPlayerName(option: MediaPlayerOption): string {
    if (option.id === '') {
      return option.name;
    }
    const shortId: string = option.id.replace('media_player.', '');
    return option.name !== option.id ? `${option.name} (${shortId})` : option.id;
  }

  protected override render(): TemplateResult {
    if (!this.hass || !this.config) {
      return html``;
    }

    const lang: string = this.hass.language;
    const allPlayerIds: string[] = this.getMediaPlayers();
    const allOptions: MediaPlayerOption[] = allPlayerIds.map(
      (id: string): MediaPlayerOption => this.getPlayerOption(id, lang),
    );
    const configuredIds: string[] = this.getConfiguredPlayerIds();
    const configuredSet: Set<string> = new Set(configuredIds);
    const configuredOptions: MediaPlayerOption[] = configuredIds.map((id: string) =>
      this.getPlayerOption(id, lang),
    );
    const availableOptions: MediaPlayerOption[] = allOptions.filter(
      (option: MediaPlayerOption): boolean => !configuredSet.has(option.id),
    );

    return html`
      <div class="card-config">
        ${this.cardIdError ? html`<p class="card-id-error" role="alert">${this.cardIdError}</p>` : html``}
        <div class="form-row">
          <label class="label">${localize('editor.media_players', lang)}</label>
          <div class="player-list">
            ${
              configuredOptions.length === 0
                ? html`<p class="fallback-text">${localize('editor.fallback_players', lang)}</p>`
                : configuredOptions.map(
                    (option: MediaPlayerOption): TemplateResult => html`
                      <div
                        class="player-list-item ${
                          this.draggedPlayer === option.id ? 'dragging' : ''
                        }"
                        draggable="true"
                        @dragstart=${(ev: DragEvent): void =>
                          this.handlePlayerDragStart(option.id, ev)}
                        @dragover=${(ev: DragEvent): void => AbstpPlayerCardEditor.handlePlayerDragOver(ev)}
                        @drop=${(ev: DragEvent): void => this.handlePlayerDrop(option.id, ev)}
                        @dragend=${(): void => this.handlePlayerDragEnd()}
                      >
                        <span
                          class="drag-handle"
                          aria-label=${localize('editor.reorder_player', lang)}
                          title=${localize('editor.reorder_player', lang)}
                        >
                          ⋮⋮
                        </span>
                        <span class="player-name">${AbstpPlayerCardEditor.formatPlayerName(option)}</span>
                        <button
                          type="button"
                          class="remove-player-button"
                          aria-label=${localize('editor.remove_player', lang)}
                          @click=${(): void => this.handleRemovePlayer(option.id)}
                        >
                          ×
                        </button>
                      </div>
                    `,
                  )
            }
          </div>
          <div class="add-player-row">
            <select
              class="input add-player-select"
              .value=${this.playerToAdd}
              ?disabled=${availableOptions.length === 0}
              @change=${(ev: Event): void => this.handlePlayerSelection(ev)}
            >
              <option value="__none__" disabled ?selected=${this.playerToAdd === '__none__'}>
                ${localize('editor.select_player', lang)}
              </option>
              ${availableOptions.map(
                (option: MediaPlayerOption): TemplateResult => html`
                  <option value=${option.id} ?selected=${this.playerToAdd === option.id}>
                    ${AbstpPlayerCardEditor.formatPlayerName(option)}
                  </option>
                `,
              )}
            </select>
            <button
              type="button"
              class="add-player-button"
              ?disabled=${this.playerToAdd === '__none__'}
              @click=${(): void => this.handleAddPlayer()}
            >
              + ${localize('editor.add_player', lang)}
            </button>
          </div>
          ${
            allOptions.length > 0 && availableOptions.length === 0
              ? html`<p class="helper-text">${localize('editor.all_players_added', lang)}</p>`
              : allOptions.length === 0
                ? html`<p class="helper-text">${localize('editor.no_players', lang)}</p>`
                : html``
          }
        </div>

        <div class="form-row">
          <label class="label">${localize('editor.default_speed', lang)} (0.5 - 3.0)</label>
          <input
            type="number"
            step="0.05"
            min="0.5"
            max="3.0"
            class="input"
            .value=${String(this.config.default_speed ?? 1.0)}
            @input=${(ev: Event): void => this.handleSpeedChange(ev)}
          />
        </div>

        <div class="form-row">
          <label class="label">${localize('editor.skip_seconds', lang)} (5 - 60)</label>
          <input
            type="number"
            step="5"
            min="5"
            max="60"
            class="input"
            .value=${String(this.config.skip_seconds ?? 10)}
            @input=${(ev: Event): void => this.handleSkipSecondsChange(ev)}
          />
        </div>

        <div class="checkbox-row">
          <input
            type="checkbox"
            id="hide_books"
            ?checked=${Boolean(this.config.hide_books)}
            @change=${(ev: Event): void => this.handleHideBooksChange(ev)}
          />
          <label for="hide_books">${localize('editor.hide_books', lang)}</label>
        </div>

        <div class="checkbox-row">
          <input
            type="checkbox"
            id="hide_podcasts"
            ?checked=${Boolean(this.config.hide_podcasts)}
            @change=${(ev: Event): void => this.handleHidePodcastsChange(ev)}
          />
          <label for="hide_podcasts">${localize('editor.hide_podcasts', lang)}</label>
        </div>
      </div>
    `;
  }

  public static override styles: CSSResult = css`
    .card-config {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 8px 0;
    }

    .form-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .label {
      font-size: 0.9rem;
      font-weight: 500;
      color: var(--primary-text-color);
    }

    .card-id-error {
      color: var(--error-color, #db4437);
      margin: 0 0 12px;
    }

    .input {
      box-sizing: border-box;
      width: 100%;
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid var(--divider-color, #ccc);
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      font-size: 0.9rem;
    }

    .player-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: 44px;
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.1));
      background: var(--secondary-background-color, rgba(0, 0, 0, 0.1));
    }

    .player-list-item {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 38px;
      padding: 4px 6px;
      border-radius: 4px;
      background: var(--card-background-color, #fff);
      cursor: grab;
      user-select: none;
    }

    .player-list-item:active {
      cursor: grabbing;
    }

    .player-list-item.dragging {
      opacity: 0.45;
    }

    .drag-handle {
      color: var(--secondary-text-color, rgba(255, 255, 255, 0.65));
      font-size: 1.25rem;
      letter-spacing: -0.2em;
      line-height: 1;
    }

    .player-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--primary-text-color);
      font-size: 0.9rem;
    }

    .remove-player-button {
      flex: 0 0 auto;
      border: 0;
      background: transparent;
      color: var(--secondary-text-color, rgba(255, 255, 255, 0.65));
      cursor: pointer;
      font-size: 1.35rem;
      line-height: 1;
    }

    .remove-player-button:hover {
      color: var(--error-color, #db4437);
    }

    .add-player-row {
      display: flex;
      gap: 8px;
    }

    .add-player-select {
      flex: 1;
      min-width: 0;
    }

    .add-player-button {
      flex: 0 0 auto;
      padding: 8px 12px;
      border: 0;
      border-radius: 6px;
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 500;
    }

    .add-player-button:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .fallback-text,
    .helper-text {
      margin: 4px 2px;
      color: var(--secondary-text-color, rgba(255, 255, 255, 0.65));
      font-size: 0.85rem;
      line-height: 1.35;
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.9rem;
      color: var(--primary-text-color);
    }
  `;
}
