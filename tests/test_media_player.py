"""Unit tests for abstp virtual media player platform."""

from datetime import timedelta
from logging import getLogger
from types import MappingProxyType
from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.components.media_player.const import (
    MediaPlayerEntityFeature,
    MediaPlayerState,
    MediaType,
)
from homeassistant.config_entries import SOURCE_USER, ConfigEntry
from homeassistant.const import (
    ATTR_ENTITY_ID,
    STATE_IDLE,
    STATE_OFF,
    STATE_PAUSED,
    STATE_PLAYING,
    STATE_STANDBY,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
)
from homeassistant.core import ServiceCall, State
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import (
    device_registry as dr,
)
from homeassistant.helpers import (
    entity_registry as er,
)
from homeassistant.helpers.entity_platform import EntityPlatform, PlatformData

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable

    from homeassistant.core import HomeAssistant
    from homeassistant.helpers.entity import Entity
    from homeassistant.helpers.entity_platform import AddEntitiesCallback

from custom_components.abstp_controller.api import (
    AbstpApiClient,
    InProgressItem,
    MediaItem,
)
from custom_components.abstp_controller.const import (
    ATTR_CURRENT_TIME,
    ATTR_EPISODE_ID,
    ATTR_ITEM_ID,
    ATTR_PLAYBACK_SPEED,
    CONF_PLAYER_FRIENDLY_NAMES,
    CONF_TARGET_PLAYERS,
    DOMAIN,
    PREFIX_VIRTUAL_PLAYER,
    SERVICE_PLAY,
)
from custom_components.abstp_controller.coordinator import (
    AbstpData,
    AbstpDataUpdateCoordinator,
)
from custom_components.abstp_controller.media_player import (
    AbstpVirtualMediaPlayer,
    async_setup_entry,
    is_target_player_ready,
)
from custom_components.abstp_controller.tracker import SessionTracker


def _mock_service(
    hass: HomeAssistant,
    domain: str,
    service: str,
    raise_exception: Exception | None = None,
) -> list[ServiceCall]:
    """Mock a Home Assistant service and record calls."""
    calls: list[ServiceCall] = []

    async def mock_handler(call: ServiceCall) -> None:
        calls.append(call)
        if raise_exception is not None:
            raise raise_exception

    hass.services.async_register(domain, service, mock_handler)
    return calls


def _attach_player_to_hass(
    player: AbstpVirtualMediaPlayer,
    hass: HomeAssistant,
) -> None:
    """Attach virtual player to test HomeAssistant instance and platform data."""
    player.hass = hass
    player.platform_data = PlatformData(
        hass,
        domain="media_player",
        platform_name=DOMAIN,
    )
    player.attach_target_listener()
    player.update_state_attributes()


@pytest.mark.parametrize(
    ("target_entity_id", "state_val", "attributes", "expected_ready"),
    [
        ("media_player.living_room", None, {}, False),
        ("media_player.living_room", STATE_UNAVAILABLE, {}, False),
        ("media_player.living_room", STATE_UNKNOWN, {}, False),
        ("media_player.living_room", STATE_PLAYING, {}, True),
        ("media_player.living_room", STATE_IDLE, {}, True),
        ("media_player.yandex_station_1", STATE_IDLE, {}, False),
        (
            "media_player.yandex_station_1",
            STATE_IDLE,
            {"alice_state": "", "assumed_state": True},
            False,
        ),
        (
            "media_player.yandex_station_1",
            STATE_IDLE,
            {"alice_state": "IDLE", "assumed_state": False},
            True,
        ),
    ],
)
def test_is_target_player_ready(
    hass: HomeAssistant,
    target_entity_id: str,
    state_val: str | None,
    attributes: dict[str, object],
    expected_ready: bool,
) -> None:
    """Test target media player readiness check."""
    if state_val is not None:
        hass.states.async_set(target_entity_id, state_val, attributes)

    ready = is_target_player_ready(hass, target_entity_id)
    assert ready is expected_ready


