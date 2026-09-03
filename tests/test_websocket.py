"""Unit tests for WebSocket API endpoints."""

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

from custom_components.abstp_controller.api import (
    AbstpApiClient,
    MediaItem,
)
from custom_components.abstp_controller.const import DOMAIN
from custom_components.abstp_controller.coordinator import (
    AbstpData,
    AbstpDataUpdateCoordinator,
)
from custom_components.abstp_controller.tracker import SessionTracker
from custom_components.abstp_controller.websocket import (
    async_register_websocket_handlers,
)


async def test_websocket_handlers_registration(hass: HomeAssistant) -> None:
    """Test registering websocket command handlers."""
    client = AsyncMock(spec=AbstpApiClient)
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.data = AbstpData(
        healthy=True,
        books=[
            MediaItem(
                id="book_1",
                title="Dune",
                author="Frank Herbert",
                media_type="book",
                cover_url="/api/covers/1",
                duration=36000.0,
                progress=0.0,
            )
        ],
        podcasts=[],
    )
    tracker = SessionTracker(hass, client)

    hass.data[DOMAIN] = {
        "test_entry": {
            "coordinator": coordinator,
            "tracker": tracker,
        }
    }

    async_register_websocket_handlers(hass)
