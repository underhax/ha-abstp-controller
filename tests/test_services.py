"""Unit tests for abstp custom services."""

import logging
from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import voluptuous as vol
from homeassistant.components.media_player.const import MediaPlayerEntityFeature
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.network import NoURLAvailableError

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant, ServiceCall

from custom_components.abstp_controller.api import (
    AbstpApiClient,
    InProgressItem,
    MediaItem,
    PlaySession,
)
from custom_components.abstp_controller.const import (
    ATTR_SESSION_ID,
    ATTR_TARGET_PLAYER,
    CONF_DEFAULT_SPEED,
    CONF_STREAM_PROXY_MODE,
    DOMAIN,
    SERVICE_PLAY,
    SERVICE_REFRESH_LIBRARY,
    SERVICE_SET_SPEED,
    SERVICE_STOP,
    STREAM_PROXY_MODE_ALWAYS,
    STREAM_PROXY_MODE_AUTO,
    STREAM_PROXY_MODE_NEVER,
)
from custom_components.abstp_controller.coordinator import (
    AbstpData,
    AbstpDataUpdateCoordinator,
)
from custom_components.abstp_controller.services import (
    PLAY_SCHEMA,
    async_setup_services,
    async_unload_services,
    build_play_media_service_data,
    clean_header_value,
    is_loopback_url,
    resolve_media_metadata,
    resolve_proxied_stream_url,
    resolve_stream_proxy_mode,
    should_proxy_stream,
)
from custom_components.abstp_controller.tracker import SessionTracker


@pytest.mark.parametrize(
    ("input_value", "expected"),
    [
        (None, ""),
        ("", ""),
        ("   ", ""),
        ("Hello\r\nWorld", "Hello World"),
        ("  Multiple   Spaces  \t Tab  ", "Multiple Spaces Tab"),
    ],
)
def test_clean_header_value(input_value: str | None, expected: str) -> None:
    """Test whitespace collapsing and control character normalization."""
    assert clean_header_value(input_value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("media_player.speaker", ("media_player.speaker",)),
        (
            ["media_player.speaker", "media_player.living_room"],
            ("media_player.speaker", "media_player.living_room"),
        ),
    ],
)
def test_play_schema_normalizes_entity_ids(
    value: object, expected: tuple[str, ...]
) -> None:
    """Test play service schema normalizes entity identifiers."""
    normalized = cast(
        "dict[str, object]", PLAY_SCHEMA({"entity_id": value, "item_id": "book_1"})
    )
    assert tuple(cast("list[str]", normalized["entity_id"])) == expected


async def test_play_schema_rejects_unsupported_entity_ids_type(
    hass: HomeAssistant,
) -> None:
    """Test play service schema rejects unsupported entity id types."""
    await async_setup_services(hass)
    with pytest.raises(vol.Invalid):
        _ = await hass.services.async_call(
            DOMAIN,
            SERVICE_PLAY,
            {"entity_id": 42, "item_id": "book_1"},
            blocking=True,
        )
    await async_unload_services(hass)


@pytest.mark.parametrize(
    "url",
    [
        "http://[::1",
        "file:///etc/hosts",
    ],
)
def test_is_loopback_url_false_without_resolvable_hostname(url: str) -> None:
    """Test loopback detection does not crash on unusual URLs."""
    assert is_loopback_url(url) is False


