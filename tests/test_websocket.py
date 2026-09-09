"""Unit tests for WebSocket API endpoints."""

from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock, patch

if TYPE_CHECKING:
    from collections.abc import Callable

    from homeassistant.core import HomeAssistant

from homeassistant.components.websocket_api import DOMAIN as WEBSOCKET_API_DOMAIN
from homeassistant.components.websocket_api.connection import ActiveConnection
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_IDLE

from custom_components.abstp_controller.api import (
    AbstpApiClient,
    AbstpApiError,
    ChapterItem,
    InProgressItem,
    MediaItem,
    PodcastEpisode,
)
from custom_components.abstp_controller.const import CONF_TARGET_PLAYERS, DOMAIN
from custom_components.abstp_controller.coordinator import (
    AbstpData,
    AbstpDataUpdateCoordinator,
)
from custom_components.abstp_controller.preferences import CardPreferenceStore
from custom_components.abstp_controller.tracker import SessionTracker
from custom_components.abstp_controller.websocket import (
    CARD_PREFERENCE_SUBSCRIPTIONS_KEY,
    WS_TYPE_GET_CHAPTERS,
    WS_TYPE_GET_EPISODES,
    WS_TYPE_GET_LIBRARY,
    WS_TYPE_SET_CARD_PREFERENCE,
    WS_TYPE_SUBSCRIBE_CARD_PREFERENCE,
    WS_TYPE_SUBSCRIBE_LIBRARY_UPDATES,
    async_register_websocket_handlers,
    build_library_data,
)


def _get_command_handler(
    hass: HomeAssistant, command_type: str
) -> Callable[[object, object, dict[str, object]], None]:
    """Return the registered websocket command handler for a message type."""
    handlers = cast("dict[str, object]", hass.data[WEBSOCKET_API_DOMAIN])
    command = cast("tuple[object, object]", handlers[command_type])
    return cast("Callable[[object, object, dict[str, object]], None]", command[0])


def _make_connection(
    user_id: str = "user_1",
) -> tuple[MagicMock, dict[int, Callable[[], object]]]:
    """Return a websocket connection mock with real subscription storage."""
    connection = MagicMock(spec=ActiveConnection)
    user_mock = MagicMock()
    user_mock.id = user_id
    connection.user = user_mock
    subscriptions: dict[int, Callable[[], object]] = {}
    connection.subscriptions = cast("object", subscriptions)
    return connection, subscriptions


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


async def test_build_library_data_without_tracker_returns_empty_sessions(
    hass: HomeAssistant,
) -> None:
    """Test library data serialization falls back to empty sessions."""
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.data = AbstpData(
        healthy=True,
        books=[],
        podcasts=[],
        in_progress=[],
    )
    hass.data[DOMAIN] = {}

    data = build_library_data(hass, coordinator)

    assert data["active_sessions"] == {}


async def test_ws_get_library_returns_error_when_not_loaded(
    hass: HomeAssistant,
) -> None:
    """Test get library websocket command reports missing coordinator."""
    async_register_websocket_handlers(hass)
    handler = _get_command_handler(hass, WS_TYPE_GET_LIBRARY)
    connection, _ = _make_connection()

    handler(hass, connection, {"id": 5, "type": WS_TYPE_GET_LIBRARY})
    await hass.async_block_till_done()

    cast("MagicMock", connection.send_error).assert_called_once_with(
        5, "not_loaded", "Integration not ready or loaded"
    )