async def test_async_setup_entry_missing_data(hass: HomeAssistant) -> None:
    """Test async_setup_entry returns early when domain data is missing."""
    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry"
    hass.data[DOMAIN] = {}

    added: list[Entity] = []

    def add_entities(new: Iterable[Entity], update_before_add: bool = False) -> None:
        _ = update_before_add
        added.extend(new)

    await async_setup_entry(hass, entry, cast("AddEntitiesCallback", add_entities))
    assert len(added) == 0


async def test_async_setup_entry_creates_browser_and_target_facades(
    hass: HomeAssistant,
    mock_books: list[MediaItem],
    mock_podcasts: list[MediaItem],
    mock_in_progress: list[InProgressItem],
) -> None:
    """Test setup creates web browser player and dedicated speaker facades."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"

    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(
        healthy=True,
        books=mock_books,
        podcasts=mock_podcasts,
        in_progress=mock_in_progress,
    )
    tracker = SessionTracker(hass, client)

    entry = MagicMock(spec=ConfigEntry)
    entry_id = "test_entry_facades"
    entry.entry_id = entry_id
    entry.options = {
        CONF_TARGET_PLAYERS: [
            "media_player.bedroom",
            "media_player.living_room",
        ],
        CONF_PLAYER_FRIENDLY_NAMES: {
            "media_player.bedroom": "Custom Bedroom Speaker",
        },
    }
    entry.data = {}

    hass.data[DOMAIN] = {entry_id: {"coordinator": coordinator, "tracker": tracker}}

    hass.states.async_set(
        "media_player.bedroom",
        STATE_IDLE,
        {"friendly_name": "Bedroom Station"},
    )
    hass.states.async_set(
        "media_player.living_room",
        STATE_IDLE,
        {"friendly_name": "Living Room Station"},
    )

    added: list[Entity] = []

    def add_entities(new: Iterable[Entity], update_before_add: bool = False) -> None:
        _ = update_before_add
        added.extend(new)

    await async_setup_entry(hass, entry, cast("AddEntitiesCallback", add_entities))
    assert len(added) == 2

    bedroom = added[0]
    assert isinstance(bedroom, AbstpVirtualMediaPlayer)
    assert bedroom.entity_id == f"media_player.{PREFIX_VIRTUAL_PLAYER}bedroom"
    assert bedroom.unique_id == f"{entry_id}_media_player.bedroom"
    assert bedroom.name == "Custom Bedroom Speaker"
    assert bedroom.target_entity_id == "media_player.bedroom"

    living_room = added[1]
    assert isinstance(living_room, AbstpVirtualMediaPlayer)
    assert living_room.entity_id == f"media_player.{PREFIX_VIRTUAL_PLAYER}living_room"
    assert living_room.unique_id == f"{entry_id}_media_player.living_room"
    assert living_room.name == "Living Room Station"
    assert living_room.target_entity_id == "media_player.living_room"


async def test_virtual_player_state_uses_configured_name_without_device_prefix(
    hass: HomeAssistant,
) -> None:
    """Test registered virtual player state keeps its configured full name."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"
    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])
    tracker = SessionTracker(hass, client)

    entry = ConfigEntry(
        domain=DOMAIN,
        entry_id="test_entry_name",
        data={},
        options={
            CONF_TARGET_PLAYERS: ["media_player.bedroom"],
            CONF_PLAYER_FRIENDLY_NAMES: {
                "media_player.bedroom": "Test Player",
            },
        },
        discovery_keys=MappingProxyType({}),
        minor_version=1,
        source=SOURCE_USER,
        subentries_data=None,
        title="Test Entry",
        unique_id=None,
        version=1,
    )
    hass.data[DOMAIN] = {
        entry.entry_id: {"coordinator": coordinator, "tracker": tracker}
    }
    hass.states.async_set("media_player.bedroom", STATE_IDLE)

    player = AbstpVirtualMediaPlayer(
        coordinator=coordinator,
        tracker=tracker,
        entry=entry,
        target_entity_id="media_player.bedroom",
        friendly_name="Test Player",
    )
    platform = EntityPlatform(
        hass=hass,
        logger=getLogger(__name__),
        domain="media_player",
        platform_name=DOMAIN,
        platform=None,
        scan_interval=timedelta(seconds=300),
        entity_namespace=None,
    )
    platform.config_entry = entry
    with patch.object(hass.config_entries, "async_get_entry", return_value=entry):
        await platform.async_add_entities([player], update_before_add=True)

    state = hass.states.get(player.entity_id)
    assert state is not None
    registry_entry = er.async_get(hass).async_get(player.entity_id)
    assert registry_entry is not None
    assert registry_entry.has_entity_name is False
    assert state.attributes["friendly_name"] == "Test Player"
    assert player.has_entity_name is False
    assert entry.options[CONF_TARGET_PLAYERS] == ["media_player.bedroom"]
    assert entry.options[CONF_PLAYER_FRIENDLY_NAMES] == {
        "media_player.bedroom": "Test Player",
    }

    await platform.async_remove_entity(player.entity_id)


