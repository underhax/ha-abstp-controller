"""Unit tests for abstp custom services."""

from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock

from homeassistant.config_entries import ConfigEntry

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

from custom_components.abstp_controller.api import AbstpApiClient, PlaySession
from custom_components.abstp_controller.const import (
    CONF_DEFAULT_SPEED,
    DOMAIN,
    SERVICE_PLAY,
    SERVICE_REFRESH_LIBRARY,
    SERVICE_SET_SPEED,
    SERVICE_STOP,
)
from custom_components.abstp_controller.coordinator import (
    AbstpDataUpdateCoordinator,
)
from custom_components.abstp_controller.services import (
    async_setup_services,
    async_unload_services,
)
from custom_components.abstp_controller.tracker import SessionTracker


async def test_services_play_and_stop(hass: HomeAssistant) -> None:
    """Test play and stop service executions."""
    client = AsyncMock(spec=AbstpApiClient)
    client.async_start_session = AsyncMock(
        return_value=PlaySession(
            session_id="sess_123",
            stream_url="http://abstp.example.com:8099/stream/sess_123.aac",
            current_time=0.0,
            duration=3600.0,
        )
    )
    client.async_stop_session = AsyncMock(return_value=True)

    config_entry = MagicMock(spec=ConfigEntry)
    config_entry.options = {CONF_DEFAULT_SPEED: 1.25}
    config_entry.data = {CONF_DEFAULT_SPEED: 1.25}

    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.config_entry = config_entry

    tracker = SessionTracker(hass, client)

    hass.data[DOMAIN] = {
        "test_entry_id": {
            "coordinator": coordinator,
            "tracker": tracker,
        }
    }

    await async_setup_services(hass)
    assert hass.services.has_service(DOMAIN, SERVICE_PLAY)
    assert hass.services.has_service(DOMAIN, SERVICE_STOP)
    assert hass.services.has_service(DOMAIN, SERVICE_SET_SPEED)
    assert hass.services.has_service(DOMAIN, SERVICE_REFRESH_LIBRARY)

    hass.services.async_register("media_player", "play_media", AsyncMock())
    hass.services.async_register("media_player", "media_stop", AsyncMock())

    _ = await hass.services.async_call(
        DOMAIN,
        SERVICE_PLAY,
        {
            "entity_id": ["media_player.speaker"],
            "item_id": "book_1",
            "speed": 1.5,
        },
        blocking=True,
    )
    start_session_mock = cast("AsyncMock", client.async_start_session)
    start_session_mock.assert_called_once()
    assert tracker.get_active_session("media_player.speaker") is not None

    _ = await hass.services.async_call(
        DOMAIN,
        SERVICE_SET_SPEED,
        {
            "entity_id": "media_player.speaker",
            "speed": 2.0,
        },
        blocking=True,
    )
    assert start_session_mock.call_count == 2

    _ = await hass.services.async_call(
        DOMAIN,
        SERVICE_STOP,
        {"entity_id": ["media_player.speaker"]},
        blocking=True,
    )
    assert tracker.get_active_session("media_player.speaker") is None

    await async_unload_services(hass)
