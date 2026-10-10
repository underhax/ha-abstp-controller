# Audiobookshelf Transcoder Proxy Controller

![Audiobookshelf Transcoder Proxy Controller](custom_components/abstp_controller/brand/logo.png)

Audiobookshelf Transcoder Proxy Controller is a Home Assistant custom integration and Lovelace card for browsing an Audiobookshelf library through an `abstp` server and playing audiobooks or podcast episodes on Home Assistant media players. The integration creates a dedicated virtual media player for each selected physical player, tracks playback sessions, and provides controls for playback speed, seeking, volume, and mute.

[![CI](https://github.com/underhax/ha-abstp-controller/actions/workflows/ci.yml/badge.svg)](https://github.com/underhax/ha-abstp-controller/actions/workflows/ci.yml)
[![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz/)
[![GitHub issues](https://img.shields.io/github/issues/underhax/ha-abstp-controller)](https://github.com/underhax/ha-abstp-controller/issues)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Compatibility

Tested with:

- Home Assistant 2026.10.1
- HACS 2.0.5

The integration requires a separately deployed, reachable [`abstp` server](https://github.com/underhax/audiobookshelf-transcoder-proxy) and media player entities that support `PLAY_MEDIA`. `abstp` connects to Audiobookshelf using its configured URL and Audiobookshelf API key (`ABSTP_ABS_URL`, `ABSTP_ABS_API_KEY`). The Home Assistant integration uses a separate `abstp` proxy API secret. The official `abstp` Docker image includes FFmpeg; standalone deployments require FFmpeg to be installed separately.

## Installation

Install the integration through HACS or use the built archive attached to a GitHub Release.

> [!CAUTION]
> The source code archive does not contain the compiled Lovelace card bundle. Do not install a source archive or clone this repository directly into Home Assistant's `custom_components` directory. Use HACS or the built release archive instead.

### HACS

1. Open **HACS** and select **Custom repositories**.
2. Add `https://github.com/underhax/ha-abstp-controller` as an **Integration** repository.
3. Install **Audiobookshelf Transcoder Proxy Controller**.
4. Restart Home Assistant.

### Manual installation

1. Download `abstp_controller.zip` from [GitHub Releases](https://github.com/underhax/ha-abstp-controller/releases).
2. Create `custom_components/abstp_controller/` in your Home Assistant configuration directory if it does not exist.
3. Extract the archive contents into that directory.
4. Restart Home Assistant.

## Integration setup

1. In Home Assistant, open **Settings** > **Devices & services** > **Integrations**.
2. Select **Add integration** and choose **Audiobookshelf Transcoder Proxy Controller**.
3. Enter the `abstp` server URL and its proxy API secret. The URL form defaults to `http://127.0.0.1:8099`; use an address reachable from Home Assistant. This is the `abstp` API key (`ABSTP_API_KEY`), not the Audiobookshelf API key configured on the proxy (`ABSTP_ABS_API_KEY`).
4. Set the default playback speed, then select the physical media players that should receive playback.
5. Optionally set a display name for each generated virtual player.

The integration validates the server URL and API key during setup. Its options can later be changed from the integration's **Configure** dialog. Playback speed can also be changed with the integration's **Default Speed** number entity; it applies to new playback sessions.

### Entities

The integration provides:

- A `media_player.abstp_<player>` virtual media player for each selected physical player.
- Diagnostic sensors for server status, audiobook count, and podcast count.
- A number entity for the default playback speed, from `0.5` to `3.0` in steps of `0.05`.
- A button to refresh the library immediately.

The virtual player is a facade for its selected physical player: send playback to the virtual entity, and the integration forwards audio to the physical device. Removing a physical player from the integration options removes it from the configured target list.

## Lovelace card

The integration automatically registers the card resource in Home Assistant's storage-mode Lovelace resource registry. In YAML mode, register it manually:

```yaml
lovelace:
  resources:
    - url: /abstp_controller/abstp-player-card.js
      type: module
```

Add **Audiobookshelf Player** from the dashboard card picker, or configure it in YAML:

```yaml
type: custom:abstp-player-card
```

The visual editor lets you select and reorder virtual players, set the default card playback speed and skip interval, and hide audiobook or podcast sections. A minimal YAML configuration uses the defaults. These fields are also available in YAML:

| Option | Default | Description |
| --- | --- | --- |
| `player_entities` | All available virtual players | Virtual players offered by the card. |
| `default_speed` | `1.0` | Initial playback speed; accepted range is `0.5`–`3.0`. |
| `skip_seconds` | `10` | Seek interval; accepted range is `5`–`60` seconds. |
| `hide_books` | `false` | Hide the audiobook library section. |
| `hide_podcasts` | `false` | Hide the podcast library section. |

The card browses audiobooks, podcasts, and in-progress items. It also provides episode and chapter browsing where available, playback controls, and a player selector. The selected player is synchronized for the same Home Assistant user and card ID.

## Audio stream routing

The **Audio Stream Proxy Mode** integration option controls how the physical player receives audio:

| Mode | Behavior |
| --- | --- |
| `Auto` | Uses Home Assistant as the stream proxy when the configured `abstp` URL uses `localhost` or a loopback IP address, except for Yandex Station players. In other cases, the player receives the direct `abstp` stream URL. |
| `Always` | Routes every stream through Home Assistant. |
| `Never` | Sends the direct `abstp` stream URL to the player. |

Choose a mode that matches the network access available to your physical players. With direct streaming, the player must be able to reach the stream URL advertised by `abstp`. Configure `ABSTP_EXTERNAL_URL` on the proxy to an address reachable by those players when its default advertised URL is not accessible to them.

## Services

The integration registers four services under `abstp_controller`:

| Service | Purpose |
| --- | --- |
| `play` | Start an audiobook or podcast episode on one or more media players. |
| `stop` | Stop playback by media player or session ID. |
| `set_speed` | Change the speed of an active session while keeping its current position. |
| `refresh_library` | Request an immediate library refresh. |

Playback speeds accepted by `play` and `set_speed` range from `0.5` to `3.0`. `current_time` is a start position in seconds and defaults to `0.0`. For a podcast, provide both the podcast `item_id` and its `episode_id`.

Example automation action:

```yaml
action: abstp_controller.play
data:
  entity_id: media_player.abstp_living_room
  item_id: audiobook_id_from_your_library
  speed: 1.25
  current_time: 0
```

## Privacy and network access

The integration stores the `abstp` server URL and proxy API secret in its Home Assistant config entry. Home Assistant uses that secret to authenticate to `abstp`; the Audiobookshelf API key is configured and stored on the proxy, not in Home Assistant. The Lovelace card communicates with the integration through Home Assistant's WebSocket API.

Depending on the selected stream proxy mode, audio is either forwarded through Home Assistant or streamed directly from `abstp` to the physical player. Cover images are requested from `abstp` by Home Assistant and served through the integration. No map, geocoding, or other third-party service is required by the card.

## Removal

1. Open **Settings** > **Devices & services** > **Integrations**.
2. Select **Audiobookshelf Transcoder Proxy Controller** and remove it.
3. Remove any Audiobookshelf Player Cards from your dashboards.
4. If you registered the Lovelace resource manually in YAML mode, remove its entry from `configuration.yaml`.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for local setup, build, lint, and test commands.