async def test_async_setup_entry_cleans_up_orphaned_entities(
    hass: HomeAssistant,
) -> None:
    """Test async_setup_entry removes obsolete entities from entity registry."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"
    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])
    tracker = SessionTracker(hass, client)

    entry = MagicMock(spec=ConfigEntry)
    entry_id = "test_entry_cleanup"
    entry.entry_id = entry_id
    entry.options = {CONF_TARGET_PLAYERS: ["media_player.active_speaker"]}
    entry.data = {}
    entry.pref_disable_new_entities = False

    hass.data[DOMAIN] = {entry_id: {"coordinator": coordinator, "tracker": tracker}}

    ent_reg = er.async_get(hass)
    with patch.object(hass.config_entries, "async_get_entry", return_value=entry):
        old_entry = ent_reg.async_get_or_create(
            domain="media_player",
            platform=DOMAIN,
            unique_id=f"{entry_id}_media_player.obsolete_speaker",
            config_entry=entry,
        )
    assert ent_reg.async_get(old_entry.entity_id) is not None

    added: list[Entity] = []

    def add_entities(new: Iterable[Entity], update_before_add: bool = False) -> None:
        _ = update_before_add
        added.extend(new)

    await async_setup_entry(hass, entry, cast("AddEntitiesCallback", add_entities))
    assert ent_reg.async_get(old_entry.entity_id) is None


async def test_async_setup_entry_updates_existing_entities_registry_properties(
    hass: HomeAssistant,
) -> None:
    """Test async_setup_entry resets device_id and syncs name in entity registry."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"
    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])
    tracker = SessionTracker(hass, client)

    entry = MagicMock(spec=ConfigEntry)
    entry_id = "test_entry_sync"
    entry.entry_id = entry_id
    entry.domain = DOMAIN
    entry.disabled_by = None
    entry.options = {
        CONF_TARGET_PLAYERS: ["media_player.living_room"],
        CONF_PLAYER_FRIENDLY_NAMES: {"media_player.living_room": "sb TV"},
    }
    entry.data = {}
    entry.pref_disable_new_entities = False

    hass.data[DOMAIN] = {entry_id: {"coordinator": coordinator, "tracker": tracker}}

    ent_reg = er.async_get(hass)
    dev_reg = dr.async_get(hass)
    with patch.object(hass.config_entries, "async_get_entry", return_value=entry):
        device = dev_reg.async_get_or_create(
            config_entry_id=entry_id,
            identifiers={(DOMAIN, entry_id)},
            name="Audiobookshelf Transcoder Proxy Controller",
        )
        existing_reg_entry = ent_reg.async_get_or_create(
            domain="media_player",
            platform=DOMAIN,
            unique_id=f"{entry_id}_media_player.living_room",
            config_entry=entry,
            device_id=device.id,
            has_entity_name=True,
            original_name="Audiobookshelf Transcoder Proxy Controller sb TV",
        )
        _ = ent_reg.async_update_entity(
            existing_reg_entry.entity_id, name="Old Override"
        )

    added: list[Entity] = []

    def add_entities(new: Iterable[Entity], update_before_add: bool = False) -> None:
        _ = update_before_add
        added.extend(new)

    await async_setup_entry(hass, entry, cast("AddEntitiesCallback", add_entities))

    updated_reg_entry = ent_reg.async_get(existing_reg_entry.entity_id)
    assert updated_reg_entry is not None
    assert updated_reg_entry.device_id == device.id
    assert updated_reg_entry.name == "sb TV"


