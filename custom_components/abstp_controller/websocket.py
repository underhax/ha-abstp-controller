"""WebSocket API handlers for the Audiobookshelf Transcoder Proxy integration."""

from typing import TYPE_CHECKING, cast

import voluptuous as vol
from homeassistant.components.websocket_api import async_register_command
from homeassistant.components.websocket_api.decorators import (
    async_response,
    websocket_command,
)
from homeassistant.components.websocket_api.messages import event_message
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv

if TYPE_CHECKING:
    from collections.abc import Mapping

    from homeassistant.components.websocket_api.connection import ActiveConnection

    from .coordinator import AbstpDataUpdateCoordinator
    from .tracker import SessionTracker

from .api import AbstpApiError
from .const import (
    CONF_TARGET_PLAYERS,
    DOMAIN,
    LOGGER,
    MAX_SPEED,
    MIN_SPEED,
    PREFIX_VIRTUAL_PLAYER,
    SOURCE_BROWSER_ID,
)
from .preferences import async_get_card_preference_store

WS_TYPE_GET_LIBRARY = f"{DOMAIN}/get_library"
WS_TYPE_GET_EPISODES = f"{DOMAIN}/get_episodes"
WS_TYPE_GET_CHAPTERS = f"{DOMAIN}/get_chapters"
WS_TYPE_START_SESSION = f"{DOMAIN}/start_session"
WS_TYPE_STOP_SESSION = f"{DOMAIN}/stop_session"
WS_TYPE_SUBSCRIBE_CARD_PREFERENCE = f"{DOMAIN}/subscribe_card_preference"
WS_TYPE_SET_CARD_PREFERENCE = f"{DOMAIN}/set_card_preference"
CARD_ID_SCHEMA = vol.All(str, vol.Length(min=1, max=255))
CARD_PREFERENCE_SUBSCRIPTIONS_KEY = "card_preference_subscriptions"


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


