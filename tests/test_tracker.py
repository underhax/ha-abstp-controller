"""Unit tests for SessionTracker."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock, patch

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from homeassistant.core import HomeAssistant, ServiceCall

from homeassistant.const import ATTR_ENTITY_ID, STATE_IDLE, STATE_PAUSED, STATE_PLAYING

from custom_components.abstp_controller.api import AbstpApiClient, AbstpApiError
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


async def test_session_tracker_stops_session_when_playback_never_starts(
    hass: HomeAssistant,
) -> None:
    """Test startup expiry releases sessions when the target player remains idle."""
    client = AsyncMock(spec=AbstpApiClient)
    client.async_stop_session = AsyncMock(return_value=True)
    entity_id = "media_player.failed_speaker"
    hass.states.async_set(entity_id, STATE_IDLE)
    tracker = SessionTracker(hass, client)
    with patch(
        "custom_components.abstp_controller.tracker.async_call_later",
        return_value=MagicMock(),
    ) as async_call_later_mock:
        tracker.register_session(
            entity_id=entity_id,
            session_id="sess_failed_start",
            item_id="book_failed_start",
            episode_id=None,
            speed=1.0,
            initial_position=0.0,
        )

    timeout_callback = cast(
        "Callable[[datetime], Awaitable[None]]",
        async_call_later_mock.call_args.args[2],
    )
    await timeout_callback(datetime(1970, 1, 1, tzinfo=UTC))

    assert tracker.get_active_session(entity_id) is None
    cast("AsyncMock", client.async_stop_session).assert_awaited_once_with(
        "sess_failed_start"
    )


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


async def test_session_tracker_stream_urls(hass: HomeAssistant) -> None:
    """Test registering, retrieving, and unregistering stream URLs."""
    client = AsyncMock(spec=AbstpApiClient)
    client.async_stop_session = AsyncMock(return_value=True)
    tracker = SessionTracker(hass, client)

    tracker.register_stream_url(
        "sess_abc", "http://example.com:8099/stream/sess_abc.aac?token=xyz"
    )
    assert (
        tracker.get_stream_url("sess_abc")
        == "http://example.com:8099/stream/sess_abc.aac?token=xyz"
    )
    assert tracker.get_stream_url("non_existent") is None

    tracker.unregister_stream_url("sess_abc")
    assert tracker.get_stream_url("sess_abc") is None

    entity_id = "media_player.kitchen"
    tracker.register_session(
        entity_id=entity_id,
        session_id="sess_def",
        item_id="book_1",
        episode_id=None,
        speed=1.0,
        initial_position=0.0,
        stream_url="http://example.com:8099/stream/sess_def.aac?token=123",
    )
    assert (
        tracker.get_stream_url("sess_def")
        == "http://example.com:8099/stream/sess_def.aac?token=123"
    )

    success = await tracker.async_stop_session_for_entity(entity_id)
    assert success is True
    assert tracker.get_stream_url("sess_def") is None


async def test_session_tracker_stop_after_stream_closed(hass: HomeAssistant) -> None:
    """Test stopping a session after socket disconnect skips proxy stop call."""
    client = AsyncMock(spec=AbstpApiClient)
    tracker = SessionTracker(hass, client)
    entity_id = "media_player.kitchen"

    tracker.register_session(
        entity_id=entity_id,
        session_id="sess_closed",
        item_id="book_1",
        episode_id=None,
        speed=1.0,
        initial_position=0.0,
    )

    tracker.notify_stream_closed("sess_closed")
    assert tracker.is_backend_terminated("sess_closed") is True

    success = await tracker.async_stop_session_for_entity(entity_id)
    assert success is True
    assert tracker.get_active_session(entity_id) is None
    cast("AsyncMock", client.async_stop_session).assert_not_called()

    tracker.notify_stream_closed("sess_unregistered_closed")
    success_by_id = await tracker.async_stop_session_by_id("sess_unregistered_closed")
    assert success_by_id is True
    cast("AsyncMock", client.async_stop_session).assert_not_called()


async def test_session_tracker_stop_error(hass: HomeAssistant) -> None:
    """Test stopping a session when proxy responds with error returns False."""
    client = AsyncMock(spec=AbstpApiClient)
    client.async_stop_session = AsyncMock(
        side_effect=AbstpApiError(
            "HTTP error 500 received from abstp: Server Error", status=500
        )
    )
    tracker = SessionTracker(hass, client)
    entity_id = "media_player.kitchen"

    tracker.register_session(
        entity_id=entity_id,
        session_id="sess_500",
        item_id="book_1",
        episode_id=None,
        speed=1.0,
        initial_position=0.0,
    )

    success = await tracker.async_stop_session_for_entity(entity_id)
    assert success is False
