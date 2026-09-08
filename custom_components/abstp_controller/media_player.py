"""Media player platform for Audiobookshelf Transcoder Proxy Controller."""

import time
from collections.abc import Mapping
from typing import TYPE_CHECKING, cast, override

from homeassistant.components import media_source
from homeassistant.components.media_player import (
    MediaPlayerDeviceClass,
    MediaPlayerEntity,
)
from homeassistant.components.media_player.const import (
    MediaPlayerEntityFeature,
    MediaPlayerState,
    MediaType,
)
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
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.restore_state import async_get
from homeassistant.helpers.typing import UNDEFINED
from homeassistant.util.dt import utcnow

if TYPE_CHECKING:
    from collections.abc import Callable
    from datetime import datetime

    from homeassistant.components.media_player.browse_media import BrowseMedia
    from homeassistant.config_entries import ConfigEntry
    from homeassistant.core import (
        Event,
        EventStateChangedData,
        HomeAssistant,
        State,
    )
    from homeassistant.helpers.entity_platform import AddEntitiesCallback
    from homeassistant.helpers.restore_state import RestoreEntity

    from .coordinator import AbstpData, AbstpDataUpdateCoordinator
    from .tracker import ActiveSession, SessionTracker

from .const import (
    ATTR_CURRENT_TIME,
    ATTR_EPISODE_ID,
    ATTR_ITEM_ID,
    ATTR_PLAYBACK_SPEED,
    ATTR_SPEED,
    ATTR_TARGET_AVAILABLE,
    ATTR_TARGET_PLAYER,
    CONF_PLAYER_FRIENDLY_NAMES,
    CONF_TARGET_PLAYERS,
    DEFAULT_NAME,
    DOMAIN,
    LOGGER,
    PREFIX_VIRTUAL_PLAYER,
    SERVICE_PLAY,
    SESSION_STARTUP_TIMEOUT,
)
from .services import resolve_media_metadata


def is_target_player_ready(hass: HomeAssistant, target_entity_id: str) -> bool:
    """Evaluate whether target media player is online and ready for audio streaming."""
    state = hass.states.get(target_entity_id)
    if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
        return False

    if target_entity_id.startswith("media_player.yandex_station"):
        alice_state = state.attributes.get("alice_state")
        assumed_state = state.attributes.get("assumed_state") is True
        if alice_state is None or assumed_state:
            return False

    return True