@pytest.mark.parametrize(
    (
        "item_id",
        "episode_id",
        "data_fixture",
        "expected_title",
        "expected_artist",
        "expected_has_cover",
    ),
    [
        (
            "b_full",
            None,
            AbstpData(
                healthy=True,
                books=[
                    MediaItem(
                        id="b_full",
                        title="Dune",
                        author="Frank Herbert",
                        narrator="George Guidall",
                        media_type="book",
                        cover_url="http://example.com/cover.jpg",
                    )
                ],
                podcasts=[],
            ),
            "Dune • Frank Herbert",
            "George Guidall",
            True,
        ),
        (
            "b_narrator_only",
            None,
            AbstpData(
                healthy=True,
                books=[
                    MediaItem(
                        id="b_narrator_only",
                        title="Odyssey",
                        author="",
                        narrator="Homer Narrator",
                        media_type="book",
                        cover_url=None,
                    )
                ],
                podcasts=[],
            ),
            "Odyssey",
            "Homer Narrator",
            False,
        ),
        (
            "b_author_only",
            None,
            AbstpData(
                healthy=True,
                books=[
                    MediaItem(
                        id="b_author_only",
                        title="",
                        author="Leo Tolstoy",
                        narrator=None,
                        media_type="book",
                        cover_url=None,
                    )
                ],
                podcasts=[],
            ),
            "Leo Tolstoy",
            "",
            False,
        ),
        (
            "b_title_only",
            None,
            AbstpData(
                healthy=True,
                books=[
                    MediaItem(
                        id="b_title_only",
                        title="Solo Book",
                        author="",
                        narrator=None,
                        media_type="book",
                        cover_url=None,
                    )
                ],
                podcasts=[],
            ),
            "Solo Book",
            "",
            False,
        ),
        (
            "b_empty",
            None,
            AbstpData(
                healthy=True,
                books=[
                    MediaItem(
                        id="b_empty",
                        title="",
                        author="",
                        narrator=None,
                        media_type="book",
                        cover_url=None,
                    )
                ],
                podcasts=[],
            ),
            "Audiobook",
            "",
            False,
        ),
        (
            "pod_ep_full",
            "ep_1",
            AbstpData(
                healthy=True,
                books=[],
                podcasts=[],
                in_progress=[
                    InProgressItem(
                        id="pod_ep_full",
                        title="Tech Cast",
                        author="Host Team",
                        media_type="podcast",
                        current_time=10.0,
                        duration=100.0,
                        progress=0.1,
                        episode_id="ep_1",
                        episode_title="Episode 1: Launch",
                        cover_url="http://example.com/pod.jpg",
                    )
                ],
            ),
            "Episode 1: Launch",
            "Tech Cast",
            True,
        ),
        (
            "pod_no_ep",
            None,
            AbstpData(
                healthy=True,
                books=[],
                podcasts=[
                    MediaItem(
                        id="pod_no_ep",
                        title="Tech News",
                        author="News Anchor",
                        media_type="podcast",
                        cover_url=None,
                    )
                ],
            ),
            "Tech News",
            "News Anchor",
            False,
        ),
        (
            "pod_empty_titles",
            "ep_unknown",
            AbstpData(
                healthy=True,
                books=[],
                podcasts=[
                    MediaItem(
                        id="pod_empty_titles",
                        title="",
                        author="",
                        media_type="podcast",
                        cover_url=None,
                    )
                ],
            ),
            "Podcast Episode",
            "",
            False,
        ),
    ],
)
def test_resolve_media_metadata(
    hass: HomeAssistant,
    item_id: str,
    episode_id: str | None,
    data_fixture: AbstpData,
    expected_title: str,
    expected_artist: str,
    expected_has_cover: bool,
) -> None:
    """Test resolution of metadata across books, podcasts, and fallbacks."""
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.data = data_fixture

    with patch(
        "custom_components.abstp_controller.services.get_url",
        return_value="http://example.com",
    ):
        title, artist, cover_url = resolve_media_metadata(
            hass, coordinator, item_id, episode_id
        )

    assert title == expected_title
    assert artist == expected_artist
    if expected_has_cover:
        assert cover_url == f"http://example.com/api/abstp_controller/cover/{item_id}"
    else:
        assert cover_url is None