@pytest.mark.parametrize(
    ("target_raw_state", "expected_player_state"),
    [
        (STATE_PLAYING, MediaPlayerState.IDLE),
        (STATE_PAUSED, MediaPlayerState.IDLE),
        (STATE_OFF, MediaPlayerState.OFF),
        (STATE_IDLE, MediaPlayerState.IDLE),
        (STATE_STANDBY, MediaPlayerState.IDLE),
        (STATE_UNAVAILABLE, MediaPlayerState.IDLE),
    ],
)
async def test_virtual_player_state_forwarding(
    hass: HomeAssistant,
    target_raw_state: str,
    expected_player_state: MediaPlayerState,
) -> None:
    """Test playback state mapping from target player entity."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"
    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])
    tracker = SessionTracker(hass, client)

    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_fwd"
    entry.options = {}
    entry.data = {}

    hass.states.async_set("media_player.speaker", target_raw_state)

    player = AbstpVirtualMediaPlayer(
        coordinator=coordinator,
        tracker=tracker,
        entry=entry,
        target_entity_id="media_player.speaker",
    )
    _attach_player_to_hass(player, hass)

    assert player.state == expected_player_state


async def test_virtual_player_target_pause_stops_playback(
    hass: HomeAssistant,
) -> None:
    """Test target pause terminates session and stops target player."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"
    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])
    tracker = SessionTracker(hass, client)

    stop_calls = _mock_service(hass, "media_player", "media_stop")

    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_pause_stop"
    entry.options = {}
    entry.data = {}

    target_id = "media_player.station"
    hass.states.async_set(
        target_id,
        STATE_IDLE,
        {"supported_features": int(MediaPlayerEntityFeature.STOP)},
    )

    player = AbstpVirtualMediaPlayer(
        coordinator=coordinator,
        tracker=tracker,
        entry=entry,
        target_entity_id=target_id,
    )
    _attach_player_to_hass(player, hass)

    tracker.register_session(
        entity_id=target_id,
        session_id="sess_pause_test",
        item_id="book_pause_test",
        episode_id=None,
        speed=1.0,
        initial_position=50.0,
    )

    hass.states.async_set(
        target_id,
        STATE_PLAYING,
        {"supported_features": int(MediaPlayerEntityFeature.STOP)},
    )
    await hass.async_block_till_done()

    player.update_state_attributes()
    playing_state = player.state
    assert playing_state == MediaPlayerState.PLAYING

    hass.states.async_set(
        target_id,
        STATE_PAUSED,
        {"supported_features": int(MediaPlayerEntityFeature.STOP)},
    )
    await hass.async_block_till_done()

    assert player.state == MediaPlayerState.IDLE
    assert len(stop_calls) == 1
    assert stop_calls[0].data.get(ATTR_ENTITY_ID) == target_id