async def test_ws_get_library_resolves_first_active_coordinator(
    hass: HomeAssistant,
) -> None:
    """Test get library websocket command serves the loaded coordinator."""
    client = AsyncMock(spec=AbstpApiClient)
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.data = AbstpData(
        healthy=True,
        books=[],
        podcasts=[],
        in_progress=[],
    )
    coordinator.async_request_refresh = AsyncMock()
    hass.data[DOMAIN] = {
        "incomplete_entry": {"client": client},
        "active_entry": {"coordinator": coordinator},
    }
    async_register_websocket_handlers(hass)
    handler = _get_command_handler(hass, WS_TYPE_GET_LIBRARY)
    connection, _ = _make_connection()

    handler(hass, connection, {"id": 7, "type": WS_TYPE_GET_LIBRARY})
    await hass.async_block_till_done()

    cast("AsyncMock", coordinator.async_request_refresh).assert_awaited_once()
    cast("MagicMock", connection.send_result).assert_called_once_with(
        7,
        {
            "healthy": True,
            "books": [],
            "podcasts": [],
            "in_progress": [],
            "active_sessions": {},
        },
    )


async def test_ws_subscribe_library_updates_returns_error_when_not_loaded(
    hass: HomeAssistant,
) -> None:
    """Test library subscriptions websocket command reports missing coordinator."""
    async_register_websocket_handlers(hass)
    handler = _get_command_handler(hass, WS_TYPE_SUBSCRIBE_LIBRARY_UPDATES)
    connection, _ = _make_connection()

    handler(
        hass,
        connection,
        {"id": 9, "type": WS_TYPE_SUBSCRIBE_LIBRARY_UPDATES},
    )
    await hass.async_block_till_done()

    cast("MagicMock", connection.send_error).assert_called_once_with(
        9, "not_loaded", "Integration not ready or loaded"
    )


async def test_ws_subscribe_library_updates_registers_listener(
    hass: HomeAssistant,
) -> None:
    """Test library subscriptions websocket command attaches a listener."""
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.data = AbstpData(
        healthy=True,
        books=[],
        podcasts=[],
        in_progress=[],
    )
    coordinator.async_add_listener = MagicMock(return_value=MagicMock())
    hass.data[DOMAIN] = {
        "active_entry": {"coordinator": coordinator},
    }
    async_register_websocket_handlers(hass)
    handler = _get_command_handler(hass, WS_TYPE_SUBSCRIBE_LIBRARY_UPDATES)
    connection, subscriptions = _make_connection()

    handler(
        hass,
        connection,
        {"id": 11, "type": WS_TYPE_SUBSCRIBE_LIBRARY_UPDATES},
    )
    await hass.async_block_till_done()

    add_listener = cast("AsyncMock", coordinator.async_add_listener)
    add_listener.assert_called_once()
    listener_cb = cast("Callable[[], None]", add_listener.call_args.args[0])
    listener_cb()
    cast("MagicMock", connection.send_message).assert_called()
    assert 11 in subscriptions
    cast("MagicMock", connection.send_result).assert_called_once_with(11, {})


async def test_ws_subscribe_card_preference_sends_initial_selection(
    hass: HomeAssistant,
) -> None:
    """Test card preference subscription pushes the stored selection."""
    hass.states.async_set("media_player.abstp_speaker", STATE_IDLE)
    store = AsyncMock(spec=CardPreferenceStore)
    async_get = AsyncMock(return_value="media_player.abstp_speaker")
    store.async_get = async_get
    connection, subscriptions = _make_connection()
    registry: dict[tuple[int, str, str], int] = {}
    hass.data[DOMAIN] = {CARD_PREFERENCE_SUBSCRIPTIONS_KEY: registry}
    async_register_websocket_handlers(hass)
    handler = _get_command_handler(hass, WS_TYPE_SUBSCRIBE_CARD_PREFERENCE)

    with patch(
        "custom_components.abstp_controller.websocket.async_get_card_preference_store",
        return_value=store,
    ):
        handler(
            hass,
            connection,
            {"id": 13, "type": WS_TYPE_SUBSCRIBE_CARD_PREFERENCE, "card_id": "card_1"},
        )
        await hass.async_block_till_done()

    async_get.assert_awaited_once_with("user_1", "card_1")
    cast("MagicMock", connection.send_result).assert_called_once_with(
        13, {"card_id": "card_1"}
    )
    cast("MagicMock", connection.send_message).assert_called()
    assert 13 in subscriptions


