import { type CSSResult, css } from 'lit-element/lit-element.js';

export const cardStyles: CSSResult = css`
  :host {
    display: block;
    --abstp-primary: var(--primary-color, #03a9f4);
    --abstp-accent: var(--accent-color, #ff9800);
    --abstp-bg: var(--ha-card-background, var(--card-background-color, #1c1c1e));
    --abstp-sec-bg: var(--secondary-background-color, rgba(255, 255, 255, 0.06));
    --abstp-border: var(--ha-card-border-color, var(--divider-color, rgba(255, 255, 255, 0.1)));
    --abstp-radius: var(--ha-card-border-radius, 16px);
  }

  ha-card {
    display: flex;
    flex-direction: column;
    overflow: visible;
    padding: 16px;
    gap: 14px;
    background: var(--abstp-bg);
    border-radius: var(--abstp-radius);
    border: var(--ha-card-border-width, 1px) solid var(--abstp-border);
    box-shadow: var(--ha-card-box-shadow, none);
    color: var(--primary-text-color, #ffffff);
    box-sizing: border-box;
    position: relative;
    font-family: var(--ha-card-font-family, inherit);
  }

  .icon {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    fill: currentColor;
    flex-shrink: 0;
  }

  .icon-sm {
    width: 16px;
    height: 16px;
  }

  .icon-lg {
    width: 24px;
    height: 24px;
  }

  .icon-spin {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transform-origin: center center;
    animation: abstp-spin 1.2s linear infinite;
  }

  @keyframes abstp-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .player-hero {
    display: flex;
    flex-direction: column;
    gap: 12px;
    position: relative;
  }

  .device-picker-row {
    display: flex;
    align-items: center;
    position: relative;
    width: fit-content;
    margin-bottom: 10px;
  }

  .device-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    background: transparent;
    border: none;
    color: var(--primary-text-color, #ffffff);
    font-size: 0.95rem;
    font-weight: 500;
    cursor: default;
    user-select: none;
    transition: opacity 0.15s ease;
  }

  .device-badge.clickable {
    cursor: pointer;
  }

  .device-badge.clickable:hover {
    opacity: 0.8;
  }

  .device-badge .device-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .device-badge .chevron-icon {
    width: 14px;
    height: 14px;
    opacity: 0.75;
    margin-left: 1px;
    flex-shrink: 0;
  }

  .device-menu-popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    width: 250px;
    background: var(--card-background-color, #242426);
    border: 1px solid var(--abstp-border);
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    z-index: 100;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 6px 0;
  }

  .device-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    cursor: pointer;
    transition: background 0.15s ease;
    color: var(--primary-text-color, #ffffff);
    font-size: 0.88rem;
  }

  .device-menu-item:hover:not(.disabled) {
    background: rgba(255, 255, 255, 0.08);
  }

  .device-menu-item.active {
    background: rgba(3, 169, 244, 0.15);
    color: var(--abstp-primary);
    font-weight: 600;
  }

  .device-menu-item.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .device-item-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
  }

  .device-item-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .device-item-area {
    font-size: 0.75rem;
    color: var(--secondary-text-color, rgba(255, 255, 255, 0.5));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .now-playing-body {
    display: flex;
    gap: 14px;
    align-items: center;
    width: 100%;
    min-width: 0;
  }

  .player-cover {
    width: 76px;
    height: 76px;
    min-width: 76px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--abstp-sec-bg);
    position: relative;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    flex-shrink: 0;
  }

  .player-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    z-index: 2;
  }

  .player-cover .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2.2rem;
    color: var(--secondary-text-color, rgba(255, 255, 255, 0.4));
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
  }

  .player-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
    flex: 1;
    min-width: 0;
  }

  .player-title {
    font-size: 1.05rem;
    font-weight: 600;
    line-height: 1.3;
    color: var(--primary-text-color, #ffffff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .player-author {
    font-size: 0.88rem;
    color: var(--secondary-text-color, rgba(255, 255, 255, 0.7));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .player-duration {
    font-size: 0.8rem;
    color: var(--secondary-text-color, rgba(255, 255, 255, 0.5));
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .timeline-container {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 2px;
  }

  .time-slider {
    width: 100%;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: linear-gradient(
      to right,
      var(--abstp-primary) 0%,
      var(--abstp-primary) var(--slider-progress, 0%),
      rgba(255, 255, 255, 0.18) var(--slider-progress, 0%),
      rgba(255, 255, 255, 0.18) 100%
    );
    border-radius: 3px;
    outline: none;
    cursor: pointer;
    transition: height 0.15s ease;
  }

  .time-slider:hover {
    height: 8px;
  }

  .time-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--abstp-primary);
    cursor: pointer;
    box-shadow: 0 0 8px rgba(0, 0, 0, 0.6);
    border: 2px solid #ffffff;
  }

  .time-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: var(--secondary-text-color, rgba(255, 255, 255, 0.65));
    font-variant-numeric: tabular-nums;
  }

  .controls-bar {
    display: grid;
    grid-template-columns: auto 1fr 1fr;
    align-items: center;
    width: 100%;
    position: relative;
    margin-top: 4px;
  }

  .controls-left-placeholder {
    display: flex;
    align-items: center;
  }

  .playback-group {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 18px;
  }

  .controls-right-group {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    position: relative;
  }

  .ctrl-btn {
    background: transparent;
    border: none;
    outline: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--primary-text-color, #ffffff);
    padding: 0;
    transition: opacity 0.15s ease, transform 0.15s ease;
    user-select: none;
    position: relative;
  }

  .speed-pill-btn:hover,
  .ctrl-btn:hover {
    opacity: 0.75;
  }

  .ctrl-btn.icon-btn {
    width: 28px;
    height: 28px;
    background: transparent;
    border: none;
  }

  .ctrl-btn.icon-btn .icon {
    width: 24px;
    height: 24px;
  }

  .ctrl-btn.icon-btn.active {
    color: var(--abstp-primary);
  }

  .ctrl-btn-rewind,
  .ctrl-btn-forward  {
    width: 40px;
    height: 40px;
  }
  .ctrl-btn-rewind .icon,
  .ctrl-btn-forward .icon {
    width: 24px;
    height: 24px;
  }

  .skip-value {
    position: absolute;
    font-size: 10px;
  }

  .ctrl-btn-play {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--abstp-primary);
    color: #ffffff;
    box-shadow: 0 4px 14px rgba(3, 169, 244, 0.4);
    opacity: 1;
  }

  .ctrl-btn-play .icon {
    width: 24px;
    height: 24px;
  }

  .ctrl-btn-play .icon-play {
    transform: translateX(1.5px);
  }

  .ctrl-btn-speed {
    height: 28px;
    padding: 0 4px;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .ctrl-btn-volume {
    width: 28px;
    height: 28px;
  }
  .icon-volume {
    width: 22px;
    height: 22px;
  }

  .ctrl-btn-library {
    width: 28px;
    height: 28px;
  }
  .icon-library {
    width: 22px;
    height: 22px;
  }

  .ctrl-btn-refresh {
    width: 28px;
    height: 28px;
  }
  .icon-refresh {
    width: 20px;
    height: 20px;
  }

  .speed-btn-minus {
    width: 28px;
    height: 28px;
  }
  .icon-speed-minus {
    width: 14px;
    height: 14px;
  }

  .speed-btn-plus {
    width: 28px;
    height: 28px;
  }
  .icon-speed-plus {
    width: 14px;
    height: 14px;
  }

  .speed-pill-btn {
    background: transparent;
    border: none;
    outline: none;
    color: var(--primary-text-color, #ffffff);
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    padding: 0 4px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    transition: opacity 0.15s ease, color 0.15s ease;
    user-select: none;
  }

  .speed-pill-btn.active {
    color: var(--abstp-primary);
    opacity: 1;
  }

  .popover-anchor {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 28px;
  }

  .speed-popover {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--card-background-color, #242426);
    border: 1px solid var(--abstp-border);
    border-radius: 14px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 100;
    min-width: 250px;
  }

  .speed-popover-presets {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 4px;
  }

  .speed-preset-btn {
    padding: 6px 0;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid transparent;
    color: var(--primary-text-color, #ffffff);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s ease;
    text-align: center;
  }

  .speed-preset-btn:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .speed-preset-btn.active {
    background: rgba(255, 255, 255, 0.25);
  }

  .speed-popover-adjust {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 10px;
    padding: 4px 8px;
  }

  .speed-adjust-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: var(--abstp-sec-bg);
    border: 1px solid var(--abstp-border);
    color: var(--primary-text-color, #ffffff);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.12s ease;
    padding: 0;
  }

  .speed-adjust-btn .icon {
    width: 22px;
    height: 22px;
  }

  .speed-adjust-btn:disabled,
  .speed-adjust-btn[disabled] {
    opacity: 0.25;
    cursor: not-allowed;
    pointer-events: none;
  }

  .speed-adjust-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.15);
  }

  .speed-current-display {
    font-size: 1.3rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--primary-text-color, #ffffff);
  }

  .volume-popover {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--card-background-color, #242426);
    border: 1px solid var(--abstp-border);
    border-radius: 14px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    padding: 14px 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    z-index: 100;
    width: 48px;
  }

  .volume-vertical-track {
    height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .volume-slider-vertical {
    -webkit-appearance: none;
    appearance: none;
    width: 110px;
    height: 6px;
    background: linear-gradient(
      to right,
      var(--abstp-primary) 0%,
      var(--abstp-primary) var(--volume-percent, 50%),
      rgba(255, 255, 255, 0.2) var(--volume-percent, 50%),
      rgba(255, 255, 255, 0.2) 100%
    );
    border-radius: 3px;
    outline: none;
    transform: rotate(-90deg);
    cursor: pointer;
  }

  .volume-slider-vertical::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--abstp-primary);
    border: 2px solid #ffffff;
    cursor: pointer;
    box-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
  }

  .volume-percent-label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--secondary-text-color, rgba(255, 255, 255, 0.75));
    font-variant-numeric: tabular-nums;
  }

  .library-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 6px;
    border-top: 1px solid var(--abstp-border);
    padding-top: 14px;
  }

  .search-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .search-input {
    flex: 1;
    padding: 9px 14px;
    border-radius: 10px;
    border: 1px solid var(--abstp-border);
    background: var(--abstp-sec-bg);
    color: var(--primary-text-color, #ffffff);
    font-size: 0.92rem;
    outline: none;
  }

  .search-input:focus {
    border-color: var(--abstp-primary);
  }

  .tabs-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--abstp-border);
    padding-bottom: 8px;
  }

  .tabs-group {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .tab-btn {
    background: transparent;
    border: none;
    padding: 6px 16px;
    border-radius: 16px;
    font-size: 0.88rem;
    font-weight: 500;
    cursor: pointer;
    color: var(--secondary-text-color, rgba(255, 255, 255, 0.65));
    transition: all 0.2s ease;
  }

  .tab-btn.active {
    background: var(--abstp-primary);
    color: #ffffff;
    font-weight: 600;
  }

  .library-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 12px;
    max-height: 440px;
    overflow-y: auto;
    padding: 4px 2px;
  }

  .media-card {
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    overflow: hidden;
    background: var(--abstp-sec-bg);
    border: 1px solid var(--abstp-border);
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    position: relative;
    box-sizing: border-box;
    width: 100%;
    min-height: 190px;
  }

  .media-card:hover {
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.35);
    border-color: var(--abstp-primary);
  }

  .media-card.active {
    border-color: var(--abstp-primary);
    box-shadow: 0 0 0 2px var(--abstp-primary);
  }

  .card-cover {
    width: 100%;
    height: 130px;
    min-height: 130px;
    max-height: 130px;
    position: relative;
    background: var(--abstp-sec-bg);
    display: block;
    overflow: hidden;
  }

  .card-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    z-index: 2;
  }

  .card-cover .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2.4rem;
    color: var(--secondary-text-color, rgba(255, 255, 255, 0.4));
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
  }

  .progress-bar-bg {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: rgba(0, 0, 0, 0.6);
    z-index: 3;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--abstp-accent);
  }

  .progress-bar-fill.finished {
    height: 100%;
    background: #22c55e;
    width: 100% !important;
  }

  .card-info {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    background: var(--abstp-bg);
    box-sizing: border-box;
    flex: 1;
  }

  .card-title {
    font-size: 0.82rem;
    font-weight: 600;
    line-height: 1.25;
    color: var(--primary-text-color, #ffffff);
    min-height: 2.5em;
    max-height: 2.5em;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: normal;
    word-break: break-word;
  }

  .card-author {
    font-size: 0.72rem;
    color: var(--secondary-text-color, rgba(255, 255, 255, 0.65));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .podcast-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 2px 0 6px 0;
  }

  .podcast-header-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--primary-text-color, #ffffff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .episodes-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 440px;
    overflow-y: auto;
  }

  .episode-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    border-radius: 10px;
    background: var(--abstp-sec-bg);
    border: 1px solid var(--abstp-border);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .episode-item:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: var(--abstp-primary);
  }

  .episode-item.active {
    border-color: var(--abstp-primary);
    background: rgba(3, 169, 244, 0.08);
  }

  .episode-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  .empty-state {
    text-align: center;
    padding: 32px 16px;
    color: var(--secondary-text-color, rgba(255, 255, 255, 0.6));
    font-size: 0.9rem;
  }
`;