async def test_virtual_player_metadata_with_active_session(
    hass: HomeAssistant,
    mock_books: list[MediaItem],
    mock_podcasts: list[MediaItem],
    mock_in_progress: list[InProgressItem],
) -> None:
    """Test metadata resolution from active session in SessionTracker."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"

    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(
        healthy=True,
        books=mock_books,
        podcasts=mock_podcasts,
        in_progress=mock_in_progress,
    )

    tracker = SessionTracker(hass, client)
    tracker.register_session(
        entity_id="media_player.speaker",
        session_id="sess_123",
        item_id="book_1",
        episode_id=None,
        speed=1.0,
        initial_position=1200.0,
    )

    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_meta"
    entry.options = {}
    entry.data = {}

    hass.states.async_set("media_player.speaker", STATE_PLAYING)

    player = AbstpVirtualMediaPlayer(
        coordinator=coordinator,
        tracker=tracker,
        entry=entry,
        target_entity_id="media_player.speaker",
    )
    _attach_player_to_hass(player, hass)

    assert player.media_title == "Dune • Frank Herbert"
    assert player.media_artist == "Narrator Example"
    assert player.media_content_type == MediaType.MUSIC
    assert player.media_duration == 36000
    assert player.media_position is not None
    assert player.entity_picture == "/api/abstp_controller/cover/book_1"
    assert player.media_position_updated_at is not None

    attrs = player.extra_state_attributes
    assert attrs is not None
    assert attrs["target_player"] == "media_player.speaker"
    assert attrs["target_available"] is True
    assert attrs["item_id"] == "book_1"
    assert attrs[ATTR_PLAYBACK_SPEED] == 1.0


async def test_idle_virtual_player_syncs_selected_abs_progress(
    hass: HomeAssistant,
    mock_books: list[MediaItem],
    mock_podcasts: list[MediaItem],
    mock_in_progress: list[InProgressItem],
) -> None:
    """Test idle facade retains its item while refreshing progress from ABS."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"
    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(
        healthy=True,
        books=mock_books,
        podcasts=mock_podcasts,
        in_progress=mock_in_progress,
    )
    tracker = SessionTracker(hass, client)
    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_idle_sync"
    entry.options = {}
    entry.data = {}
    hass.states.async_set(
        "media_player.speaker",
        STATE_PLAYING,
        {"media_position": 17.0, "media_title": "External radio"},
    )

    player = AbstpVirtualMediaPlayer(
        coordinator=coordinator,
        tracker=tracker,
        entry=entry,
        target_entity_id="media_player.speaker",
    )
    for attr, value in (("_item_id", "book_1"), ("_attr_media_position", 17)):
        setattr(player, attr, value)
    _attach_player_to_hass(player, hass)

    assert player.state == MediaPlayerState.IDLE
    assert player.media_title == "Dune • Frank Herbert"
    assert player.media_position == 1200
    assert player.media_duration == 36000


async def test_idle_virtual_player_matches_podcast_episode_progress(
    hass: HomeAssistant,
) -> None:
    """Test idle facade updates only the retained podcast episode from ABS."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"
    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(
        healthy=True,
        books=[],
        podcasts=[],
        in_progress=[
            InProgressItem(
                id="podcast_1",
                title="Podcast",
                author="Host",
                media_type="podcast",
                current_time=100.0,
                duration=1000.0,
                progress=100.0,
                episode_id="episode_1",
                episode_title="Episode One",
            ),
            InProgressItem(
                id="podcast_1",
                title="Podcast",
                author="Host",
                media_type="podcast",
                current_time=200.0,
                duration=1000.0,
                progress=200.0,
                episode_id="episode_2",
                episode_title="Episode Two",
            ),
        ],
    )
    tracker = SessionTracker(hass, client)
    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_episode_sync"
    entry.options = {}
    entry.data = {}
    hass.states.async_set("media_player.speaker", STATE_IDLE)

    player = AbstpVirtualMediaPlayer(
        coordinator=coordinator,
        tracker=tracker,
        entry=entry,
        target_entity_id="media_player.speaker",
    )
    for attr, value in (("_item_id", "podcast_1"), ("_episode_id", "episode_2")):
        setattr(player, attr, value)
    _attach_player_to_hass(player, hass)

    assert player.media_title == "Episode Two"
    assert player.media_position == 200


async def test_virtual_player_metadata_fallback_to_target_entity(
    hass: HomeAssistant,
) -> None:
    """Test metadata fallback to target volume attributes when no session."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"

    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])

    tracker = SessionTracker(hass, client)

    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_fallback"
    entry.options = {}
    entry.data = {}

    hass.states.async_set(
        "media_player.speaker",
        STATE_PLAYING,
        {
            "volume_level": 0.75,
            "is_volume_muted": False,
        },
    )

    player = AbstpVirtualMediaPlayer(
        coordinator=coordinator,
        tracker=tracker,
        entry=entry,
        target_entity_id="media_player.speaker",
    )
    _attach_player_to_hass(player, hass)

    assert player.volume_level == 0.75
    assert player.is_volume_muted is False