async def test_ws_subscribe_card_preference_forwards_matching_events(
    hass: HomeAssistant,
) -> None:
    """Test card preference subscription forwards matching preference events."""
    hass.states.async_set("media_player.abstp_speaker", STATE_IDLE)
    store = AsyncMock(spec=CardPreferenceStore)
    _ = AsyncMock(return_value=None)
    connection, subscriptions = _make_connection()
    registry: dict[tuple[int, str, str], int] = {}
    hass.data[DOMAIN] = {CARD_PREFERENCE_SUBSCRIPTIONS_KEY: registry}
    async_register_websocket_handlers(hass)
    handler = _get_command_handler(hass, WS_TYPE_SUBSCRIBE_CARD_PREFERENCE)

    with patch(
        "custom_components.abstp_controller.websocket.async_get_card_preference_store",
        return_value=store,
    ):
        handler(
            hass,
            connection,
            {"id": 15, "type": WS_TYPE_SUBSCRIBE_CARD_PREFERENCE, "card_id": "card_1"},
        )
        await hass.async_block_till_done()
        hass.bus.async_fire(
            "abstp_controller_card_preference_changed",
            {
                "user_id": "user_1",
                "card_id": "card_1",
                "selected_player": "media_player.abstp_speaker",
            },
        )
        hass.bus.async_fire(
            "abstp_controller_card_preference_changed",
            {
                "user_id": "other_user",
                "card_id": "card_1",
                "selected_player": "media_player.abstp_speaker",
            },
        )
        await hass.async_block_till_done()

    assert cast("MagicMock", connection.send_message).call_count == 2
    if 15 in subscriptions:
        _ = subscriptions[15]()


async def test_ws_subscribe_card_preference_replaces_duplicate_subscription(
    hass: HomeAssistant,
) -> None:
    """Test duplicate card preference subscriptions replace the old one."""
    store = AsyncMock(spec=CardPreferenceStore)
    _ = AsyncMock(return_value=None)
    connection, subscriptions = _make_connection()
    registry: dict[tuple[int, str, str], int] = {}
    hass.data[DOMAIN] = {CARD_PREFERENCE_SUBSCRIPTIONS_KEY: registry}
    async_register_websocket_handlers(hass)
    handler = _get_command_handler(hass, WS_TYPE_SUBSCRIBE_CARD_PREFERENCE)

    with patch(
        "custom_components.abstp_controller.websocket.async_get_card_preference_store",
        return_value=store,
    ):
        handler(
            hass,
            connection,
            {"id": 17, "type": WS_TYPE_SUBSCRIBE_CARD_PREFERENCE, "card_id": "card_1"},
        )
        await hass.async_block_till_done()
        handler(
            hass,
            connection,
            {"id": 19, "type": WS_TYPE_SUBSCRIBE_CARD_PREFERENCE, "card_id": "card_1"},
        )
        await hass.async_block_till_done()

    assert 17 not in subscriptions
    assert 19 in subscriptions


async def test_ws_set_card_preference_rejects_non_virtual_player(
    hass: HomeAssistant,
) -> None:
    """Test card preference set command rejects non virtual players."""
    store = AsyncMock(spec=CardPreferenceStore)
    async_register_websocket_handlers(hass)
    handler = _get_command_handler(hass, WS_TYPE_SET_CARD_PREFERENCE)
    connection, _ = _make_connection()

    with patch(
        "custom_components.abstp_controller.websocket.async_get_card_preference_store",
        return_value=store,
    ):
        handler(
            hass,
            connection,
            {
                "id": 21,
                "type": WS_TYPE_SET_CARD_PREFERENCE,
                "card_id": "card_1",
                "selected_player": "media_player.other",
            },
        )
        await hass.async_block_till_done()

    cast("MagicMock", connection.send_error).assert_called_once_with(
        21,
        "invalid_player",
        "Card preferences support only virtual media players",
    )
    cast("AsyncMock", store.async_set).assert_not_awaited()