class AbstpVirtualMediaPlayer(MediaPlayerEntity):
    """Virtual media player entity providing a dedicated facade for a target device."""

    coordinator: AbstpDataUpdateCoordinator
    _tracker: SessionTracker
    _entry: ConfigEntry
    _target_entity_id: str
    _unsub_target_listener: Callable[[], None] | None
    _item_id: str | None
    _episode_id: str | None
    _playback_speed: float | None
    _target_available: bool

    entity_id: str
    registry_entry: er.RegistryEntry | None
    _attr_has_entity_name: bool = False
    _attr_name: str | None
    _attr_translation_key: str | None = None
    _attr_device_class: MediaPlayerDeviceClass | None = MediaPlayerDeviceClass.SPEAKER
    _attr_device_info: DeviceInfo | None = None
    _attr_unique_id: str | None = None
    _attr_supported_features: MediaPlayerEntityFeature = (
        MediaPlayerEntityFeature.PLAY
        | MediaPlayerEntityFeature.STOP
        | MediaPlayerEntityFeature.SEEK
        | MediaPlayerEntityFeature.VOLUME_SET
        | MediaPlayerEntityFeature.VOLUME_MUTE
        | MediaPlayerEntityFeature.PLAY_MEDIA
        | MediaPlayerEntityFeature.BROWSE_MEDIA
    )
    _attr_available: bool = True
    _attr_state: MediaPlayerState | None = MediaPlayerState.IDLE
    _attr_media_title: str | None = None
    _attr_media_artist: str | None = None
    _attr_media_content_type: MediaType | str | None = None
    _attr_entity_picture: str | None = None
    _attr_media_image_url: str | None = None
    _attr_media_image_remotely_accessible: bool = True
    _attr_media_position: int | None = None
    _attr_media_position_updated_at: datetime | None = None
    _attr_media_duration: int | None = None
    _attr_volume_level: float | None = None
    _attr_is_volume_muted: bool | None = None
    _attr_extra_state_attributes: dict[str, object]

    def __init__(
        self,
        coordinator: AbstpDataUpdateCoordinator,
        tracker: SessionTracker,
        entry: ConfigEntry,
        target_entity_id: str,
        friendly_name: str | None = None,
    ) -> None:
        """Initialize the virtual player entity facade."""
        self.coordinator = coordinator
        self._tracker = tracker
        self._entry = entry
        self._target_entity_id = target_entity_id
        self._unsub_target_listener = None
        self._item_id = None
        self._episode_id = None
        self._playback_speed = None
        self._target_available = True
        client_base_url = (
            getattr(coordinator.client, "base_url", None)
            if hasattr(coordinator, "client")
            else None
        )
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=DEFAULT_NAME,
            manufacturer="underhax",
            model="abstp",
            configuration_url=client_base_url,
        )
        self._attr_available = (
            self.coordinator.last_update_success
            and self.coordinator.data.healthy
            and self._target_available
        )

        target_slug = target_entity_id.removeprefix("media_player.")
        self._attr_unique_id = f"{entry.entry_id}_{target_entity_id}"
        self.entity_id = f"media_player.{PREFIX_VIRTUAL_PLAYER}{target_slug}"
        self._attr_has_entity_name = False
        self._attr_name = friendly_name or f"ABSTP {target_slug}"

        self._attr_extra_state_attributes = {
            ATTR_TARGET_PLAYER: self._target_entity_id,
            ATTR_TARGET_AVAILABLE: self._target_available,
            ATTR_ITEM_ID: self._item_id,
            ATTR_EPISODE_ID: self._episode_id,
        }

    @property
    def target_entity_id(self) -> str:
        """Return the bound target physical media player entity ID."""
        return self._target_entity_id

    @property
    def extra_restore_state_data(self) -> None:
        """Return no additional state because restore data is handled explicitly."""
        return None

    @override
    async def async_internal_added_to_hass(self) -> None:
        """Register this entity as a restorable entity in Home Assistant."""
        await super().async_internal_added_to_hass()
        if self.registry_entry is not None and self.name:
            entity_registry = er.async_get(self.hass)
            self.registry_entry = entity_registry.async_update_entity(
                self.entity_id,
                name=self.name,
            )
        async_get(self.hass).async_restore_entity_added(
            cast("RestoreEntity", cast("object", self))
        )

    @override
    async def async_internal_will_remove_from_hass(self) -> None:
        """Unregister this entity as a restorable entity in Home Assistant."""
        state = self.hass.states.get(self.entity_id)
        async_get(self.hass).async_restore_entity_removed(self.entity_id, state, None)
        await super().async_internal_will_remove_from_hass()

    async def async_get_last_state(self) -> State | None:
        """Get the entity state recorded in previous Home Assistant run."""
        stored_state = async_get(self.hass).last_states.get(self.entity_id)
        if stored_state is None:
            return None
        return stored_state.state

    @override
    async def async_added_to_hass(self) -> None:
        """Restore previous state and attach state listeners."""
        await super().async_added_to_hass()

        if last_state := await self.async_get_last_state():
            if last_state.state in (
                MediaPlayerState.PLAYING,
                MediaPlayerState.PAUSED,
                MediaPlayerState.IDLE,
                MediaPlayerState.OFF,
            ):
                self._attr_state = MediaPlayerState(last_state.state)
            attrs = last_state.attributes
            self._attr_media_title = cast("str | None", attrs.get("media_title"))
            self._attr_media_artist = cast("str | None", attrs.get("media_artist"))
            self._attr_entity_picture = cast("str | None", attrs.get("entity_picture"))
            self._attr_media_image_url = cast(
                "str | None", attrs.get("media_image_url")
            )
            raw_duration = attrs.get("media_duration")
            if isinstance(raw_duration, int | float):
                self._attr_media_duration = int(raw_duration)
            raw_position = attrs.get("media_position")
            if isinstance(raw_position, int | float):
                self._attr_media_position = int(raw_position)
            raw_volume = attrs.get("volume_level")
            if isinstance(raw_volume, int | float):
                self._attr_volume_level = float(raw_volume)
            raw_muted = attrs.get("is_volume_muted")
            if isinstance(raw_muted, bool):
                self._attr_is_volume_muted = raw_muted
            raw_item_id = attrs.get(ATTR_ITEM_ID)
            if isinstance(raw_item_id, str):
                self._item_id = raw_item_id
            raw_episode_id = attrs.get(ATTR_EPISODE_ID)
            if isinstance(raw_episode_id, str):
                self._episode_id = raw_episode_id
            raw_playback_speed = attrs.get(ATTR_PLAYBACK_SPEED)
            if isinstance(raw_playback_speed, int | float):
                self._playback_speed = float(raw_playback_speed)

        self.attach_target_listener()
        self.async_on_remove(
            self.coordinator.async_add_listener(self._handle_coordinator_update)
        )
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass,
                f"{DOMAIN}_session_stopped_{self._target_entity_id}",
                self._handle_session_stopped,
            )
        )
        self.async_on_remove(self.detach_target_listener)
        self.update_state_attributes()

    @override
    async def async_will_remove_from_hass(self) -> None:
        """Detach all state listeners before removing from Home Assistant."""
        self.detach_target_listener()
        await super().async_will_remove_from_hass()

    def _handle_coordinator_update(self) -> None:
        """Update cached attributes on coordinator data refresh."""
        self.update_state_attributes()
        self.async_write_ha_state()

    @callback
    def _handle_session_stopped(self) -> None:
        """Update entity state when underlying session terminates."""
        self.update_state_attributes()
        self.async_write_ha_state()

    def attach_target_listener(self) -> None:
        """Attach state change listener for the bound target player."""
        self.detach_target_listener()
        self._unsub_target_listener = async_track_state_change_event(
            self.hass,
            [self._target_entity_id],
            self._handle_target_state_change,
        )

    def detach_target_listener(self) -> None:
        """Detach target player state listener."""
        if self._unsub_target_listener is not None:
            self._unsub_target_listener()
            self._unsub_target_listener = None

    @callback
    def _handle_target_state_change(
        self,
        _event: Event[EventStateChangedData],
    ) -> None:
        """Sync volume and playback state from the physical target device."""
        self.update_state_attributes()
        self.async_write_ha_state()

    def _get_current_session(self) -> ActiveSession | None:
        """Lookup active session associated with this target device."""
        return self._tracker.get_active_session(self._target_entity_id)

    def update_state_attributes(self) -> None:
        """Sync internal attributes with session tracker and target device."""
        session = self._get_current_session()
        target_state: State | None = self.hass.states.get(self._target_entity_id)

        target_raw = target_state.state if target_state else None
        target_is_terminal = target_raw in (
            STATE_PAUSED,
            STATE_IDLE,
            STATE_STANDBY,
            STATE_OFF,
        )

        if session and (
            not target_is_terminal
            or (
                not session.has_played
                and (time.monotonic() - session.start_time) < SESSION_STARTUP_TIMEOUT
            )
        ):
            self._attr_state = MediaPlayerState.PLAYING
            self._item_id = session.item_id
            self._episode_id = session.episode_id
            self._playback_speed = session.speed
            self._attr_media_content_type = (
                MediaType.PODCAST if session.episode_id else MediaType.MUSIC
            )

            title, artist, cover_url = resolve_media_metadata(
                self.hass,
                self.coordinator,
                session.item_id,
                session.episode_id,
            )
            self._attr_media_title = title or session.item_id
            self._attr_media_artist = artist
            self._attr_entity_picture = cover_url
            self._attr_media_image_url = cover_url
            self._attr_media_duration = self._resolve_duration(session)
            self._attr_media_position = int(
                self._tracker.estimate_current_position(self._target_entity_id)
            )
            self._attr_media_position_updated_at = utcnow()
        elif target_state:
            if target_raw == STATE_PLAYING:
                self._attr_state = MediaPlayerState.PLAYING
            elif target_raw in (STATE_PAUSED, STATE_IDLE, STATE_STANDBY):
                self._attr_state = MediaPlayerState.IDLE
            elif target_raw == STATE_OFF:
                self._attr_state = MediaPlayerState.OFF
            else:
                self._attr_state = MediaPlayerState.IDLE
            self._attr_media_position_updated_at = None
        else:
            self._attr_state = MediaPlayerState.IDLE
            self._attr_media_position_updated_at = None

        if target_state:
            vol_attr = target_state.attributes.get("volume_level")
            mute_attr = target_state.attributes.get("is_volume_muted")
            self._attr_volume_level = (
                float(vol_attr) if isinstance(vol_attr, int | float) else None
            )
            self._attr_is_volume_muted = (
                bool(mute_attr) if isinstance(mute_attr, bool) else None
            )

        self._target_available = is_target_player_ready(
            self.hass, self._target_entity_id
        )
        self._attr_available = (
            self.coordinator.last_update_success
            and self.coordinator.data.healthy
            and self._target_available
        )

        attrs: dict[str, object] = {
            ATTR_TARGET_PLAYER: self._target_entity_id,
            ATTR_TARGET_AVAILABLE: self._target_available,
        }
        if self._item_id is not None:
            attrs[ATTR_ITEM_ID] = self._item_id
        if self._episode_id is not None:
            attrs[ATTR_EPISODE_ID] = self._episode_id
        if self._playback_speed is not None:
            attrs[ATTR_PLAYBACK_SPEED] = self._playback_speed
        self._attr_extra_state_attributes = attrs

    def _resolve_duration(self, session: ActiveSession) -> int | None:
        """Find total duration for the currently tracked media item."""
        for book in self.coordinator.data.books:
            if book.id == session.item_id:
                return int(book.duration)
        for progress_item in self.coordinator.data.in_progress:
            if progress_item.id == session.item_id:
                return int(progress_item.duration)
        return None

    @override
    async def async_media_play(self) -> None:
        """Start or resume audio playback on the virtual player facade."""
        target_id = self._target_entity_id

        item_id = self._item_id
        episode_id = self._episode_id
        position = float(self._attr_media_position or 0)

        if not item_id:
            coordinator_data: AbstpData | None = getattr(self.coordinator, "data", None)
            if coordinator_data and coordinator_data.in_progress:
                first_in_progress = coordinator_data.in_progress[0]
                item_id = first_in_progress.id
                episode_id = first_in_progress.episode_id
                position = float(first_in_progress.current_time)
            elif coordinator_data and coordinator_data.books:
                first_book = coordinator_data.books[0]
                item_id = first_book.id
                position = float(first_book.progress)

        if not item_id:
            LOGGER.warning(
                "No media item selected or in progress to play on %s", target_id
            )
            return

        self._item_id = item_id
        self._episode_id = episode_id
        service_data: dict[str, object] = {
            ATTR_ENTITY_ID: target_id,
            ATTR_ITEM_ID: item_id,
        }
        if episode_id:
            service_data[ATTR_EPISODE_ID] = episode_id
        if self._playback_speed is not None:
            service_data[ATTR_SPEED] = self._playback_speed
        if position > 0:
            service_data[ATTR_CURRENT_TIME] = position

        _ = await self.hass.services.async_call(
            DOMAIN,
            SERVICE_PLAY,
            service_data,
            blocking=True,
            context=self._context,
        )

    @override
    async def async_media_pause(self) -> None:
        """Pause playback by delegating to stop."""
        await self.async_media_stop()

    @override
    async def async_media_play_pause(self) -> None:
        """Play or stop playback depending on current state."""
        if self._attr_state == MediaPlayerState.PLAYING:
            await self.async_media_stop()
        else:
            await self.async_media_play()

    @override
    async def async_media_stop(self) -> None:
        """Stop playback on target player and terminate active proxy session."""
        target_id = self._target_entity_id
        session = self._get_current_session()
        current_pos: float = 0.0
        if session:
            current_pos = self._tracker.estimate_current_position(target_id)
        elif self._attr_media_position:
            current_pos = float(self._attr_media_position)

        target_state = self.hass.states.get(target_id)
        features_num = (
            target_state.attributes.get("supported_features", 0) if target_state else 0
        )
        features = MediaPlayerEntityFeature(int(features_num))

        if bool(features & MediaPlayerEntityFeature.STOP):
            stop_service = "media_stop"
        elif (
            bool(features & MediaPlayerEntityFeature.PAUSE)
            and target_state
            and target_state.state != STATE_PAUSED
        ):
            stop_service = "media_pause"
        else:
            stop_service = None

        if stop_service:
            try:
                _ = await self.hass.services.async_call(
                    "media_player",
                    stop_service,
                    {ATTR_ENTITY_ID: target_id},
                    blocking=True,
                    context=self._context,
                )
            except HomeAssistantError as err:
                LOGGER.warning("Failed to stop target player %s: %s", target_id, err)

        _ = await self._tracker.async_stop_session_for_entity(target_id)
        self._attr_state = MediaPlayerState.IDLE
        if current_pos > 0:
            self._attr_media_position = int(current_pos)
        self._attr_media_position_updated_at = None
        self.async_write_ha_state()

    @override
    async def async_media_seek(self, position: float) -> None:
        """Seek to a specific timestamp on the active session and target device."""
        target_id = self._target_entity_id
        session = self._get_current_session()
        item_id = session.item_id if session else self._item_id
        episode_id = session.episode_id if session else self._episode_id
        self._attr_media_position = int(position)
        self._attr_media_position_updated_at = utcnow()
        self.async_write_ha_state()

        if item_id and (
            session is not None or self._attr_state == MediaPlayerState.PLAYING
        ):
            service_data: dict[str, object] = {
                ATTR_ENTITY_ID: target_id,
                ATTR_ITEM_ID: item_id,
                ATTR_CURRENT_TIME: position,
            }
            if episode_id:
                service_data[ATTR_EPISODE_ID] = episode_id
            _ = await self.hass.services.async_call(
                DOMAIN,
                SERVICE_PLAY,
                service_data,
                blocking=True,
                context=self._context,
            )
        elif not item_id:
            _ = await self.hass.services.async_call(
                "media_player",
                "media_seek",
                {ATTR_ENTITY_ID: self._target_entity_id, "seek_position": position},
                blocking=True,
                context=self._context,
            )

    @override
    async def async_set_volume_level(self, volume: float) -> None:
        """Set volume level on the target physical player."""
        _ = await self.hass.services.async_call(
            "media_player",
            "volume_set",
            {ATTR_ENTITY_ID: self._target_entity_id, "volume_level": volume},
            blocking=True,
            context=self._context,
        )

    @override
    async def async_mute_volume(self, mute: bool) -> None:
        """Toggle mute state on the target physical player."""
        _ = await self.hass.services.async_call(
            "media_player",
            "volume_mute",
            {ATTR_ENTITY_ID: self._target_entity_id, "is_volume_muted": mute},
            blocking=True,
            context=self._context,
        )

    @override
    async def async_browse_media(
        self,
        media_content_type: str | None = None,
        media_content_id: str | None = None,
    ) -> BrowseMedia:
        """Browse media sources exposing Audiobookshelf library."""
        _ = media_content_type
        return await media_source.async_browse_media(
            self.hass,
            media_content_id,
        )

    @override
    async def async_play_media(
        self,
        media_type: MediaType | str,
        media_id: str,
        **kwargs: object,
    ) -> None:
        """Play media on target player resolving media-source URIs or items."""
        _ = kwargs
        target_id = self._target_entity_id

        item_id: str | None = None
        episode_id: str | None = None

        if media_id.startswith("media-source://abstp_controller/"):
            path = media_id.removeprefix("media-source://abstp_controller/")
            parts = path.split("/")
            if parts[0] in ("book", "in_progress") and len(parts) > 1:
                item_id = parts[1]
                if len(parts) > 2:
                    episode_id = parts[2]
            elif parts[0] == "episode" and len(parts) > 2:
                item_id = parts[1]
                episode_id = parts[2]
        elif not media_source.is_media_source_id(media_id) and not media_id.startswith(
            ("http://", "https://")
        ):
            item_id = media_id

        if item_id:
            self._item_id = item_id
            self._episode_id = episode_id
            service_data: dict[str, object] = {
                ATTR_ENTITY_ID: target_id,
                ATTR_ITEM_ID: item_id,
            }
            if episode_id:
                service_data[ATTR_EPISODE_ID] = episode_id
            if self._playback_speed is not None:
                service_data[ATTR_SPEED] = self._playback_speed
            _ = await self.hass.services.async_call(
                DOMAIN,
                SERVICE_PLAY,
                service_data,
                blocking=True,
                context=self._context,
            )
            return

        if media_source.is_media_source_id(media_id):
            sourced_media = await media_source.async_resolve_media(
                self.hass, media_id, self.entity_id
            )
            media_id = sourced_media.url
            media_type = sourced_media.mime_type

        _ = await self.hass.services.async_call(
            "media_player",
            "play_media",
            {
                ATTR_ENTITY_ID: self._target_entity_id,
                "media_content_id": media_id,
                "media_content_type": media_type,
            },
            blocking=True,
            context=self._context,
        )


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Register dedicated virtual media player facade entities for config entry."""
    domain_data = cast("dict[str, dict[str, object]]", hass.data.get(DOMAIN, {}))
    data = domain_data.get(entry.entry_id)
    if not data or "coordinator" not in data or "tracker" not in data:
        return

    coordinator = cast("AbstpDataUpdateCoordinator", data["coordinator"])
    tracker = cast("SessionTracker", data["tracker"])

    options_dict = cast("Mapping[str, object]", entry.options)
    data_dict = cast("Mapping[str, object]", entry.data)
    raw_targets = options_dict.get(
        CONF_TARGET_PLAYERS,
        data_dict.get(CONF_TARGET_PLAYERS, []),
    )
    raw_target_list: list[object]
    if isinstance(raw_targets, list):
        raw_target_list = cast("list[object]", raw_targets)
    elif isinstance(raw_targets, str):
        raw_target_list = [raw_targets]
    else:
        raw_target_list = []

    prefix = f"media_player.{PREFIX_VIRTUAL_PLAYER}"
    configured_player_ids = [str(item).strip() for item in raw_target_list]
    target_players: list[str] = [
        entity_id
        for entity_id in configured_player_ids
        if (
            entity_id.startswith("media_player.")
            and not entity_id.startswith(prefix)
            and "yandex_station_intents" not in entity_id.lower()
        )
    ]
    raw_names = options_dict.get(
        CONF_PLAYER_FRIENDLY_NAMES,
        data_dict.get(CONF_PLAYER_FRIENDLY_NAMES, {}),
    )
    friendly_names: Mapping[str, str] = (
        cast("Mapping[str, str]", raw_names) if isinstance(raw_names, Mapping) else {}
    )

    entities: list[AbstpVirtualMediaPlayer] = []
    active_unique_ids: set[str] = set()
    for target_id in target_players:
        target_name = friendly_names.get(target_id)
        if not target_name:
            state = hass.states.get(target_id)
            if state:
                raw_friendly = state.attributes.get("friendly_name")
                if isinstance(raw_friendly, str) and raw_friendly.strip():
                    target_name = raw_friendly.strip()

        player = AbstpVirtualMediaPlayer(
            coordinator=coordinator,
            tracker=tracker,
            entry=entry,
            target_entity_id=target_id,
            friendly_name=target_name,
        )
        if player.unique_id is not None:
            active_unique_ids.add(player.unique_id)
        entities.append(player)

    dev_reg = dr.async_get(hass)
    device_entry = dev_reg.async_get_device(identifiers={(DOMAIN, entry.entry_id)})
    device_id = device_entry.id if device_entry else None

    ent_reg = er.async_get(hass)
    existing_entries = er.async_entries_for_config_entry(ent_reg, entry.entry_id)
    for reg_entry in existing_entries:
        if reg_entry.domain == "media_player":
            if reg_entry.unique_id and reg_entry.unique_id not in active_unique_ids:
                LOGGER.info(
                    "Removing obsolete virtual media player entity: %s (unique_id: %s)",
                    reg_entry.entity_id,
                    reg_entry.unique_id,
                )
                ent_reg.async_remove(reg_entry.entity_id)
            else:
                matching_player = next(
                    (p for p in entities if p.unique_id == reg_entry.unique_id), None
                )
                new_device_id = (
                    device_id
                    if device_id is not None and reg_entry.device_id != device_id
                    else UNDEFINED
                )
                new_has_entity_name = False if reg_entry.has_entity_name else UNDEFINED
                new_original_name = (
                    matching_player.name
                    if matching_player
                    and matching_player.name
                    and reg_entry.original_name != matching_player.name
                    else UNDEFINED
                )
                new_name = (
                    matching_player.name
                    if matching_player
                    and matching_player.name
                    and reg_entry.name != matching_player.name
                    else UNDEFINED
                )
                if (
                    new_device_id is not UNDEFINED
                    or new_has_entity_name is not UNDEFINED
                    or new_original_name is not UNDEFINED
                    or new_name is not UNDEFINED
                ):
                    _ = ent_reg.async_update_entity(
                        reg_entry.entity_id,
                        device_id=new_device_id,
                        has_entity_name=new_has_entity_name,
                        original_name=new_original_name,
                        name=new_name,
                    )

    async_add_entities(entities, update_before_add=True)
