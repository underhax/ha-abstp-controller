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
    background: linear-gradient(135deg, rgb(179, 124, 51) 0%, rgb(177, 108, 16) 40%, rgb(159, 96, 13) 70%, rgb(136, 94, 39) 100%);
    border-radius: var(--abstp-radius);
    border: var(--ha-card-border-width, 1px) solid var(--abstp-border);
    box-shadow: var(--ha-card-box-shadow, none);
    color: #ffffff;
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
    gap: 5px;
    position: relative;
  }

  .device-picker-row {
    display: flex;
    align-items: center;
    position: relative;
    width: fit-content;
    margin-bottom: 5px;
  }

  .device-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    background: transparent;
    border: none;
    color: #ffffff;
    font-size: 1rem;
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
    background: rgb(169, 103, 14);
    border: 1px solid #b58039;
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
    color: #ffffff;
    font-size: 0.88rem;
  }

  .device-menu-item:hover:not(.disabled) {
    background: rgb(181, 128, 57);
  }

  .device-menu-item.active {
    background: rgb(160, 96, 16);
    color: #fff;
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
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity:0.75;
  }

  .now-playing-body {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    width: 100%;
    min-width: 0;
    padding: 15px 0px 5px;
    border-top: 1px solid rgb(174, 106, 16);
  }

  .player-cover {
    width: 100px;
    height: 100px;
    min-width: 100px;
    border-radius: 8px;
    overflow: hidden;
    background: rgb(150, 95, 23);
    position: relative;
    box-shadow: rgba(0, 154, 199, 0.19) 0px 2px 15px;
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
    font-size: 1.15rem;
    font-weight: 600;
    line-height: 1.3;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .player-author {
    font-size: 1.05rem;
    font-weight:300;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity:0.9;
  }

  .player-duration {
    font-size: 0.95rem;
    font-weight:300;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 4px;
    opacity:0.9;
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
    font-size: 0.9rem;
    color: #fff;
    font-variant-numeric: tabular-nums;
  }

  .controls-bar {
    display: grid;
    grid-template-columns: auto 1fr 1fr;
    align-items: center;
    width: 100%;
    position: relative;
    margin-top: 5px;
    padding-top: 10px;
    border-top: 1px solid rgb(168, 105, 20);
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
    color: #ffffff;
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
    width: 26px;
    height: 26px;
  }

  .ctrl-btn.icon-btn.active {
    opacity: 0.6;
  }

  .ctrl-btn-rewind,
  .ctrl-btn-forward  {
    width: 40px;
    height: 40px;
  }
  .ctrl-btn-rewind .icon,
  .ctrl-btn-forward .icon {
    width: 26px;
    height: 26px;
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
    opacity: 1;
  }

  .ctrl-btn-play .icon {
    width: 26px;
    height: 26px;
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

  .ctrl-btn.ctrl-btn-refresh.icon-btn {
    background: #935200;
    border-radius: 50%;
    width: 28px;
    height: 28px;
  }

  .ctrl-btn.icon-btn.ctrl-btn-refresh .icon {
    width: 26px;
    height: 26px;
    position: relative;
    top: 1px;
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
    color: #ffffff;
    font-size: 1rem;
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
    opacity: 0.6;
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
    background: rgb(169, 103, 14);
    border: 1px solid #b58039;
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
    color: #ffffff;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.12s ease;
    text-align: center;
  }

  .speed-preset-btn:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .speed-preset-btn.active {
    background: rgba(255, 255, 255, 0.15);
  }

  .speed-popover-adjust {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 10px;
    padding: 4px 8px;
  }

  .speed-adjust-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: rgb(177, 120, 44);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #ffffff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.12s ease;
    padding: 0;
  }

  .speed-adjust-btn .icon {
    width: 26px;
    height: 26px;
  }

  .speed-adjust-btn:disabled,
  .speed-adjust-btn[disabled] {
    opacity: 0.25;
    cursor: not-allowed;
    pointer-events: none;
  }

  .speed-adjust-btn:hover:not(:disabled) {
    opacity:0.75;
  }

  .speed-current-display {
    font-size: 1.3rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #ffffff;
  }

  .volume-popover {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
    background: rgb(169, 103, 14);
    border: 1px solid #b58039;
    border-radius: 14px;
    box-shadow: rgba(0, 0, 0, 0.2) 0px 8px 24px;
    padding: 12px 5px;
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
    color: #fff;
    font-variant-numeric: tabular-nums;
  }

  .library-section {
    display: flex;
    flex-direction: column;
    gap: 15px;
    margin-top: 5px;
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
    border: 1px solid rgb(191, 135, 59);
    background: rgb(166, 97, 5);
    color: #ffffff;
    font-size: 0.92rem;
    outline: none;
  }

  .search-input:focus {
    border-color: #fff;
  }

  .tabs-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 4px double rgb(166, 94, 3);
    padding-bottom: 4px;
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
    font-weight: 400;
    cursor: pointer;
    color: #fff;
    transition: all 0.2s ease;
  }

  .tab-btn.active {
    background: rgb(147, 82, 0);
    color: #ffffff;
    font-weight: 400;
    border-radius: 10px 10px 0px 0px;
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
    background: #f7f7f7;
    border: 1px solid rgb(166, 94, 3);
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    position: relative;
    box-sizing: border-box;
    width: 100%;
    min-height: 190px;
  }

  .media-card:hover {
    box-shadow: rgba(0, 154, 199, 0.2) 0px 4px 10px;
    border-color: var(--abstp-primary);
  }

  .media-card.active {
    border-color: var(--abstp-primary);
  }

  .card-cover {
    width: 100%;
    height: 130px;
    min-height: 130px;
    max-height: 130px;
    position: relative;
    background: rgb(138, 94, 37);
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
    color: #000;
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
    background: #f4e1c8;
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
    background: rgb(249, 249, 249);
    border-top: 1px solid rgb(244, 225, 200);
    box-sizing: border-box;
    flex: 1;
  }

  .card-title {
    font-size: 0.82rem;
    font-weight: 600;
    line-height: 1.25;
    color: #000;
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
    color: #000;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity:0.75;
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
