"""Service actions for Audiobookshelf Transcoder Proxy Controller."""

from typing import TYPE_CHECKING, cast

import voluptuous as vol
from homeassistant.helpers import config_validation as cv

if TYPE_CHECKING:
    from collections.abc import Mapping

    from homeassistant.core import HomeAssistant, ServiceCall

    from .coordinator import AbstpDataUpdateCoordinator
    from .tracker import SessionTracker

from .const import (
    ATTR_CURRENT_TIME,
    ATTR_EPISODE_ID,
    ATTR_ITEM_ID,
    ATTR_SESSION_ID,
    ATTR_SPEED,
    CONF_DEFAULT_SPEED,
    DEFAULT_SPEED,
    DOMAIN,
    LOGGER,
    MAX_SPEED,
    MIN_SPEED,
    SERVICE_PLAY,
    SERVICE_REFRESH_LIBRARY,
    SERVICE_SET_SPEED,
    SERVICE_STOP,
)


def _validate_entity_ids(value: object) -> list[str]:
    """Validate and normalize entity identifiers."""
    if isinstance(value, str):
        return [cv.entity_id(value)]
    if isinstance(value, list):
        return [cv.entity_id(item) for item in cast("list[object]", value)]
    msg = f"Expected str or list of str, got {type(value)}"
    raise vol.Invalid(msg)


PLAY_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): _validate_entity_ids,
        vol.Required(ATTR_ITEM_ID): cv.string,
        vol.Optional(ATTR_EPISODE_ID): cv.string,
        vol.Optional(ATTR_SPEED): vol.All(
            vol.Coerce(float), vol.Range(min=MIN_SPEED, max=MAX_SPEED)
        ),
        vol.Optional(ATTR_CURRENT_TIME, default=0.0): vol.Coerce(float),
    }
)

STOP_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_id"): _validate_entity_ids,
        vol.Optional(ATTR_SESSION_ID): cv.string,
    }
)

SET_SPEED_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required(ATTR_SPEED): vol.All(
            vol.Coerce(float), vol.Range(min=MIN_SPEED, max=MAX_SPEED)
        ),
    }
)

REFRESH_SCHEMA = vol.Schema({})


def _get_entry_components(
    hass: HomeAssistant,
) -> tuple[AbstpDataUpdateCoordinator, SessionTracker] | None:
    """Retrieve the active coordinator and tracker from loaded domain entries."""
    domain_data = cast("dict[str, object] | None", hass.data.get(DOMAIN))
    if not domain_data:
        return None

    for data in domain_data.values():
        if isinstance(data, dict) and "coordinator" in data and "tracker" in data:
            return (
                cast("AbstpDataUpdateCoordinator", data["coordinator"]),
                cast("SessionTracker", data["tracker"]),
            )
    return None