def test_resolve_media_metadata_network_fallback(hass: HomeAssistant) -> None:
    """Test falling back to relative cover path when network get_url raises error."""
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.data = AbstpData(
        healthy=True,
        books=[
            MediaItem(
                id="book_cover",
                title="Book Title",
                author="Author",
                media_type="book",
                cover_url="cover.jpg",
            )
        ],
        podcasts=[],
    )

    with patch(
        "custom_components.abstp_controller.services.get_url",
        side_effect=NoURLAvailableError,
    ):
        _, _, cover_url = resolve_media_metadata(hass, coordinator, "book_cover")

    assert cover_url == "/api/abstp_controller/cover/book_cover"


def test_build_play_media_service_data(hass: HomeAssistant) -> None:
    """Test construction of play_media service payload with full metadata."""
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.data = AbstpData(
        healthy=True,
        books=[
            MediaItem(
                id="item_42",
                title="Foundation",
                author="Isaac Asimov",
                narrator="Scott Brick",
                media_type="book",
                cover_url="cover.jpg",
            )
        ],
        podcasts=[],
    )

    with patch(
        "custom_components.abstp_controller.services.get_url",
        return_value="http://example.com",
    ):
        payload = build_play_media_service_data(
            hass=hass,
            coordinator=coordinator,
            entity_id="media_player.living_room",
            stream_url="http://example.com/stream/42.aac",
            item_id="item_42",
        )

    assert payload["entity_id"] == "media_player.living_room"
    assert payload["media_content_id"] == "http://example.com/stream/42.aac"
    assert payload["media_content_type"] == "audio/aac"

    extra = cast("dict[str, object]", payload["extra"])
    assert extra["title"] == "Foundation • Isaac Asimov"
    assert "artist" not in extra
    assert extra["thumb"] == "http://example.com/api/abstp_controller/cover/item_42"

    metadata = cast("dict[str, object]", extra["metadata"])
    assert metadata["metadataType"] == 0
    assert metadata["title"] == "Foundation • Isaac Asimov"
    assert metadata["subtitle"] == "Scott Brick"
    assert metadata["artist"] == "Scott Brick"
    assert metadata["images"] == [
        {"url": "http://example.com/api/abstp_controller/cover/item_42"}
    ]


async def test_services_play_and_stop(hass: HomeAssistant) -> None:
    """Test play, set_speed, and stop service executions with metadata checks."""
    client = AsyncMock(spec=AbstpApiClient)
    client.base_url = "http://127.0.0.1:8099"
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
    config_entry.options = {
        CONF_DEFAULT_SPEED: 1.25,
        CONF_STREAM_PROXY_MODE: STREAM_PROXY_MODE_AUTO,
    }
    config_entry.data = {CONF_DEFAULT_SPEED: 1.25}

    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.config_entry = config_entry
    coordinator.data = AbstpData(
        healthy=True,
        books=[
            MediaItem(
                id="book_1",
                title="The Hobbit",
                author="J.R.R. Tolkien",
                narrator="Rob Inglis",
                media_type="book",
                cover_url="cover.jpg",
            )
        ],
        podcasts=[],
    )

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

    play_media_mock = AsyncMock()
    media_stop_mock = AsyncMock()
    hass.services.async_register("media_player", "play_media", play_media_mock)
    hass.services.async_register("media_player", "media_stop", media_stop_mock)

    with patch(
        "custom_components.abstp_controller.services.get_url",
        return_value="http://example.com",
    ):
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
    assert (
        tracker.get_stream_url("sess_123")
        == "http://abstp.example.com:8099/stream/sess_123.aac"
    )

    play_call = cast("ServiceCall", play_media_mock.call_args[0][0])
    assert play_call.data["entity_id"] == "media_player.speaker"
    token = tracker.get_stream_token("sess_123")
    assert (
        play_call.data["media_content_id"]
        == f"http://example.com/api/abstp_controller/stream/sess_123.aac?token={token}"
    )
    assert play_call.data["media_content_type"] == "audio/aac"
    play_extra = cast("dict[str, object]", play_call.data["extra"])
    assert play_extra["title"] == "The Hobbit • J.R.R. Tolkien"
    play_metadata = cast("dict[str, object]", play_extra["metadata"])
    assert play_metadata["artist"] == "Rob Inglis"
    assert play_extra["thumb"] == "http://example.com/api/abstp_controller/cover/book_1"

    with (
        patch(
            "custom_components.abstp_controller.services.get_url",
            return_value="http://example.com",
        ),
        patch.object(client, "async_stop_session", return_value=True),
    ):
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
    speed_call = cast("ServiceCall", play_media_mock.call_args[0][0])
    speed_token = tracker.get_stream_token("sess_123")
    assert (
        speed_call.data["media_content_id"]
        == f"http://example.com/api/abstp_controller/stream/sess_123.aac?token={speed_token}"
    )
    speed_extra = cast("dict[str, object]", speed_call.data["extra"])
    assert speed_extra["title"] == "The Hobbit • J.R.R. Tolkien"

    _ = await hass.services.async_call(
        DOMAIN,
        SERVICE_STOP,
        {"entity_id": ["media_player.speaker"]},
        blocking=True,
    )
    assert tracker.get_active_session("media_player.speaker") is None
    assert tracker.get_stream_url("sess_123") is None

    await async_unload_services(hass)


