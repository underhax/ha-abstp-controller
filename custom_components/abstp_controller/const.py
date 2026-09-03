"""Constants for the Audiobookshelf Transcoder Proxy Controller integration."""

import logging
from typing import Final

from homeassistant.const import Platform

DOMAIN: Final = "abstp_controller"
LOGGER: Final = logging.getLogger(__package__)

CONF_URL: Final = "url"
CONF_API_KEY: Final = "api_key"
CONF_DEFAULT_SPEED: Final = "default_speed"

DEFAULT_SPEED: Final = 1.0
MIN_SPEED: Final = 0.5
MAX_SPEED: Final = 3.0
SPEED_STEP: Final = 0.05

DEFAULT_SCAN_INTERVAL: Final = 300

SERVICE_PLAY: Final = "play"
SERVICE_STOP: Final = "stop"
SERVICE_SET_SPEED: Final = "set_speed"
SERVICE_REFRESH_LIBRARY: Final = "refresh_library"

ATTR_ITEM_ID: Final = "item_id"
ATTR_EPISODE_ID: Final = "episode_id"
ATTR_SPEED: Final = "speed"
ATTR_CURRENT_TIME: Final = "current_time"
ATTR_SESSION_ID: Final = "session_id"

PLATFORMS: Final[list[Platform]] = [
    Platform.SENSOR,
    Platform.NUMBER,
    Platform.BUTTON,
]
