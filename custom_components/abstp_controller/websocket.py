"""WebSocket API handlers for the Audiobookshelf Transcoder Proxy integration."""

from typing import TYPE_CHECKING, cast

import voluptuous as vol
from homeassistant.components.websocket_api import async_register_command
from homeassistant.components.websocket_api.decorators import (
    async_response,
    websocket_command,
)
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError

if TYPE_CHECKING:
    from homeassistant.components.websocket_api.connection import ActiveConnection
    from homeassistant.core import HomeAssistant

    from .coordinator import AbstpDataUpdateCoordinator
    from .tracker import SessionTracker

from .api import AbstpApiError
from .const import DOMAIN, LOGGER, MAX_SPEED, MIN_SPEED

WS_TYPE_GET_LIBRARY = f"{DOMAIN}/get_library"
WS_TYPE_GET_EPISODES = f"{DOMAIN}/get_episodes"
WS_TYPE_GET_CHAPTERS = f"{DOMAIN}/get_chapters"
WS_TYPE_START_SESSION = f"{DOMAIN}/start_session"
WS_TYPE_STOP_SESSION = f"{DOMAIN}/stop_session"


def _get_active_coordinator(
    hass: HomeAssistant,
) -> AbstpDataUpdateCoordinator | None:
    """Retrieve the first loaded data update coordinator instance."""
    domain_data = cast("dict[str, object] | None", hass.data.get(DOMAIN, {}))
    if domain_data:
        for data in domain_data.values():
            if isinstance(data, dict) and "coordinator" in data:
                return cast("AbstpDataUpdateCoordinator", data["coordinator"])
    return None


def _get_active_tracker(hass: HomeAssistant) -> SessionTracker | None:
    """Retrieve the first loaded session tracker instance."""
    domain_data = cast("dict[str, object] | None", hass.data.get(DOMAIN, {}))
    if domain_data:
        for data in domain_data.values():
            if isinstance(data, dict) and "tracker" in data:
                return cast("SessionTracker", data["tracker"])
    return None