async def test_ws_set_card_preference_persists_and_broadcasts(
    hass: HomeAssistant,
) -> None:
    """Test card preference set command persists and broadcasts changes."""
    hass.states.async_set("media_player.abstp_speaker", STATE_IDLE)
    store = AsyncMock(spec=CardPreferenceStore)
    entry = MagicMock(spec=ConfigEntry)
    entry.options = {CONF_TARGET_PLAYERS: ["media_player.speaker"]}
    entry.data = {}
    invalid_entry = MagicMock(spec=ConfigEntry)
    invalid_entry.options = {CONF_TARGET_PLAYERS: "not_a_list"}
    invalid_entry.data = {}
    unknown_entry = MagicMock(spec=ConfigEntry)
    unknown_entry.options = {CONF_TARGET_PLAYERS: ["fan.living_room"]}
    unknown_entry.data = {}
    async_register_websocket_handlers(hass)
    handler = _get_command_handler(hass, WS_TYPE_SET_CARD_PREFERENCE)
    connection, _ = _make_connection()

    with (
        patch(
            "custom_components.abstp_controller.websocket.async_get_card_preference_store",
            return_value=store,
        ),
        patch.object(
            hass.config_entries,
            "async_entries",
            return_value=[entry, invalid_entry, unknown_entry],
        ),
    ):
        handler(
            hass,
            connection,
            {
                "id": 23,
                "type": WS_TYPE_SET_CARD_PREFERENCE,
                "card_id": "card_1",
                "selected_player": "media_player.abstp_speaker",
            },
        )
        await hass.async_block_till_done()

    cast("AsyncMock", store.async_set).assert_awaited_once_with(
        "user_1", "card_1", "media_player.abstp_speaker"
    )
    cast("MagicMock", connection.send_result).assert_called_once_with(
        23,
        {
            "card_id": "card_1",
            "selected_player": "media_player.abstp_speaker",
            "available_players": ["media_player.abstp_speaker"],
            "available_players_known": True,
        },
    )


async def test_ws_get_episodes_returns_episode_list(
    hass: HomeAssistant,
) -> None:
    """Test get episodes websocket command returns serialized episodes."""
    client = AsyncMock(spec=AbstpApiClient)
    get_episodes = AsyncMock(
        return_value=[
            PodcastEpisode(
                id="ep_1",
                title="Episode One",
                season="1",
                episode="1",
                published_at="2026-01-01",
                duration=1800.0,
                progress=300.0,
            )
        ]
    )
    client.async_get_podcast_episodes = get_episodes
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    hass.data[DOMAIN] = {"active_entry": {"coordinator": coordinator}}
    async_register_websocket_handlers(hass)
    handler = _get_command_handler(hass, WS_TYPE_GET_EPISODES)
    connection, _ = _make_connection()

    handler(
        hass,
        connection,
        {"id": 25, "type": WS_TYPE_GET_EPISODES, "podcast_id": "podcast_1"},
    )
    await hass.async_block_till_done()

    get_episodes.assert_awaited_once()
    send_result = cast("MagicMock", connection.send_result)
    send_result.assert_called_once()
    result = cast("dict[str, object]", send_result.call_args.args[1])
    episodes = cast("list[dict[str, object]]", result["episodes"])
    assert len(episodes) == 1
    assert episodes[0]["id"] == "ep_1"


async def test_ws_get_episodes_sends_error_on_api_failure(
    hass: HomeAssistant,
) -> None:
    """Test get episodes websocket command reports proxy failures."""
    client = AsyncMock(spec=AbstpApiClient)
    get_episodes = AsyncMock(side_effect=AbstpApiError("proxy down"))
    client.async_get_podcast_episodes = get_episodes
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    hass.data[DOMAIN] = {"active_entry": {"coordinator": coordinator}}
    async_register_websocket_handlers(hass)
    handler = _get_command_handler(hass, WS_TYPE_GET_EPISODES)
    connection, _ = _make_connection()

    handler(
        hass,
        connection,
        {"id": 27, "type": WS_TYPE_GET_EPISODES, "podcast_id": "podcast_1"},
    )
    await hass.async_block_till_done()

    cast("MagicMock", connection.send_error).assert_called_once_with(
        27, "fetch_failed", "proxy down"
    )