async def test_virtual_player_command_forwarding(hass: HomeAssistant) -> None:
    """Test play, pause delegating to stop, seek, volume, and mute commands."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"

    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])

    tracker = SessionTracker(hass, client)

    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_cmds"
    entry.options = {}
    entry.data = {}

    hass.states.async_set(
        "media_player.speaker",
        STATE_PLAYING,
        {"supported_features": int(MediaPlayerEntityFeature.STOP)},
    )

    player = AbstpVirtualMediaPlayer(
        coordinator=coordinator,
        tracker=tracker,
        entry=entry,
        target_entity_id="media_player.speaker",
    )
    _attach_player_to_hass(player, hass)

    for attr, val in (("_item_id", "book_1"),):
        setattr(player, attr, val)

    play_calls = _mock_service(hass, "media_player", "media_play")
    stop_calls = _mock_service(hass, "media_player", "media_stop")
    vol_calls = _mock_service(hass, "media_player", "volume_set")
    mute_calls = _mock_service(hass, "media_player", "volume_mute")
    custom_play_calls = _mock_service(hass, DOMAIN, "play")

    await player.async_media_play()
    assert len(custom_play_calls) == 1
    assert custom_play_calls[0].data == {
        ATTR_ENTITY_ID: "media_player.speaker",
        ATTR_ITEM_ID: "book_1",
    }
    assert len(play_calls) == 0

    await player.async_media_pause()
    assert len(stop_calls) == 1
    assert stop_calls[0].data == {ATTR_ENTITY_ID: "media_player.speaker"}
    assert player.state == MediaPlayerState.IDLE

    await player.async_media_play_pause()
    assert len(custom_play_calls) == 2
    assert custom_play_calls[1].data == {
        ATTR_ENTITY_ID: "media_player.speaker",
        ATTR_ITEM_ID: "book_1",
    }

    await player.async_set_volume_level(0.5)
    assert len(vol_calls) == 1
    assert vol_calls[0].data == {
        ATTR_ENTITY_ID: "media_player.speaker",
        "volume_level": 0.5,
    }

    await player.async_mute_volume(True)
    assert len(mute_calls) == 1
    assert mute_calls[0].data == {
        ATTR_ENTITY_ID: "media_player.speaker",
        "is_volume_muted": True,
    }

    for attr, val in (("_attr_state", MediaPlayerState.PLAYING),):
        setattr(player, attr, val)
    await player.async_media_seek(600.0)
    assert player.media_position == 600
    assert len(custom_play_calls) == 3
    assert custom_play_calls[2].data == {
        ATTR_ENTITY_ID: "media_player.speaker",
        ATTR_ITEM_ID: "book_1",
        ATTR_CURRENT_TIME: 600.0,
    }

    await player.async_play_media("music", "book_42")
    assert len(custom_play_calls) == 4
    assert custom_play_calls[3].data == {
        ATTR_ENTITY_ID: "media_player.speaker",
        "item_id": "book_42",
    }


@pytest.mark.parametrize(
    (
        "target_entity_id",
        "item_id",
        "episode_id",
        "position",
        "in_progress",
        "books",
        "expected_calls",
    ),
    [
        (
            "media_player.speaker",
            "item_1",
            "ep_1",
            120.0,
            [],
            [],
            [
                {
                    ATTR_ENTITY_ID: "media_player.speaker",
                    ATTR_ITEM_ID: "item_1",
                    ATTR_EPISODE_ID: "ep_1",
                    ATTR_CURRENT_TIME: 120.0,
                }
            ],
        ),
        (
            "media_player.speaker",
            None,
            None,
            0.0,
            [
                InProgressItem(
                    id="item_prog",
                    title="Progress Book",
                    author="Author",
                    media_type="book",
                    current_time=45.0,
                    duration=100.0,
                    progress=0.45,
                    cover_url=None,
                    episode_id="ep_prog",
                )
            ],
            [],
            [
                {
                    ATTR_ENTITY_ID: "media_player.speaker",
                    ATTR_ITEM_ID: "item_prog",
                    ATTR_EPISODE_ID: "ep_prog",
                    ATTR_CURRENT_TIME: 45.0,
                }
            ],
        ),
        (
            "media_player.speaker",
            None,
            None,
            0.0,
            [],
            [
                MediaItem(
                    id="book_1",
                    title="First Book",
                    author="Author",
                    media_type="book",
                    progress=10.0,
                    duration=200.0,
                )
            ],
            [
                {
                    ATTR_ENTITY_ID: "media_player.speaker",
                    ATTR_ITEM_ID: "book_1",
                    ATTR_CURRENT_TIME: 10.0,
                }
            ],
        ),
        (
            "media_player.speaker",
            None,
            None,
            0.0,
            [],
            [],
            [],
        ),
    ],
)
async def test_virtual_player_media_play_idle_start(
    hass: HomeAssistant,
    target_entity_id: str,
    item_id: str | None,
    episode_id: str | None,
    position: float,
    in_progress: list[InProgressItem],
    books: list[MediaItem],
    expected_calls: list[dict[str, object]],
) -> None:
    """Test async_media_play initiating playback when speaker is idle."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"
    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(
        healthy=True, books=books, podcasts=[], in_progress=in_progress
    )
    tracker = SessionTracker(hass, client)

    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_idle_play"
    entry.options = {}
    entry.data = {}

    if target_entity_id:
        hass.states.async_set(
            target_entity_id,
            STATE_IDLE,
            {"supported_features": int(MediaPlayerEntityFeature.PLAY_MEDIA)},
        )

    player = AbstpVirtualMediaPlayer(
        coordinator=coordinator,
        tracker=tracker,
        entry=entry,
        target_entity_id=target_entity_id,
    )
    _attach_player_to_hass(player, hass)

    for name, value in (
        ("_item_id", item_id),
        ("_episode_id", episode_id),
        ("_attr_media_position", int(position) if position else None),
    ):
        setattr(player, name, value)

    custom_play_calls = _mock_service(hass, DOMAIN, SERVICE_PLAY)

    await player.async_media_play()

    assert len(custom_play_calls) == len(expected_calls)
    if expected_calls:
        assert custom_play_calls[0].data == expected_calls[0]