def _get_virtual_player_ids(hass: HomeAssistant) -> list[str]:
    """Return virtual media player IDs in integration configuration order."""
    current_ids = {
        entity_id
        for entity_id in hass.states.async_entity_ids("media_player")
        if entity_id.startswith(f"media_player.{PREFIX_VIRTUAL_PLAYER}")
    }
    ordered_ids: list[str] = []
    seen_ids: set[str] = set()
    for entry in hass.config_entries.async_entries(DOMAIN):
        options = cast("Mapping[str, object]", entry.options)
        entry_data = cast("Mapping[str, object]", entry.data)
        raw_targets = options.get(
            CONF_TARGET_PLAYERS,
            entry_data.get(CONF_TARGET_PLAYERS, []),
        )
        if not isinstance(raw_targets, list):
            continue
        target_list = cast("list[object]", raw_targets)
        for raw_target in target_list:
            target_id = str(raw_target).strip()
            if target_id == SOURCE_BROWSER_ID:
                if "" not in seen_ids:
                    ordered_ids.append("")
                    seen_ids.add("")
                continue
            if target_id.startswith("media_player."):
                target_slug = target_id.removeprefix("media_player.")
                virtual_id = f"media_player.{PREFIX_VIRTUAL_PLAYER}{target_slug}"
            else:
                continue
            if virtual_id in current_ids and virtual_id not in seen_ids:
                ordered_ids.append(virtual_id)
                seen_ids.add(virtual_id)
    ordered_ids.extend(sorted(current_ids - seen_ids))
    return ordered_ids


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

        await coordinator.async_request_refresh()

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
            vol.Required("type"): WS_TYPE_SUBSCRIBE_CARD_PREFERENCE,
            vol.Required("card_id"): CARD_ID_SCHEMA,
        }
    )
    @async_response
    async def ws_subscribe_card_preference(
        hass_inst: HomeAssistant,
        connection: ActiveConnection,
        msg: dict[str, object],
    ) -> None:
        """Subscribe a card instance to synchronized player selection updates."""
        msg_id = cast("int", msg["id"])
        card_id = str(msg["card_id"])
        user_id = connection.user.id
        preference_store = async_get_card_preference_store(hass_inst)
        selected_player = await preference_store.async_get(user_id, card_id)
        domain_data = cast("dict[str, object]", hass_inst.data.setdefault(DOMAIN, {}))
        subscription_registry = cast(
            "dict[tuple[int, str, str], int]",
            domain_data.setdefault(CARD_PREFERENCE_SUBSCRIPTIONS_KEY, {}),
        )
        subscription_key = (id(connection), user_id, card_id)
        previous_msg_id = subscription_registry.get(subscription_key)
        if previous_msg_id is not None:
            previous_unsubscribe = connection.subscriptions.pop(previous_msg_id, None)
            if previous_unsubscribe:
                previous_unsubscribe()
            LOGGER.debug(
                "Replaced duplicate subscription: connection=%s user=%s card=%s",
                id(connection),
                user_id,
                card_id,
            )
        LOGGER.debug(
            "Card preference subscription: connection=%s user=%s card=%s selected=%s",
            id(connection),
            user_id,
            card_id,
            selected_player,
        )

        @callback
        def handle_preference_event(event: Event[dict[str, object]]) -> None:
            """Forward matching preference changes to this WebSocket client."""
            event_data = event.data
            if (
                event_data.get("user_id") != user_id
                or event_data.get("card_id") != card_id
            ):
                return
            LOGGER.debug(
                "Card preference event: connection=%s user=%s card=%s selected=%s",
                id(connection),
                user_id,
                card_id,
                event_data.get("selected_player"),
            )
            connection.send_message(
                event_message(
                    msg_id,
                    {
                        "card_id": card_id,
                        "selected_player": event_data.get("selected_player"),
                        "available_players": _get_virtual_player_ids(hass_inst),
                        "available_players_known": True,
                    },
                )
            )

        bus_unsubscribe = hass_inst.bus.async_listen(
            "abstp_controller_card_preference_changed",
            handle_preference_event,
        )

        @callback
        def unsubscribe() -> None:
            """Remove the preference listener and its registry entry."""
            bus_unsubscribe()
            if subscription_registry.get(subscription_key) == msg_id:
                _ = subscription_registry.pop(subscription_key, None)

        connection.subscriptions[msg_id] = unsubscribe
        subscription_registry[subscription_key] = msg_id
        connection.send_result(msg_id, {"card_id": card_id})
        connection.send_message(
            event_message(
                msg_id,
                {
                    "card_id": card_id,
                    "selected_player": selected_player,
                    "available_players": _get_virtual_player_ids(hass_inst),
                    "available_players_known": True,
                },
            )
        )

    @websocket_command(
        {
            vol.Required("type"): WS_TYPE_SET_CARD_PREFERENCE,
            vol.Required("card_id"): CARD_ID_SCHEMA,
            vol.Optional("selected_player", default=None): vol.Any(
                None, "", cv.entity_id
            ),
        }
    )
    @async_response
    async def ws_set_card_preference(
        hass_inst: HomeAssistant,
        connection: ActiveConnection,
        msg: dict[str, object],
    ) -> None:
        """Persist and broadcast a card player selection update."""
        msg_id = cast("int", msg["id"])
        card_id = str(msg["card_id"])
        selected_player_raw = msg.get("selected_player")
        selected_player = (
            str(selected_player_raw) if isinstance(selected_player_raw, str) else None
        )
        LOGGER.debug(
            "Card preference update: connection=%s user=%s card=%s selected=%s",
            id(connection),
            connection.user.id,
            card_id,
            selected_player,
        )
        if selected_player and not selected_player.startswith(
            f"media_player.{PREFIX_VIRTUAL_PLAYER}"
        ):
            connection.send_error(
                msg_id,
                "invalid_player",
                "Card preferences support only virtual media players",
            )
            return

        user_id = connection.user.id
        preference_store = async_get_card_preference_store(hass_inst)
        await preference_store.async_set(user_id, card_id, selected_player)
        available_players = _get_virtual_player_ids(hass_inst)
        event_data = {
            "user_id": user_id,
            "card_id": card_id,
            "selected_player": selected_player,
        }
        hass_inst.bus.async_fire(
            "abstp_controller_card_preference_changed",
            event_data,
        )
        connection.send_result(
            msg_id,
            {
                "card_id": card_id,
                "selected_player": selected_player,
                "available_players": available_players,
                "available_players_known": True,
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
            LOGGER.debug(
                "Browser start: connection=%s item=%s episode=%s position=%s",
                id(connection),
                msg["item_id"],
                msg.get("episode_id"),
                msg.get("current_time", 0.0),
            )
            session = await coordinator.client.async_start_session(
                item_id=str(msg["item_id"]),
                episode_id=cast("str | None", msg.get("episode_id")),
                speed=float(cast("float | int", msg.get("speed", 1.0))),
                current_time=float(cast("float | int", msg.get("current_time", 0.0))),
            )
            tracker = _get_active_tracker(hass_inst)
            if tracker:
                tracker.register_session(
                    entity_id=SOURCE_BROWSER_ID,
                    session_id=session.session_id,
                    item_id=str(msg["item_id"]),
                    episode_id=cast("str | None", msg.get("episode_id")),
                    speed=float(cast("float | int", msg.get("speed", 1.0))),
                    initial_position=session.current_time,
                )
            _ = hass_inst.async_create_task(coordinator.async_request_refresh())
            LOGGER.debug(
                "Browser session started: connection=%s session=%s item=%s",
                id(connection),
                session.session_id,
                msg["item_id"],
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
            LOGGER.debug(
                "Browser session stop request: connection=%s session=%s",
                id(connection),
                session_id,
            )
            if tracker:
                _ = await tracker.async_stop_session_by_id(session_id)
            elif coordinator:
                _ = await coordinator.client.async_stop_session(session_id)
            if coordinator:
                await coordinator.async_request_refresh()
            LOGGER.debug(
                "Browser session stopped: connection=%s session=%s",
                id(connection),
                session_id,
            )
            connection.send_result(msg_id, {"status": "stopped"})
        except (AbstpApiError, HomeAssistantError) as err:
            LOGGER.exception("Failed to stop session %s", session_id)
            connection.send_error(msg_id, "session_stop_failed", str(err))

    async_register_command(hass, ws_get_library)
    async_register_command(hass, ws_subscribe_card_preference)
    async_register_command(hass, ws_set_card_preference)
    async_register_command(hass, ws_get_episodes)
    async_register_command(hass, ws_get_chapters)
    async_register_command(hass, ws_start_session)
    async_register_command(hass, ws_stop_session)
