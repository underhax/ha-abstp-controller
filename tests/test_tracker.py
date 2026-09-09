"""Unit tests for SessionTracker."""

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from homeassistant.core import (
        Event,
        EventStateChangedData,
        HomeAssistant,
        ServiceCall,
    )

from homeassistant.components.media_player.const import MediaPlayerEntityFeature
from homeassistant.const import (
    ATTR_ENTITY_ID,
    STATE_IDLE,
    STATE_PAUSED,
    STATE_PLAYING,
)

from custom_components.abstp_controller.api import AbstpApiClient, AbstpApiError
from custom_components.abstp_controller.tracker import (
    SessionTracker,
    is_allowed_player,
)


class ExposedSessionTracker(SessionTracker):
    """Session tracker exposing the protected state change handler."""

    async def expose_player_state_change(
        self, event: Event[EventStateChangedData]
    ) -> None:
        """Forward a player state change event to the tracking logic."""
        await self._handle_player_state_change(event)


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


@pytest.mark.parametrize(
    ("entity_id", "attributes", "expected"),
    [
        ("", {}, False),
        ("fan.living", {}, False),
        ("media_player.abstp_virtual", {}, True),
        ("media_player.yandex_station_intents_1", {}, False),
        ("media_player.unknown_device", {}, True),
        (
            "media_player.radio",
            {"supported_features": int(MediaPlayerEntityFeature.VOLUME_SET)},
            False,
        ),
        (
            "media_player.radio",
            {"supported_features": int(MediaPlayerEntityFeature.PLAY_MEDIA)},
            True,
        ),
    ],
)
def test_is_allowed_player_hass_states(
    hass: HomeAssistant,
    entity_id: str,
    attributes: dict[str, object],
    expected: bool,
) -> None:
    """Test player allow-list checks across entity id and feature variants."""
    if "supported_features" in attributes:
        hass.states.async_set(entity_id, "idle", attributes)
    assert is_allowed_player(hass, entity_id) is expected


async def test_session_tracker_get_session_by_id(hass: HomeAssistant) -> None:
    """Test finding sessions by proxy session identifier."""
    client = AsyncMock(spec=AbstpApiClient)
    client.async_stop_session = AsyncMock(return_value=True)
    tracker = SessionTracker(hass, client)
    tracker.register_session(
        entity_id="media_player.speaker",
        session_id="sess_lookup",
        item_id="book_1",
        episode_id=None,
        speed=1.0,
        initial_position=0.0,
    )

    assert tracker.get_session_by_id("sess_lookup") is not None
    assert tracker.get_session_by_id("sess_missing") is None
    _ = await tracker.async_stop_session_for_entity("media_player.speaker")


async def test_session_tracker_register_and_validate_stream_token(
    hass: HomeAssistant,
) -> None:
    """Test stream token registration and validation behavior."""
    client = AsyncMock(spec=AbstpApiClient)
    tracker = SessionTracker(hass, client)

    tracker.register_stream_token("sess_secure", "secret-token")
    assert tracker.get_stream_token("sess_secure") == "secret-token"
    assert tracker.validate_stream_token("sess_secure", "secret-token") is True
    assert tracker.validate_stream_token("sess_secure", "wrong-token") is False
    assert tracker.validate_stream_token("sess_secure", None) is False
    assert tracker.validate_stream_token("sess_unknown", "secret-token") is False


async def test_session_tracker_estimate_position_without_session(
    hass: HomeAssistant,
) -> None:
    """Test position estimation returns zero for unregistered players."""
    client = AsyncMock(spec=AbstpApiClient)
    tracker = SessionTracker(hass, client)
    assert tracker.estimate_current_position("media_player.ghost") == 0.0
    assert await tracker.async_stop_session_for_entity("media_player.ghost") is False


async def test_session_tracker_startup_timeout_ignores_missing_session(
    hass: HomeAssistant,
) -> None:
    """Test startup timeout returns early when the session is already gone."""
    client = AsyncMock(spec=AbstpApiClient)
    entity_id = "media_player.gone"
    client.async_stop_session = AsyncMock(return_value=True)
    tracker = SessionTracker(hass, client)
    with patch(
        "custom_components.abstp_controller.tracker.async_call_later",
        return_value=MagicMock(),
    ) as async_call_later_mock:
        tracker.register_session(
            entity_id=entity_id,
            session_id="sess_gone",
            item_id="book_1",
            episode_id=None,
            speed=1.0,
            initial_position=0.0,
        )

    timeout_callback = cast(
        "Callable[[datetime], Awaitable[None]]",
        async_call_later_mock.call_args.args[2],
    )
    _ = await tracker.async_stop_session_for_entity(entity_id)
    await timeout_callback(datetime(1970, 1, 1, tzinfo=UTC))
    cast("AsyncMock", client.async_stop_session).assert_called_once()