async def test_services_play_uses_direct_stream_by_default(
    hass: HomeAssistant,
) -> None:
    """Test remote abstp streams bypass Home Assistant in the default auto mode."""
    client = AsyncMock(spec=AbstpApiClient)
    client.base_url = "https://abstp.example.com"
    client.async_start_session = AsyncMock(
        return_value=PlaySession(
            session_id="sess_direct",
            stream_url="https://abstp.example.com/stream/sess_direct.aac",
            current_time=0.0,
            duration=3600.0,
        )
    )
    config_entry = MagicMock(spec=ConfigEntry)
    config_entry.options = {}
    config_entry.data = {}
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.config_entry = config_entry
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])
    tracker = SessionTracker(hass, client)
    hass.data[DOMAIN] = {
        "test_entry_id": {"coordinator": coordinator, "tracker": tracker}
    }
    await async_setup_services(hass)

    play_media_mock = AsyncMock()
    hass.services.async_register("media_player", "play_media", play_media_mock)
    _ = await hass.services.async_call(
        DOMAIN,
        SERVICE_PLAY,
        {"entity_id": ["media_player.speaker"], "item_id": "book_1"},
        blocking=True,
    )

    play_call = cast("ServiceCall", play_media_mock.call_args[0][0])
    assert (
        play_call.data["media_content_id"]
        == "https://abstp.example.com/stream/sess_direct.aac"
    )

    _ = await tracker.async_stop_session_for_entity("media_player.speaker")
    await async_unload_services(hass)


@pytest.mark.parametrize(
    ("proxy_mode", "backend_url", "target_entity_id", "expected"),
    [
        (
            STREAM_PROXY_MODE_ALWAYS,
            "http://abstp.example.com:8099",
            "media_player.speaker",
            True,
        ),
        (
            STREAM_PROXY_MODE_NEVER,
            "http://127.0.0.1:8099",
            "media_player.speaker",
            False,
        ),
        (STREAM_PROXY_MODE_AUTO, "http://127.0.0.1:8099", "media_player.speaker", True),
        (
            STREAM_PROXY_MODE_AUTO,
            "http://127.0.0.42:8099",
            "media_player.speaker",
            True,
        ),
        (STREAM_PROXY_MODE_AUTO, "http://localhost:8099", "media_player.speaker", True),
        (STREAM_PROXY_MODE_AUTO, "http://[::1]:8099", "media_player.speaker", True),
        (
            STREAM_PROXY_MODE_AUTO,
            "https://abstp.example.com",
            "media_player.speaker",
            False,
        ),
        (
            STREAM_PROXY_MODE_AUTO,
            "http://192.0.2.1:8099",
            "media_player.speaker",
            False,
        ),
        (
            STREAM_PROXY_MODE_AUTO,
            "http://127.0.0.1:8099",
            "media_player.yandex_station_living_room",
            False,
        ),
    ],
)
def test_should_proxy_stream(
    proxy_mode: str,
    backend_url: str,
    target_entity_id: str,
    expected: bool,
) -> None:
    """Test stream routing for configured modes, local hosts, and Yandex Station."""
    assert should_proxy_stream(proxy_mode, backend_url, target_entity_id) is expected