async def test_virtual_player_stop_fallback(hass: HomeAssistant) -> None:
    """Test stop command fallback to pause when target lacks STOP feature."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"

    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])

    tracker = SessionTracker(hass, client)

    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_stop"
    entry.options = {}
    entry.data = {}

    hass.states.async_set(
        "media_player.station",
        STATE_PLAYING,
        {"supported_features": int(MediaPlayerEntityFeature.PAUSE)},
    )

    player = AbstpVirtualMediaPlayer(
        coordinator=coordinator,
        tracker=tracker,
        entry=entry,
        target_entity_id="media_player.station",
    )
    _attach_player_to_hass(player, hass)

    pause_calls = _mock_service(hass, "media_player", "media_pause")
    with patch.object(
        tracker, "async_stop_session_for_entity", new_callable=AsyncMock
    ) as mock_stop_tracker:
        await player.async_media_stop()
        assert len(pause_calls) == 1
        assert pause_calls[0].data == {ATTR_ENTITY_ID: "media_player.station"}
        mock_stop_tracker.assert_called_once_with("media_player.station")


async def test_virtual_player_stop_error_handled(hass: HomeAssistant) -> None:
    """Test stop command handles HomeAssistantError without crashing."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"
    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])

    tracker = SessionTracker(hass, client)

    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_err"
    entry.options = {}
    entry.data = {}

    hass.states.async_set(
        "media_player.tv",
        STATE_PLAYING,
        {"supported_features": int(MediaPlayerEntityFeature.STOP)},
    )

    player = AbstpVirtualMediaPlayer(
        coordinator=coordinator,
        tracker=tracker,
        entry=entry,
        target_entity_id="media_player.tv",
    )
    _attach_player_to_hass(player, hass)

    _ = _mock_service(
        hass,
        "media_player",
        "media_stop",
        raise_exception=HomeAssistantError("Service failed"),
    )
    with patch.object(
        tracker, "async_stop_session_for_entity", new_callable=AsyncMock
    ) as mock_stop:
        await player.async_media_stop()
        mock_stop.assert_called_once_with("media_player.tv")


