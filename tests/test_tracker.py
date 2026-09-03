"""Unit tests for SessionTracker."""

from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

from custom_components.abstp_controller.api import AbstpApiClient
from custom_components.abstp_controller.tracker import SessionTracker


async def test_session_tracker_lifecycle(hass: HomeAssistant) -> None:
    """Test session registration, position estimation, and stopping."""
    client = AsyncMock(spec=AbstpApiClient)
    client.async_stop_session = AsyncMock(return_value=True)

    tracker = SessionTracker(hass, client)
    entity_id = "media_player.living_room_speaker"

    tracker.register_session(
        entity_id=entity_id,
        session_id="sess_123",
        item_id="book_1",
        episode_id=None,
        speed=1.5,
        initial_position=100.0,
    )

    active = tracker.get_active_session(entity_id)
    assert active is not None
    assert active.session_id == "sess_123"
    assert active.speed == 1.5

    pos = tracker.estimate_current_position(entity_id)
    assert pos >= 100.0

    all_sessions = tracker.get_all_active_sessions()
    assert len(all_sessions) == 1

    success = await tracker.async_stop_session_for_entity(entity_id)
    assert success is True
    assert tracker.get_active_session(entity_id) is None
    stop_mock = cast("AsyncMock", client.async_stop_session)
    stop_mock.assert_called_once_with("sess_123")


async def test_session_tracker_stop_by_id(hass: HomeAssistant) -> None:
    """Test stopping session by proxy session identifier."""
    client = AsyncMock(spec=AbstpApiClient)
    client.async_stop_session = AsyncMock(return_value=True)

    tracker = SessionTracker(hass, client)
    entity_id = "media_player.bedroom_speaker"

    tracker.register_session(
        entity_id=entity_id,
        session_id="sess_456",
        item_id="book_2",
        episode_id=None,
        speed=1.0,
        initial_position=0.0,
    )

    success = await tracker.async_stop_session_by_id("sess_456")
    assert success is True
    assert tracker.get_active_session(entity_id) is None


async def test_session_tracker_stop_all(hass: HomeAssistant) -> None:
    """Test stopping all active sessions upon integration shutdown."""
    client = AsyncMock(spec=AbstpApiClient)
    client.async_stop_session = AsyncMock(return_value=True)

    tracker = SessionTracker(hass, client)
    tracker.register_session(
        entity_id="media_player.speaker_1",
        session_id="sess_1",
        item_id="book_1",
        episode_id=None,
        speed=1.0,
        initial_position=0.0,
    )
    tracker.register_session(
        entity_id="media_player.speaker_2",
        session_id="sess_2",
        item_id="book_2",
        episode_id=None,
        speed=1.0,
        initial_position=0.0,
    )

    await tracker.async_stop_all()
    assert len(tracker.get_all_active_sessions()) == 0
    stop_mock = cast("AsyncMock", client.async_stop_session)
    assert stop_mock.call_count == 2
