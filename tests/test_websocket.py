"""Unit tests for WebSocket API endpoints."""

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

from custom_components.abstp_controller.api import (
    AbstpApiClient,
    InProgressItem,
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
    build_library_data,
)


async def test_build_library_data_serializes_in_progress_and_sessions(
    hass: HomeAssistant,
) -> None:
    """Test card updates contain authoritative ABS progress and live sessions."""
    client = AsyncMock(spec=AbstpApiClient)
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.data = AbstpData(
        healthy=True,
        books=[],
        podcasts=[],
        in_progress=[
            InProgressItem(
                id="book_1",
                title="Book One",
                author="Author",
                media_type="book",
                current_time=300.0,
                duration=1000.0,
                progress=300.0,
            )
        ],
    )
    tracker = SessionTracker(hass, client)
    tracker.register_session(
        entity_id="media_player.speaker",
        session_id="session_1",
        item_id="book_1",
        episode_id=None,
        speed=1.0,
        initial_position=300.0,
    )
    hass.data[DOMAIN] = {
        "test_entry": {
            "coordinator": coordinator,
            "tracker": tracker,
        }
    }

    data = build_library_data(hass, coordinator)

    assert data["in_progress"] == [
        {
            "id": "book_1",
            "title": "Book One",
            "author": "Author",
            "media_type": "book",
            "cover_url": "",
            "duration": 1000.0,
            "progress": 300.0,
            "current_time": 300.0,
            "episode_id": None,
            "episode_title": None,
            "narrator": None,
        }
    ]
    active_sessions = data["active_sessions"]
    assert isinstance(active_sessions, dict)
    assert active_sessions["media_player.speaker"]["item_id"] == "book_1"
    _ = await tracker.async_stop_session_for_entity("media_player.speaker")


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
                narrator="George Guidall",
                duration=36000.0,
                progress=0.0,
            )
        ],
        podcasts=[],
        in_progress=[],
    )
    tracker = SessionTracker(hass, client)

    hass.data[DOMAIN] = {
        "test_entry": {
            "coordinator": coordinator,
            "tracker": tracker,
        }
    }

    async_register_websocket_handlers(hass)