async def test_virtual_player_library_routing(hass: HomeAssistant) -> None:
    """Test playing player-local library IDs parses book and episode IDs."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"
    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])
    tracker = SessionTracker(hass, client)

    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_ms"
    entry.options = {}
    entry.data = {}

    player = AbstpVirtualMediaPlayer(
        coordinator=coordinator,
        tracker=tracker,
        entry=entry,
        target_entity_id="media_player.speaker",
    )
    _attach_player_to_hass(player, hass)

    custom_play_calls = _mock_service(hass, DOMAIN, "play")

    await player.async_play_media("music", "book/book_99")
    assert len(custom_play_calls) == 1
    assert custom_play_calls[0].data == {
        ATTR_ENTITY_ID: "media_player.speaker",
        "item_id": "book_99",
    }

    await player.async_play_media("music", "episode/pod_1/ep_2")
    assert len(custom_play_calls) == 2
    assert custom_play_calls[1].data == {
        ATTR_ENTITY_ID: "media_player.speaker",
        "item_id": "pod_1",
        "episode_id": "ep_2",
    }

    await player.async_play_media("music", "in_progress/pod_3/ep_4")
    assert len(custom_play_calls) == 3
    assert custom_play_calls[2].data == {
        ATTR_ENTITY_ID: "media_player.speaker",
        "item_id": "pod_3",
        "episode_id": "ep_4",
    }


async def test_virtual_player_browse_media(hass: HomeAssistant) -> None:
    """Test async_browse_media opens the Audiobookshelf library root."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"
    coordinator = AbstpDataUpdateCoordinator(hass, client)
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])
    tracker = SessionTracker(hass, client)

    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_browse"
    entry.options = {}
    entry.data = {}

    player = AbstpVirtualMediaPlayer(
        coordinator=coordinator,
        tracker=tracker,
        entry=entry,
        target_entity_id="media_player.speaker",
    )
    _attach_player_to_hass(player, hass)

    browser = await player.async_browse_media()

    assert browser.title == "Audiobookshelf"
    assert browser.media_content_id == ""
    assert [child.media_content_id for child in browser.children or []] == [
        "continue_listening",
        "audiobooks",
        "podcasts",
    ]


async def test_virtual_player_lifecycle_and_restore(hass: HomeAssistant) -> None:
    """Test state restoration and reactive state change handling."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"

    listeners: list[Callable[[], None]] = []

    def capture_listener(cb: Callable[[], None]) -> MagicMock:
        listeners.append(cb)
        return MagicMock()

    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.last_update_success = True
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])
    coordinator.async_add_listener = capture_listener

    tracker = SessionTracker(hass, client)

    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_restore"
    entry.options = {}
    entry.data = {}

    player = AbstpVirtualMediaPlayer(
        coordinator=coordinator,
        tracker=tracker,
        entry=entry,
        target_entity_id="media_player.speaker",
    )
    _attach_player_to_hass(player, hass)

    mock_stored = MagicMock()
    mock_stored.state = State(
        "media_player.abstp_speaker",
        STATE_PLAYING,
        {
            "media_title": "Restored Title",
            "media_artist": "Restored Artist",
            "item_id": "restored_book_id",
            ATTR_PLAYBACK_SPEED: 1.75,
            "volume_level": 0.6,
            "is_volume_muted": False,
        },
    )

    with patch(
        "custom_components.abstp_controller.media_player.async_get"
    ) as mock_async_get:
        mock_restore_data = MagicMock()
        mock_restore_data.last_states = {player.entity_id: mock_stored}
        mock_async_get.return_value = mock_restore_data

        await player.async_added_to_hass()
        assert player.media_title == "Restored Title"
        assert player.media_artist == "Restored Artist"
        assert player.volume_level == 0.6
        assert player.is_volume_muted is False
        assert player.extra_state_attributes is not None
        assert player.extra_state_attributes[ATTR_PLAYBACK_SPEED] == 1.75

    with patch.object(player, "async_write_ha_state") as mock_write:
        for listener in listeners:
            listener()
        mock_write.assert_called()

    await player.async_will_remove_from_hass()