@pytest.mark.parametrize(
    ("options", "data", "expected"),
    [
        ({}, {}, STREAM_PROXY_MODE_AUTO),
        (
            {CONF_STREAM_PROXY_MODE: STREAM_PROXY_MODE_ALWAYS},
            {},
            STREAM_PROXY_MODE_ALWAYS,
        ),
        (
            {},
            {CONF_STREAM_PROXY_MODE: STREAM_PROXY_MODE_NEVER},
            STREAM_PROXY_MODE_NEVER,
        ),
        ({CONF_STREAM_PROXY_MODE: "unsupported"}, {}, STREAM_PROXY_MODE_AUTO),
    ],
)
def test_resolve_stream_proxy_mode(
    options: dict[str, object], data: dict[str, object], expected: str
) -> None:
    """Test mode selection retains compatibility with legacy configuration entries."""
    assert resolve_stream_proxy_mode(options, data) == expected


@pytest.mark.parametrize(
    ("mock_base_url", "expected_url"),
    [
        (
            "http://example.com",
            "http://example.com/api/abstp_controller/stream/sess_abc.aac",
        ),
        (
            None,
            "/api/abstp_controller/stream/sess_abc.aac",
        ),
    ],
)
def test_resolve_proxied_stream_url(
    hass: HomeAssistant,
    mock_base_url: str | None,
    expected_url: str,
) -> None:
    """Test resolution of stream proxy URL with and without base URL availability."""
    if mock_base_url is not None:
        with patch(
            "custom_components.abstp_controller.services.get_url",
            return_value=mock_base_url,
        ):
            assert resolve_proxied_stream_url(hass, "sess_abc") == expected_url
    else:
        with patch(
            "custom_components.abstp_controller.services.get_url",
            side_effect=NoURLAvailableError,
        ):
            assert resolve_proxied_stream_url(hass, "sess_abc") == expected_url


@pytest.mark.parametrize(
    ("supported_features", "expected_service"),
    [
        (MediaPlayerEntityFeature.STOP, "media_stop"),
        (
            MediaPlayerEntityFeature.STOP | MediaPlayerEntityFeature.PAUSE,
            "media_stop",
        ),
        (MediaPlayerEntityFeature.PAUSE, "media_pause"),
        (MediaPlayerEntityFeature.VOLUME_SET, None),
    ],
)
async def test_services_stop_feature_fallback(
    hass: HomeAssistant,
    supported_features: int,
    expected_service: str | None,
) -> None:
    """Test handle_stop selects stop or pause based on features."""
    client = AsyncMock(spec=AbstpApiClient)
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    tracker = SessionTracker(hass, client)

    hass.data[DOMAIN] = {
        "test_entry_id": {
            "coordinator": coordinator,
            "tracker": tracker,
        }
    }

    await async_setup_services(hass)

    hass.states.async_set(
        "media_player.target_device",
        "playing",
        {"supported_features": supported_features},
    )

    media_stop_mock = AsyncMock()
    media_pause_mock = AsyncMock()
    hass.services.async_register("media_player", "media_stop", media_stop_mock)
    hass.services.async_register("media_player", "media_pause", media_pause_mock)

    _ = await hass.services.async_call(
        DOMAIN,
        SERVICE_STOP,
        {"entity_id": ["media_player.target_device"]},
        blocking=True,
    )

    if expected_service == "media_stop":
        media_stop_mock.assert_called_once()
        media_pause_mock.assert_not_called()
    elif expected_service == "media_pause":
        media_stop_mock.assert_not_called()
        media_pause_mock.assert_called_once()
    else:
        media_stop_mock.assert_not_called()
        media_pause_mock.assert_not_called()

    await async_unload_services(hass)