async def test_session_tracker_ignores_event_for_untracked_entity(
    hass: HomeAssistant,
) -> None:
    """Test state change events for untracked players are ignored."""
    client = AsyncMock(spec=AbstpApiClient)
    client.async_stop_session = AsyncMock(return_value=True)
    tracker = ExposedSessionTracker(hass, client)
    tracker.register_session(
        entity_id="media_player.tracked",
        session_id="sess_tracked",
        item_id="book_1",
        episode_id=None,
        speed=1.0,
        initial_position=0.0,
    )
    event = cast(
        "Event[EventStateChangedData]",
        MagicMock(data={"entity_id": "media_player.other"}),
    )

    await tracker.expose_player_state_change(event)
    assert tracker.get_active_session("media_player.tracked") is not None
    _ = await tracker.async_stop_session_for_entity("media_player.tracked")


async def test_session_tracker_ignores_event_without_new_state(
    hass: HomeAssistant,
) -> None:
    """Test state change events carrying no new state are ignored."""
    client = AsyncMock(spec=AbstpApiClient)
    client.async_stop_session = AsyncMock(return_value=True)
    entity_id = "media_player.removed"
    tracker = SessionTracker(hass, client)
    tracker.register_session(
        entity_id=entity_id,
        session_id="sess_removed",
        item_id="book_1",
        episode_id=None,
        speed=1.0,
        initial_position=0.0,
    )

    hass.states.async_set(entity_id, STATE_IDLE)
    _ = hass.states.async_remove(entity_id)
    await hass.async_block_till_done()
    assert tracker.get_active_session(entity_id) is not None
    _ = await tracker.async_stop_session_for_entity(entity_id)


async def test_session_tracker_awaiting_initial_stop_state_paths(
    hass: HomeAssistant,
) -> None:
    """Test awaiting-initial-stop state transitions keep the session alive."""
    client = AsyncMock(spec=AbstpApiClient)
    client.async_stop_session = AsyncMock(return_value=True)
    entity_id = "media_player.awaiting"
    hass.states.async_set(entity_id, STATE_PLAYING, {"volume": 0.5})
    tracker = SessionTracker(hass, client)
    tracker.register_session(
        entity_id=entity_id,
        session_id="sess_awaiting",
        item_id="book_1",
        episode_id=None,
        speed=1.0,
        initial_position=0.0,
    )
    session = tracker.get_active_session(entity_id)
    assert session is not None
    assert session.awaiting_initial_stop is True

    hass.states.async_set(entity_id, STATE_PLAYING, {"volume": 0.6})
    await hass.async_block_till_done()
    session = tracker.get_active_session(entity_id)
    assert session is not None
    assert session.awaiting_initial_stop is True

    hass.states.async_set(entity_id, STATE_IDLE)
    await hass.async_block_till_done()
    session = tracker.get_active_session(entity_id)
    assert session is not None
    assert session.awaiting_initial_stop is False
    _ = await tracker.async_stop_session_for_entity(entity_id)


async def test_session_tracker_pause_warns_when_media_stop_unavailable(
    hass: HomeAssistant,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Test pause handling warns when media_stop service lookup fails."""
    client = AsyncMock(spec=AbstpApiClient)
    entity_id = "media_player.pause_error"
    hass.states.async_set(entity_id, STATE_IDLE)
    tracker = SessionTracker(hass, client)
    tracker.register_session(
        entity_id=entity_id,
        session_id="sess_pause_error",
        item_id="book_1",
        episode_id=None,
        speed=1.0,
        initial_position=0.0,
    )
    hass.states.async_set(entity_id, STATE_PLAYING)
    await hass.async_block_till_done()

    with caplog.at_level(logging.WARNING, logger="custom_components.abstp_controller"):
        hass.states.async_set(entity_id, STATE_PAUSED)
        await hass.async_block_till_done()

    assert tracker.get_active_session(entity_id) is None
    assert "Failed to send media_stop" in caplog.text


async def test_session_tracker_stop_by_id_unknown_proxy_error(
    hass: HomeAssistant,
) -> None:
    """Test stopping an unknown session surfaces proxy failures as False."""
    client = AsyncMock(spec=AbstpApiClient)
    client.async_stop_session = AsyncMock(
        side_effect=AbstpApiError(
            "HTTP error 500 received from abstp: Server Error", status=500
        )
    )
    tracker = SessionTracker(hass, client)

    success = await tracker.async_stop_session_by_id("sess_unknown")
    assert success is False
    assert tracker.is_backend_terminated("sess_unknown") is False