async def async_setup_services(hass: HomeAssistant) -> None:
    """Register all abstp custom service actions."""

    async def handle_play(call: ServiceCall) -> None:
        """Handle starting playback on specified media players."""
        components = _get_entry_components(hass)
        if not components:
            LOGGER.error("No active abstp integration entries loaded")
            return

        coordinator, tracker = components
        call_data = cast("dict[str, object]", call.data)
        entity_ids = cast("list[str]", call_data["entity_id"])
        item_id = str(call_data[ATTR_ITEM_ID])
        episode_id = cast("str | None", call_data.get(ATTR_EPISODE_ID))
        current_time_obj = call_data.get(ATTR_CURRENT_TIME, 0.0)
        current_time = float(str(current_time_obj))

        fallback_speed = DEFAULT_SPEED
        if coordinator.config_entry is not None:
            opts = cast("Mapping[str, object]", coordinator.config_entry.options)
            entry_data = cast("Mapping[str, object]", coordinator.config_entry.data)
            raw_speed = opts.get(
                CONF_DEFAULT_SPEED,
                entry_data.get(CONF_DEFAULT_SPEED, DEFAULT_SPEED),
            )
            fallback_speed = float(str(raw_speed))

        speed_obj = call_data.get(ATTR_SPEED, fallback_speed)
        speed = float(str(speed_obj))

        for entity_id in entity_ids:
            if tracker.get_active_session(entity_id):
                _ = await tracker.async_stop_session_for_entity(entity_id)

            session = await coordinator.client.async_start_session(
                item_id=item_id,
                episode_id=episode_id,
                speed=speed,
                current_time=current_time,
            )

            tracker.register_session(
                entity_id=entity_id,
                session_id=session.session_id,
                item_id=item_id,
                episode_id=episode_id,
                speed=speed,
                initial_position=session.current_time,
            )

            _ = await hass.services.async_call(
                "media_player",
                "play_media",
                {
                    "entity_id": entity_id,
                    "media_content_id": session.stream_url,
                    "media_content_type": "music",
                },
                blocking=False,
            )

    async def handle_stop(call: ServiceCall) -> None:
        """Handle stopping playback and terminating transcoding sessions."""
        components = _get_entry_components(hass)
        if not components:
            return

        coordinator, tracker = components
        call_data = cast("dict[str, object]", call.data)
        entity_ids = cast("list[str] | None", call_data.get("entity_id"))
        session_id = cast("str | None", call_data.get(ATTR_SESSION_ID))

        if entity_ids:
            for entity_id in entity_ids:
                _ = await tracker.async_stop_session_for_entity(entity_id)
                _ = await hass.services.async_call(
                    "media_player",
                    "media_stop",
                    {"entity_id": entity_id},
                    blocking=False,
                )

        if session_id:
            _ = await coordinator.client.async_stop_session(session_id)
            _ = await tracker.async_stop_session_by_id(session_id)

    async def handle_set_speed(call: ServiceCall) -> None:
        """Handle dynamic on-the-fly speed switching during playback."""
        components = _get_entry_components(hass)
        if not components:
            return

        coordinator, tracker = components
        call_data = cast("dict[str, object]", call.data)
        entity_id = str(call_data["entity_id"])
        speed_obj = call_data[ATTR_SPEED]
        new_speed = float(str(speed_obj))

        active_session = tracker.get_active_session(entity_id)
        if not active_session:
            LOGGER.warning("No active session found for entity %s", entity_id)
            return

        current_position = tracker.estimate_current_position(entity_id)
        item_id = active_session.item_id
        episode_id = active_session.episode_id

        _ = await tracker.async_stop_session_for_entity(entity_id)

        new_session = await coordinator.client.async_start_session(
            item_id=item_id,
            episode_id=episode_id,
            speed=new_speed,
            current_time=current_position,
        )

        tracker.register_session(
            entity_id=entity_id,
            session_id=new_session.session_id,
            item_id=item_id,
            episode_id=episode_id,
            speed=new_speed,
            initial_position=current_position,
        )

        _ = await hass.services.async_call(
            "media_player",
            "play_media",
            {
                "entity_id": entity_id,
                "media_content_type": "music",
                "media_content_id": new_session.stream_url,
            },
            blocking=True,
        )

    async def handle_refresh(call: ServiceCall) -> None:
        """Handle reloading library catalog from abstp."""
        _ = call
        domain_data = cast("dict[str, object] | None", hass.data.get(DOMAIN, {}))
        if domain_data:
            for data in domain_data.values():
                if isinstance(data, dict) and "coordinator" in data:
                    coord = cast("AbstpDataUpdateCoordinator", data["coordinator"])
                    await coord.async_request_refresh()

    hass.services.async_register(DOMAIN, SERVICE_PLAY, handle_play, schema=PLAY_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_STOP, handle_stop, schema=STOP_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_SET_SPEED, handle_set_speed, schema=SET_SPEED_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_REFRESH_LIBRARY,
        handle_refresh,
        schema=REFRESH_SCHEMA,
    )


async def async_unload_services(hass: HomeAssistant) -> None:
    """Unregister all abstp custom service actions."""
    if not hass.data.get(DOMAIN):
        hass.services.async_remove(DOMAIN, SERVICE_PLAY)
        hass.services.async_remove(DOMAIN, SERVICE_STOP)
        hass.services.async_remove(DOMAIN, SERVICE_SET_SPEED)
        hass.services.async_remove(DOMAIN, SERVICE_REFRESH_LIBRARY)