async def test_services_log_missing_entries_on_play(
    hass: HomeAssistant,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Test play service reports when no active integration entries are loaded."""
    hass.data[DOMAIN] = {}
    await async_setup_services(hass)

    with caplog.at_level(logging.ERROR, logger="custom_components.abstp_controller"):
        _ = await hass.services.async_call(
            DOMAIN,
            SERVICE_PLAY,
            {"entity_id": ["media_player.speaker"], "item_id": "book_1"},
            blocking=True,
        )

    assert "No active abstp integration entries loaded" in caplog.text
    await async_unload_services(hass)


async def test_services_log_missing_entry_components_on_play(
    hass: HomeAssistant,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Test play service reports when entry data lacks coordinator and tracker."""
    hass.data[DOMAIN] = {"test_entry_id": "not-a-dict"}
    await async_setup_services(hass)

    with caplog.at_level(logging.ERROR, logger="custom_components.abstp_controller"):
        _ = await hass.services.async_call(
            DOMAIN,
            SERVICE_PLAY,
            {"entity_id": ["media_player.speaker"], "item_id": "book_1"},
            blocking=True,
        )

    assert "No active abstp integration entries loaded" in caplog.text
    await async_unload_services(hass)


async def test_services_return_when_no_active_entry_components(
    hass: HomeAssistant,
) -> None:
    """Test stop and set_speed services no-op without active entry components."""
    hass.data[DOMAIN] = {}
    await async_setup_services(hass)

    _ = await hass.services.async_call(
        DOMAIN,
        SERVICE_STOP,
        {"entity_id": ["media_player.speaker"]},
        blocking=True,
    )
    _ = await hass.services.async_call(
        DOMAIN,
        SERVICE_SET_SPEED,
        {"entity_id": "media_player.speaker", "speed": 1.5},
        blocking=True,
    )

    assert hass.services.has_service(DOMAIN, SERVICE_STOP)
    assert hass.services.has_service(DOMAIN, SERVICE_SET_SPEED)
    await async_unload_services(hass)


async def test_services_play_resolves_target_player_from_state(
    hass: HomeAssistant,
) -> None:
    """Test play service forwards playback to the resolved target player."""
    client = AsyncMock(spec=AbstpApiClient)
    client.base_url = "https://abstp.example.com"
    client.async_start_session = AsyncMock(
        return_value=PlaySession(
            session_id="sess_target",
            stream_url="https://abstp.example.com/stream/sess_target.aac",
            current_time=0.0,
            duration=3600.0,
        )
    )
    config_entry = MagicMock(spec=ConfigEntry)
    config_entry.options = {}
    config_entry.data = {}
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.config_entry = config_entry
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])
    tracker = SessionTracker(hass, client)
    hass.data[DOMAIN] = {
        "test_entry_id": {"coordinator": coordinator, "tracker": tracker}
    }
    await async_setup_services(hass)

    play_media_mock = AsyncMock()
    hass.services.async_register("media_player", "play_media", play_media_mock)
    hass.states.async_set(
        "media_player.virtual_bedroom",
        "playing",
        {ATTR_TARGET_PLAYER: "media_player.bedroom"},
    )

    _ = await hass.services.async_call(
        DOMAIN,
        SERVICE_PLAY,
        {
            "entity_id": ["media_player.virtual_bedroom"],
            "item_id": "book_1",
        },
        blocking=True,
    )

    play_call = cast("ServiceCall", play_media_mock.call_args[0][0])
    assert play_call.data["entity_id"] == "media_player.bedroom"
    assert tracker.get_active_session("media_player.bedroom") is not None

    _ = await tracker.async_stop_session_for_entity("media_player.bedroom")
    await async_unload_services(hass)


