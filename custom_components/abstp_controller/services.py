"""Service actions for Audiobookshelf Transcoder Proxy Controller."""

from ipaddress import ip_address
from typing import TYPE_CHECKING, cast
from urllib.parse import urlsplit

import voluptuous as vol
from homeassistant.components.media_player.const import MediaPlayerEntityFeature
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.network import NoURLAvailableError, get_url

if TYPE_CHECKING:
    from collections.abc import Mapping

    from homeassistant.core import HomeAssistant, ServiceCall

    from .coordinator import AbstpData, AbstpDataUpdateCoordinator
    from .tracker import SessionTracker

from .const import (
    ATTR_CURRENT_TIME,
    ATTR_EPISODE_ID,
    ATTR_ITEM_ID,
    ATTR_SESSION_ID,
    ATTR_SPEED,
    ATTR_TARGET_PLAYER,
    CONF_DEFAULT_SPEED,
    CONF_STREAM_PROXY_MODE,
    DEFAULT_SPEED,
    DOMAIN,
    LOGGER,
    MAX_SPEED,
    MIN_SPEED,
    SERVICE_PLAY,
    SERVICE_REFRESH_LIBRARY,
    SERVICE_SET_SPEED,
    SERVICE_STOP,
    STREAM_PROXY_MODE_ALWAYS,
    STREAM_PROXY_MODE_AUTO,
    STREAM_PROXY_MODE_NEVER,
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


def clean_header_value(value: str | None) -> str:
    """Normalize whitespace and strip control characters below ascii 32."""
    if not value:
        return ""
    cleaned = "".join(
        " " if ord(char) < 32 and char != "\t" else char for char in value
    )
    return " ".join(cleaned.split())


def resolve_media_metadata(
    hass: HomeAssistant,
    coordinator: AbstpDataUpdateCoordinator,
    item_id: str,
    episode_id: str | None = None,
) -> tuple[str, str, str | None]:
    """Resolve display title, artist, and cover URL from catalog metadata."""
    raw_title = ""
    raw_author = ""
    raw_narrator = ""
    raw_ep_title = ""
    media_type = "book"
    has_cover = False
    item_found = False

    coordinator_data: AbstpData | None = getattr(coordinator, "data", None)
    if coordinator_data is not None:
        for inp in coordinator_data.in_progress:
            if inp.id == item_id and inp.episode_id == episode_id:
                raw_title = inp.title
                raw_author = inp.author
                raw_narrator = inp.narrator or ""
                media_type = inp.media_type
                has_cover = bool(inp.cover_url)
                item_found = True
                if episode_id and inp.episode_id == episode_id and inp.episode_title:
                    raw_ep_title = inp.episode_title
                break
        else:
            for book in coordinator_data.books:
                if book.id == item_id:
                    raw_title = book.title
                    raw_author = book.author
                    raw_narrator = book.narrator or ""
                    media_type = "book"
                    has_cover = bool(book.cover_url)
                    item_found = True
                    break
            else:
                for podcast in coordinator_data.podcasts:
                    if podcast.id == item_id:
                        raw_title = podcast.title
                        raw_author = podcast.author
                        media_type = "podcast"
                        has_cover = bool(podcast.cover_url)
                        item_found = True
                        break

    title = clean_header_value(raw_title)
    author = clean_header_value(raw_author)
    narrator = clean_header_value(raw_narrator)
    ep_title = clean_header_value(raw_ep_title)

    is_podcast = media_type == "podcast" or bool(episode_id)

    if is_podcast:
        resolved_title = ep_title or title or "Podcast Episode"
        resolved_artist = title if (title and title != resolved_title) else author
    else:
        if title and author and narrator:
            resolved_title = f"{title} • {author}"
            resolved_artist = narrator
        elif title and narrator:
            resolved_title = title
            resolved_artist = narrator
        elif title and author:
            resolved_title = title
            resolved_artist = author
        elif title:
            resolved_title = title
            resolved_artist = ""
        elif author:
            resolved_title = author
            resolved_artist = ""
        else:
            resolved_title = "Audiobook"
            resolved_artist = ""

    cover_url: str | None = None
    if has_cover or not item_found:
        try:
            base_url = get_url(hass)
            cover_url = f"{base_url}/api/abstp_controller/cover/{item_id}"
        except NoURLAvailableError:
            cover_url = f"/api/abstp_controller/cover/{item_id}"

    return resolved_title, resolved_artist, cover_url


def is_loopback_url(url: str) -> bool:
    """Return whether a URL host resolves exclusively to the local machine."""
    try:
        hostname = urlsplit(url).hostname
    except ValueError:
        return False

    if hostname is None:
        return False
    if hostname.lower() == "localhost":
        return True

    try:
        return ip_address(hostname).is_loopback
    except ValueError:
        return False


def resolve_stream_proxy_mode(
    options: Mapping[str, object], data: Mapping[str, object]
) -> str:
    """Return a supported stream mode while preserving legacy entry compatibility."""
    mode = str(
        options.get(
            CONF_STREAM_PROXY_MODE,
            data.get(CONF_STREAM_PROXY_MODE, STREAM_PROXY_MODE_AUTO),
        )
    )
    if mode in (
        STREAM_PROXY_MODE_AUTO,
        STREAM_PROXY_MODE_ALWAYS,
        STREAM_PROXY_MODE_NEVER,
    ):
        return mode
    return STREAM_PROXY_MODE_AUTO


def should_proxy_stream(
    proxy_mode: str, backend_url: str, target_entity_id: str
) -> bool:
    """Select HA proxying only when the physical player cannot reach abstp directly."""
    if proxy_mode == STREAM_PROXY_MODE_ALWAYS:
        return True
    if proxy_mode == STREAM_PROXY_MODE_NEVER:
        return False
    return is_loopback_url(backend_url) and not target_entity_id.startswith(
        "media_player.yandex_station"
    )


def resolve_proxied_stream_url(
    hass: HomeAssistant, session_id: str, token: str = ""
) -> str:
    """Construct the reachable Home Assistant stream proxy URL for an audio session."""
    query = f"?token={token}" if token else ""
    try:
        base_url = get_url(hass)
    except NoURLAvailableError:
        return f"/api/abstp_controller/stream/{session_id}.aac{query}"
    else:
        return f"{base_url}/api/abstp_controller/stream/{session_id}.aac{query}"


def build_play_media_service_data(
    hass: HomeAssistant,
    coordinator: AbstpDataUpdateCoordinator,
    entity_id: str,
    stream_url: str,
    item_id: str,
    episode_id: str | None = None,
) -> dict[str, object]:
    """Construct play_media payload enriched with catalog metadata."""
    title, artist, cover_url = resolve_media_metadata(
        hass, coordinator, item_id, episode_id
    )

    metadata: dict[str, object] = {
        "metadataType": 0,
        "title": title,
    }
    if artist:
        metadata["subtitle"] = artist
        metadata["artist"] = artist
    if cover_url:
        metadata["images"] = [{"url": cover_url}]

    extra: dict[str, object] = {
        "title": title,
        "metadata": metadata,
    }
    if cover_url:
        extra["thumb"] = cover_url

    return {
        "entity_id": entity_id,
        "media_content_id": stream_url,
        "media_content_type": "audio/aac",
        "extra": extra,
    }


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
        LOGGER.debug(
            "Play request: context=%s targets=%s item=%s episode=%s position=%s",
            call.context.id,
            entity_ids,
            item_id,
            episode_id,
            current_time,
        )

        fallback_speed = DEFAULT_SPEED
        proxy_mode = STREAM_PROXY_MODE_AUTO
        if coordinator.config_entry is not None:
            opts = cast("Mapping[str, object]", coordinator.config_entry.options)
            entry_data = cast("Mapping[str, object]", coordinator.config_entry.data)
            raw_speed = opts.get(
                CONF_DEFAULT_SPEED,
                entry_data.get(CONF_DEFAULT_SPEED, DEFAULT_SPEED),
            )
            fallback_speed = float(str(raw_speed))
            proxy_mode = resolve_stream_proxy_mode(opts, entry_data)

        speed_obj = call_data.get(ATTR_SPEED, fallback_speed)
        speed = float(str(speed_obj))

        for entity_id in entity_ids:
            state = hass.states.get(entity_id)
            target_id = entity_id
            if state and ATTR_TARGET_PLAYER in state.attributes:
                raw_target = cast("object", state.attributes[ATTR_TARGET_PLAYER])
                if isinstance(raw_target, str) and raw_target:
                    target_id = raw_target

            active_session = tracker.get_active_session(target_id)
            if active_session:
                LOGGER.debug(
                    "Stopping existing: context=%s target=%s session=%s",
                    call.context.id,
                    target_id,
                    active_session.session_id,
                )
                try:
                    _ = await hass.services.async_call(
                        "media_player",
                        "media_stop",
                        {ATTR_ENTITY_ID: target_id},
                        blocking=False,
                    )
                except HomeAssistantError as err:
                    LOGGER.warning(
                        "Failed to stop target %s before new play: %s",
                        target_id,
                        err,
                    )
                _ = await tracker.async_stop_session_for_entity(target_id)
                LOGGER.debug(
                    "Existing session stopped before play: context=%s target=%s",
                    call.context.id,
                    target_id,
                )

            LOGGER.debug(
                "Starting proxy session: context=%s target=%s item=%s position=%s",
                call.context.id,
                target_id,
                item_id,
                current_time,
            )
            session = await coordinator.client.async_start_session(
                item_id=item_id,
                episode_id=episode_id,
                speed=speed,
                current_time=current_time,
            )

            tracker.register_session(
                entity_id=target_id,
                session_id=session.session_id,
                item_id=item_id,
                episode_id=episode_id,
                speed=speed,
                initial_position=session.current_time,
                stream_url=session.stream_url,
            )
            token = tracker.get_stream_token(session.session_id) or ""
            use_proxy = should_proxy_stream(
                proxy_mode,
                str(coordinator.client.base_url),
                target_id,
            )
            stream_url = (
                resolve_proxied_stream_url(hass, session.session_id, token)
                if use_proxy
                else session.stream_url
            )
            LOGGER.debug(
                "Audio stream route: mode=%s target=%s route=%s",
                proxy_mode,
                target_id,
                "home_assistant_proxy" if use_proxy else "direct_abstp",
            )
            service_data = build_play_media_service_data(
                hass=hass,
                coordinator=coordinator,
                entity_id=target_id,
                stream_url=stream_url,
                item_id=item_id,
                episode_id=episode_id,
            )

            _ = await hass.services.async_call(
                "media_player",
                "play_media",
                service_data,
                blocking=False,
            )
            LOGGER.debug(
                "Playback media play dispatched: context=%s target=%s session=%s",
                call.context.id,
                target_id,
                session.session_id,
            )

        await coordinator.async_request_refresh()

    async def handle_stop(call: ServiceCall) -> None:
        """Handle stopping playback and terminating transcoding sessions."""
        components = _get_entry_components(hass)
        if not components:
            return

        coordinator, tracker = components
        call_data = cast("dict[str, object]", call.data)
        entity_ids = cast("list[str] | None", call_data.get("entity_id"))
        session_id = cast("str | None", call_data.get(ATTR_SESSION_ID))
        LOGGER.debug(
            "Playback stop request: context=%s entities=%s session=%s",
            call.context.id,
            entity_ids,
            session_id,
        )

        if entity_ids:
            for entity_id in entity_ids:
                state = hass.states.get(entity_id)
                target_id = entity_id
                if state and ATTR_TARGET_PLAYER in state.attributes:
                    raw_target = cast("object", state.attributes[ATTR_TARGET_PLAYER])
                    if isinstance(raw_target, str) and raw_target:
                        target_id = raw_target

                active_session = tracker.get_active_session(target_id)
                LOGGER.debug(
                    "Stopping target: context=%s entity=%s target=%s session=%s",
                    call.context.id,
                    entity_id,
                    target_id,
                    active_session.session_id if active_session else None,
                )
                _ = await tracker.async_stop_session_for_entity(target_id)
                LOGGER.debug(
                    "Proxy session stop completed: context=%s target=%s",
                    call.context.id,
                    target_id,
                )
                target_state = hass.states.get(target_id)
                features = (
                    cast("int", target_state.attributes.get("supported_features", 0))
                    if target_state
                    else MediaPlayerEntityFeature.STOP
                )
                service = (
                    "media_stop"
                    if (features & MediaPlayerEntityFeature.STOP)
                    else (
                        "media_pause"
                        if (features & MediaPlayerEntityFeature.PAUSE)
                        else None
                    )
                )
                if service:
                    _ = await hass.services.async_call(
                        "media_player",
                        service,
                        {"entity_id": target_id},
                        blocking=False,
                    )
                    LOGGER.debug(
                        "Physical stop: context=%s target=%s service=%s blocking=%s",
                        call.context.id,
                        target_id,
                        service,
                        False,
                    )

        if session_id:
            _ = await coordinator.client.async_stop_session(session_id)
            _ = await tracker.async_stop_session_by_id(session_id)

        await coordinator.async_request_refresh()

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
            stream_url=new_session.stream_url,
        )
        token = tracker.get_stream_token(new_session.session_id) or ""
        config_entry = coordinator.config_entry
        proxy_mode = (
            resolve_stream_proxy_mode(
                cast("Mapping[str, object]", config_entry.options),
                cast("Mapping[str, object]", config_entry.data),
            )
            if config_entry is not None
            else STREAM_PROXY_MODE_AUTO
        )
        use_proxy = should_proxy_stream(
            proxy_mode,
            str(coordinator.client.base_url),
            entity_id,
        )
        stream_url = (
            resolve_proxied_stream_url(hass, new_session.session_id, token)
            if use_proxy
            else new_session.stream_url
        )
        LOGGER.debug(
            "Audio stream route: mode=%s target=%s route=%s",
            proxy_mode,
            entity_id,
            "home_assistant_proxy" if use_proxy else "direct_abstp",
        )
        service_data = build_play_media_service_data(
            hass=hass,
            coordinator=coordinator,
            entity_id=entity_id,
            stream_url=stream_url,
            item_id=item_id,
            episode_id=episode_id,
        )

        _ = await hass.services.async_call(
            "media_player",
            "play_media",
            service_data,
            blocking=True,
        )

        await coordinator.async_request_refresh()

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