async def test_ws_get_episodes_returns_error_when_not_loaded(
    hass: HomeAssistant,
) -> None:
    """Test get episodes websocket command reports missing coordinator."""
    async_register_websocket_handlers(hass)
    handler = _get_command_handler(hass, WS_TYPE_GET_EPISODES)
    connection, _ = _make_connection()

    handler(
        hass,
        connection,
        {"id": 29, "type": WS_TYPE_GET_EPISODES, "podcast_id": "podcast_1"},
    )
    await hass.async_block_till_done()

    cast("MagicMock", connection.send_error).assert_called_once_with(
        29, "not_loaded", "Integration not ready or loaded"
    )


async def test_ws_get_chapters_returns_chapter_list(
    hass: HomeAssistant,
) -> None:
    """Test get chapters websocket command returns serialized chapters."""
    client = AsyncMock(spec=AbstpApiClient)
    get_chapters = AsyncMock(
        return_value=[
            ChapterItem(
                id=1,
                title="Chapter One",
                start=0.0,
                end=100.0,
                duration=100.0,
            )
        ]
    )
    client.async_get_book_chapters = get_chapters
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    hass.data[DOMAIN] = {"active_entry": {"coordinator": coordinator}}
    async_register_websocket_handlers(hass)
    handler = _get_command_handler(hass, WS_TYPE_GET_CHAPTERS)
    connection, _ = _make_connection()

    handler(
        hass,
        connection,
        {"id": 31, "type": WS_TYPE_GET_CHAPTERS, "book_id": "book_1"},
    )
    await hass.async_block_till_done()

    get_chapters.assert_awaited_once()
    send_result = cast("MagicMock", connection.send_result)
    result = cast("dict[str, object]", send_result.call_args.args[1])
    chapters = cast("list[dict[str, object]]", result["chapters"])
    assert chapters[0]["title"] == "Chapter One"


async def test_ws_get_chapters_sends_error_on_api_failure(
    hass: HomeAssistant,
) -> None:
    """Test get chapters websocket command reports proxy failures."""
    client = AsyncMock(spec=AbstpApiClient)
    get_chapters = AsyncMock(side_effect=AbstpApiError("proxy down"))
    client.async_get_book_chapters = get_chapters
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    hass.data[DOMAIN] = {"active_entry": {"coordinator": coordinator}}
    async_register_websocket_handlers(hass)
    handler = _get_command_handler(hass, WS_TYPE_GET_CHAPTERS)
    connection, _ = _make_connection()

    handler(
        hass,
        connection,
        {"id": 33, "type": WS_TYPE_GET_CHAPTERS, "book_id": "book_1"},
    )
    await hass.async_block_till_done()

    cast("MagicMock", connection.send_error).assert_called_once_with(
        33, "fetch_failed", "proxy down"
    )


async def test_ws_get_chapters_returns_error_when_not_loaded(
    hass: HomeAssistant,
) -> None:
    """Test get chapters websocket command reports missing coordinator."""
    async_register_websocket_handlers(hass)
    handler = _get_command_handler(hass, WS_TYPE_GET_CHAPTERS)
    connection, _ = _make_connection()

    handler(
        hass,
        connection,
        {"id": 35, "type": WS_TYPE_GET_CHAPTERS, "book_id": "book_1"},
    )
    await hass.async_block_till_done()

    cast("MagicMock", connection.send_error).assert_called_once_with(
        35, "not_loaded", "Integration not ready or loaded"
    )
