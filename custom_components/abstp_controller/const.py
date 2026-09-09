"""Constants for the Audiobookshelf Transcoder Proxy Controller integration."""

import logging
from typing import Final

from homeassistant.const import Platform

DOMAIN: Final = "abstp_controller"
DEFAULT_NAME: Final = "Audiobookshelf Transcoder Proxy Controller"
LOGGER: Final = logging.getLogger(__package__)

CONF_URL: Final = "url"
CONF_API_KEY: Final = "api_key"
CONF_DEFAULT_SPEED: Final = "default_speed"
CONF_STREAM_PROXY_MODE: Final = "stream_proxy_mode"

DEFAULT_SPEED: Final = 1.0
STREAM_PROXY_MODE_AUTO: Final = "auto"
STREAM_PROXY_MODE_ALWAYS: Final = "always"
STREAM_PROXY_MODE_NEVER: Final = "never"
MIN_SPEED: Final = 0.5
MAX_SPEED: Final = 3.0
SPEED_STEP: Final = 0.05

DEFAULT_SCAN_INTERVAL: Final = 300
SESSION_STARTUP_TIMEOUT: Final[float] = 15.0

SERVICE_PLAY: Final = "play"
SERVICE_STOP: Final = "stop"
SERVICE_SET_SPEED: Final = "set_speed"
SERVICE_REFRESH_LIBRARY: Final = "refresh_library"

ATTR_ITEM_ID: Final = "item_id"
ATTR_EPISODE_ID: Final = "episode_id"
ATTR_SPEED: Final = "speed"
ATTR_PLAYBACK_SPEED: Final = "playback_speed"
ATTR_CURRENT_TIME: Final = "current_time"
ATTR_SESSION_ID: Final = "session_id"

CONF_TARGET_PLAYERS: Final = "target_players"
CONF_PLAYER_FRIENDLY_NAMES: Final = "player_friendly_names"
PREFIX_VIRTUAL_PLAYER: Final = "abstp_"
ATTR_TARGET_PLAYER: Final = "target_player"
ATTR_TARGET_AVAILABLE: Final = "target_available"

PLATFORMS: Final[list[Platform]] = [
    Platform.SENSOR,
    Platform.NUMBER,
    Platform.BUTTON,
    Platform.MEDIA_PLAYER,
]