async def test_services_play_stops_existing_active_session(
    hass: HomeAssistant,
) -> None:
    """Test play service stops an existing session for the same target."""
    client = AsyncMock(spec=AbstpApiClient)
    client.base_url = "https://abstp.example.com"
    client.async_start_session = AsyncMock(
        return_value=PlaySession(
            session_id="sess_new",
            stream_url="https://abstp.example.com/stream/sess_new.aac",
            current_time=0.0,
            duration=3600.0,
        )
    )
    config_entry = MagicMock(spec=ConfigEntry)
    config_entry.options = {}
    config_entry.data = {}
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.config_entry = config_entry
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])
    tracker = SessionTracker(hass, client)
    tracker.register_session(
        entity_id="media_player.speaker",
        session_id="sess_old",
        item_id="book_1",
        episode_id=None,
        speed=1.0,
        initial_position=10.0,
    )
    hass.data[DOMAIN] = {
        "test_entry_id": {"coordinator": coordinator, "tracker": tracker}
    }
    await async_setup_services(hass)

    play_media_mock = AsyncMock()
    media_stop_mock = AsyncMock()
    hass.services.async_register("media_player", "play_media", play_media_mock)
    hass.services.async_register("media_player", "media_stop", media_stop_mock)
    hass.states.async_set("media_player.speaker", "playing")

    _ = await hass.services.async_call(
        DOMAIN,
        SERVICE_PLAY,
        {"entity_id": ["media_player.speaker"], "item_id": "book_1"},
        blocking=True,
    )
    await hass.async_block_till_done()

    media_stop_mock.assert_called()
    active_session = tracker.get_active_session("media_player.speaker")
    assert active_session is not None
    assert active_session.session_id == "sess_new"
    assert active_session.item_id == "book_1"

    _ = await tracker.async_stop_session_for_entity("media_player.speaker")
    await async_unload_services(hass)


