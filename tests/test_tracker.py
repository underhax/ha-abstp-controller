"""Unit tests for SessionTracker."""

from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant, ServiceCall

from homeassistant.const import ATTR_ENTITY_ID, STATE_IDLE, STATE_PAUSED, STATE_PLAYING

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


async def test_session_tracker_pause_triggers_stop(hass: HomeAssistant) -> None:
    """Test target pause triggers stop service and terminates session."""
    client = AsyncMock(spec=AbstpApiClient)
    client.async_stop_session = AsyncMock(return_value=True)

    stop_calls: list[ServiceCall] = []

    async def _mock_stop(call: ServiceCall) -> None:
        stop_calls.append(call)

    hass.services.async_register("media_player", "media_stop", _mock_stop)

    entity_id = "media_player.station"
    hass.states.async_set(entity_id, STATE_IDLE)

    tracker = SessionTracker(hass, client)
    tracker.register_session(
        entity_id=entity_id,
        session_id="sess_pause",
        item_id="book_pause",
        episode_id=None,
        speed=1.0,
        initial_position=0.0,
    )

    hass.states.async_set(entity_id, STATE_PAUSED)
    await hass.async_block_till_done()
    assert tracker.get_active_session(entity_id) is not None
    assert len(stop_calls) == 0

    hass.states.async_set(entity_id, STATE_PLAYING)
    await hass.async_block_till_done()
    assert tracker.get_active_session(entity_id) is not None

    hass.states.async_set(entity_id, STATE_PAUSED)
    await hass.async_block_till_done()

    assert tracker.get_active_session(entity_id) is None
    assert len(stop_calls) == 1
    assert stop_calls[0].data.get(ATTR_ENTITY_ID) == entity_id
    cast("AsyncMock", client.async_stop_session).assert_called_once_with("sess_pause")