@callback
def async_register_websocket_handlers(hass: HomeAssistant) -> None:
    """Register custom websocket commands for frontend dashboard communication."""

    @websocket_command({vol.Required("type"): WS_TYPE_GET_LIBRARY})
    @async_response
    async def ws_get_library(
        hass_inst: HomeAssistant,
        connection: ActiveConnection,
        msg: dict[str, object],
    ) -> None:
        """Handle request for catalog media items."""
        coordinator = _get_active_coordinator(hass_inst)
        msg_id = cast("int", msg["id"])
        if not coordinator:
            connection.send_error(
                msg_id, "not_loaded", "Integration not ready or loaded"
            )
            return

        books_data = [
            {
                "id": b.id,
                "title": b.title,
                "author": b.author,
                "narrator": b.narrator,
                "media_type": b.media_type,
                "cover_url": f"/api/abstp_controller/cover/{b.id}"
                if b.cover_url
                else "",
                "duration": b.duration,
                "progress": b.progress,
                "is_finished": b.is_finished,
            }
            for b in coordinator.data.books
        ]
        podcasts_data = [
            {
                "id": p.id,
                "title": p.title,
                "author": p.author,
                "media_type": p.media_type,
                "cover_url": f"/api/abstp_controller/cover/{p.id}"
                if p.cover_url
                else "",
                "duration": p.duration,
                "progress": p.progress,
                "is_finished": p.is_finished,
            }
            for p in coordinator.data.podcasts
        ]
        in_progress_data = [
            {
                "id": item.id,
                "title": item.title,
                "author": item.author,
                "media_type": item.media_type,
                "cover_url": f"/api/abstp_controller/cover/{item.id}"
                if item.cover_url
                else "",
                "duration": item.duration,
                "progress": item.progress,
                "current_time": item.current_time,
                "episode_id": item.episode_id,
                "episode_title": item.episode_title,
                "narrator": item.narrator,
            }
            for item in coordinator.data.in_progress
        ]

        tracker = _get_active_tracker(hass_inst)
        active_sessions_data: dict[str, dict[str, object]] = {}
        if tracker:
            for entity_id, sess in tracker.get_all_active_sessions().items():
                active_sessions_data[entity_id] = {
                    "entity_id": sess.entity_id,
                    "session_id": sess.session_id,
                    "item_id": sess.item_id,
                    "episode_id": sess.episode_id,
                    "speed": sess.speed,
                    "current_time": tracker.estimate_current_position(entity_id),
                }

        connection.send_result(
            msg_id,
            {
                "healthy": coordinator.data.healthy,
                "books": books_data,
                "podcasts": podcasts_data,
                "in_progress": in_progress_data,
                "active_sessions": active_sessions_data,
            },
        )

    @websocket_command(
        {
            vol.Required("type"): WS_TYPE_GET_EPISODES,
            vol.Required("podcast_id"): str,
        }
    )
    @async_response
    async def ws_get_episodes(
        hass_inst: HomeAssistant,
        connection: ActiveConnection,
        msg: dict[str, object],
    ) -> None:
        """Handle request for podcast episodes list."""
        coordinator = _get_active_coordinator(hass_inst)
        msg_id = cast("int", msg["id"])
        if not coordinator:
            connection.send_error(
                msg_id, "not_loaded", "Integration not ready or loaded"
            )
            return

        podcast_id = str(msg["podcast_id"])
        try:
            episodes = await coordinator.client.async_get_podcast_episodes(podcast_id)
            episodes_data = [
                {
                    "id": ep.id,
                    "title": ep.title,
                    "season": ep.season,
                    "episode": ep.episode,
                    "published_at": ep.published_at,
                    "duration": ep.duration,
                    "progress": ep.progress,
                    "is_finished": ep.is_finished,
                }
                for ep in episodes
            ]
            connection.send_result(msg_id, {"episodes": episodes_data})
        except (AbstpApiError, HomeAssistantError) as err:
            LOGGER.exception("Failed to fetch episodes for %s", podcast_id)
            connection.send_error(msg_id, "fetch_failed", str(err))

    @websocket_command(
        {
            vol.Required("type"): WS_TYPE_GET_CHAPTERS,
            vol.Required("book_id"): str,
        }
    )
    @async_response
    async def ws_get_chapters(
        hass_inst: HomeAssistant,
        connection: ActiveConnection,
        msg: dict[str, object],
    ) -> None:
        """Handle request for audiobook chapters list."""
        coordinator = _get_active_coordinator(hass_inst)
        msg_id = cast("int", msg["id"])
        if not coordinator:
            connection.send_error(
                msg_id, "not_loaded", "Integration not ready or loaded"
            )
            return

        book_id = str(msg["book_id"])
        try:
            chapters = await coordinator.client.async_get_book_chapters(book_id)
            chapters_data = [
                {
                    "id": ch.id,
                    "title": ch.title,
                    "start": ch.start,
                    "end": ch.end,
                    "duration": ch.duration,
                }
                for ch in chapters
            ]
            connection.send_result(msg_id, {"chapters": chapters_data})
        except (AbstpApiError, HomeAssistantError) as err:
            LOGGER.exception("Failed to fetch chapters for %s", book_id)
            connection.send_error(msg_id, "fetch_failed", str(err))

    @websocket_command(
        {
            vol.Required("type"): WS_TYPE_START_SESSION,
            vol.Required("item_id"): str,
            vol.Optional("episode_id"): vol.Any(str, None),
            vol.Optional("speed", default=1.0): vol.All(
                vol.Coerce(float), vol.Range(min=MIN_SPEED, max=MAX_SPEED)
            ),
            vol.Optional("current_time", default=0.0): vol.Coerce(float),
        }
    )
    @async_response
    async def ws_start_session(
        hass_inst: HomeAssistant,
        connection: ActiveConnection,
        msg: dict[str, object],
    ) -> None:
        """Handle starting an audio streaming session."""
        coordinator = _get_active_coordinator(hass_inst)
        msg_id = cast("int", msg["id"])
        if not coordinator:
            connection.send_error(
                msg_id, "not_loaded", "Integration not ready or loaded"
            )
            return

        try:
            session = await coordinator.client.async_start_session(
                item_id=str(msg["item_id"]),
                episode_id=cast("str | None", msg.get("episode_id")),
                speed=float(cast("float | int", msg.get("speed", 1.0))),
                current_time=float(cast("float | int", msg.get("current_time", 0.0))),
            )
            connection.send_result(
                msg_id,
                {
                    "session_id": session.session_id,
                    "stream_url": session.stream_url,
                    "current_time": session.current_time,
                    "duration": session.duration,
                },
            )
        except (AbstpApiError, HomeAssistantError) as err:
            LOGGER.exception("Failed to start session via websocket")
            connection.send_error(msg_id, "session_start_failed", str(err))

    @websocket_command(
        {
            vol.Required("type"): WS_TYPE_STOP_SESSION,
            vol.Required("session_id"): str,
        }
    )
    @async_response
    async def ws_stop_session(
        hass_inst: HomeAssistant,
        connection: ActiveConnection,
        msg: dict[str, object],
    ) -> None:
        """Handle terminating an audio streaming session."""
        tracker = _get_active_tracker(hass_inst)
        coordinator = _get_active_coordinator(hass_inst)
        session_id = str(msg["session_id"])
        msg_id = cast("int", msg["id"])

        try:
            if tracker:
                _ = await tracker.async_stop_session_by_id(session_id)
            elif coordinator:
                _ = await coordinator.client.async_stop_session(session_id)
            connection.send_result(msg_id, {"status": "stopped"})
        except (AbstpApiError, HomeAssistantError) as err:
            LOGGER.exception("Failed to stop session %s", session_id)
            connection.send_error(msg_id, "session_stop_failed", str(err))

    async_register_command(hass, ws_get_library)
    async_register_command(hass, ws_get_episodes)
    async_register_command(hass, ws_get_chapters)
    async_register_command(hass, ws_start_session)
    async_register_command(hass, ws_stop_session)