async def test_services_play_warns_when_stopping_existing_session_fails(
    hass: HomeAssistant,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Test play service logs a warning when stopping the old session fails."""
    client = AsyncMock(spec=AbstpApiClient)
    client.base_url = "https://abstp.example.com"
    client.async_start_session = AsyncMock(
        return_value=PlaySession(
            session_id="sess_new_fail",
            stream_url="https://abstp.example.com/stream/sess_new_fail.aac",
            current_time=0.0,
            duration=3600.0,
        )
    )
    config_entry = MagicMock(spec=ConfigEntry)
    config_entry.options = {}
    config_entry.data = {}
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.config_entry = config_entry
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])
    tracker = SessionTracker(hass, client)
    tracker.register_session(
        entity_id="media_player.speaker",
        session_id="sess_old_fail",
        item_id="book_1",
        episode_id=None,
        speed=1.0,
        initial_position=10.0,
    )
    hass.data[DOMAIN] = {
        "test_entry_id": {"coordinator": coordinator, "tracker": tracker}
    }
    await async_setup_services(hass)

    play_media_mock = AsyncMock()
    hass.services.async_register("media_player", "play_media", play_media_mock)
    hass.states.async_set("media_player.speaker", "playing")

    with caplog.at_level(logging.WARNING, logger="custom_components.abstp_controller"):
        _ = await hass.services.async_call(
            DOMAIN,
            SERVICE_PLAY,
            {"entity_id": ["media_player.speaker"], "item_id": "book_1"},
            blocking=True,
        )
        await hass.async_block_till_done()

    assert "Failed to stop target media_player.speaker" in caplog.text
    assert tracker.get_active_session("media_player.speaker") is not None

    _ = await tracker.async_stop_session_for_entity("media_player.speaker")
    await async_unload_services(hass)


async def test_services_stop_resolves_target_player_from_state(
    hass: HomeAssistant,
) -> None:
    """Test stop service terminates the resolved target player session."""
    client = AsyncMock(spec=AbstpApiClient)
    client.async_stop_session = AsyncMock(return_value=True)
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    tracker = SessionTracker(hass, client)
    tracker.register_session(
        entity_id="media_player.bedroom",
        session_id="sess_target_stop",
        item_id="book_1",
        episode_id=None,
        speed=1.0,
        initial_position=20.0,
    )
    hass.data[DOMAIN] = {
        "test_entry_id": {"coordinator": coordinator, "tracker": tracker}
    }
    await async_setup_services(hass)

    hass.states.async_set(
        "media_player.virtual_bedroom",
        "playing",
        {
            ATTR_TARGET_PLAYER: "media_player.bedroom",
            "supported_features": int(MediaPlayerEntityFeature.STOP),
        },
    )
    hass.states.async_set(
        "media_player.bedroom",
        "playing",
        {"supported_features": int(MediaPlayerEntityFeature.STOP)},
    )
    media_stop_mock = AsyncMock()
    hass.services.async_register("media_player", "media_stop", media_stop_mock)

    _ = await hass.services.async_call(
        DOMAIN,
        SERVICE_STOP,
        {"entity_id": ["media_player.virtual_bedroom"]},
        blocking=True,
    )
    await hass.async_block_till_done()

    assert tracker.get_active_session("media_player.bedroom") is None
    assert (
        cast("ServiceCall", media_stop_mock.call_args[0][0]).data["entity_id"]
        == "media_player.bedroom"
    )
    await async_unload_services(hass)


async def test_services_stop_by_session_id(hass: HomeAssistant) -> None:
    """Test stop service terminates a session by proxy session identifier."""
    client = AsyncMock(spec=AbstpApiClient)
    client.async_stop_session = AsyncMock(return_value=True)
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    tracker = SessionTracker(hass, client)
    tracker.register_session(
        entity_id="media_player.speaker",
        session_id="sess_by_id",
        item_id="book_1",
        episode_id=None,
        speed=1.0,
        initial_position=30.0,
    )
    hass.data[DOMAIN] = {
        "test_entry_id": {"coordinator": coordinator, "tracker": tracker}
    }
    await async_setup_services(hass)

    _ = await hass.services.async_call(
        DOMAIN,
        SERVICE_STOP,
        {ATTR_SESSION_ID: "sess_by_id"},
        blocking=True,
    )

    assert tracker.get_active_session("media_player.speaker") is None
    cast("AsyncMock", client.async_stop_session).assert_awaited()
    await async_unload_services(hass)


async def test_services_set_speed_without_active_session_logs_warning(
    hass: HomeAssistant,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Test set_speed service warns when no active session exists."""
    client = AsyncMock(spec=AbstpApiClient)
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    tracker = SessionTracker(hass, client)
    hass.data[DOMAIN] = {
        "test_entry_id": {"coordinator": coordinator, "tracker": tracker}
    }
    await async_setup_services(hass)

    with caplog.at_level(logging.WARNING, logger="custom_components.abstp_controller"):
        _ = await hass.services.async_call(
            DOMAIN,
            SERVICE_SET_SPEED,
            {"entity_id": "media_player.speaker", "speed": 1.5},
            blocking=True,
        )

    assert "No active session found for entity media_player.speaker" in caplog.text
    await async_unload_services(hass)


async def test_services_refresh_library_requests_coordinator_refresh(
    hass: HomeAssistant,
) -> None:
    """Test refresh_library service triggers coordinator refresh for each entry."""
    coordinator = AsyncMock(spec=AbstpDataUpdateCoordinator)
    refresh_mock = cast("AsyncMock", coordinator.async_request_refresh)
    hass.data[DOMAIN] = {
        "test_entry_id": {"coordinator": coordinator},
    }
    await async_setup_services(hass)

    _ = await hass.services.async_call(
        DOMAIN,
        SERVICE_REFRESH_LIBRARY,
        {},
        blocking=True,
    )
    await hass.async_block_till_done()

    refresh_mock.assert_awaited()
    await async_unload_services(hass)
