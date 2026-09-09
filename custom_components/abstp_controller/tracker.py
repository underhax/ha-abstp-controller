"""Session lifecycle tracker and media player state listener for abstp."""

import secrets
import time
from dataclasses import dataclass
from functools import partial
from typing import TYPE_CHECKING

from homeassistant.components.media_player.const import MediaPlayerEntityFeature
from homeassistant.const import (
    ATTR_ENTITY_ID,
    STATE_IDLE,
    STATE_OFF,
    STATE_PAUSED,
    STATE_PLAYING,
    STATE_STANDBY,
    STATE_UNAVAILABLE,
)
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_call_later, async_track_state_change_event

if TYPE_CHECKING:
    from collections.abc import Callable
    from datetime import datetime

    from homeassistant.core import Event, EventStateChangedData, HomeAssistant

    from .api import AbstpApiClient

from .api import AbstpApiError
from .const import (
    DOMAIN,
    LOGGER,
    PREFIX_VIRTUAL_PLAYER,
    SESSION_STARTUP_TIMEOUT,
)

TERMINAL_PLAYER_STATES = {
    STATE_IDLE,
    STATE_OFF,
    STATE_PAUSED,
    STATE_STANDBY,
    STATE_UNAVAILABLE,
}


def is_allowed_player(hass: HomeAssistant, entity_id: str) -> bool:
    """Check if an entity is an allowed media player."""
    if not entity_id:
        return False

    if not entity_id.startswith("media_player."):
        return False

    prefix = f"media_player.{PREFIX_VIRTUAL_PLAYER}"
    if entity_id.startswith(prefix):
        return True

    lower_id = entity_id.lower()
    if "yandex_station_intents" in lower_id:
        return False

    state = hass.states.get(entity_id)
    if state is None:
        return True

    features = state.attributes.get("supported_features")
    return isinstance(features, int) and bool(
        features & MediaPlayerEntityFeature.PLAY_MEDIA
    )


@dataclass(slots=True)
class ActiveSession:
    """Represents an active audio transcoding stream associated with a player."""

    entity_id: str
    session_id: str
    item_id: str
    episode_id: str | None
    speed: float
    initial_position: float
    start_time: float
    stream_url: str = ""
    stream_token: str = ""
    has_played: bool = False
    awaiting_initial_stop: bool = False
    backend_terminated: bool = False


class SessionTracker:
    """Tracks active sessions, synchronizes playback offsets, and stops idle streams."""

    hass: HomeAssistant
    _client: AbstpApiClient
    _sessions: dict[str, ActiveSession]
    _unsub_listeners: dict[str, Callable[[], None]]
    _unsub_startup_timeouts: dict[str, Callable[[], None]]
    _stream_urls: dict[str, str]
    _stream_tokens: dict[str, str]
    _backend_terminated_sessions: set[str]

    def __init__(self, hass: HomeAssistant, client: AbstpApiClient) -> None:
        """Initialize tracker with Home Assistant reference and API client."""
        self.hass = hass
        self._client = client
        self._sessions = {}
        self._unsub_listeners = {}
        self._unsub_startup_timeouts = {}
        self._stream_urls = {}
        self._stream_tokens = {}
        self._backend_terminated_sessions = set()

    def get_active_session(self, entity_id: str) -> ActiveSession | None:
        """Return the active session descriptor for a specific player entity."""
        return self._sessions.get(entity_id)

    def get_all_active_sessions(self) -> dict[str, ActiveSession]:
        """Return a snapshot map of all currently monitored player sessions."""
        return dict(self._sessions)

    def get_session_by_id(self, session_id: str) -> ActiveSession | None:
        """Find an active session descriptor by proxy session identifier."""
        for sess in self._sessions.values():
            if sess.session_id == session_id:
                return sess
        return None

    def get_stream_url(self, session_id: str) -> str | None:
        """Retrieve the internal backend stream URL for an active session."""
        return self._stream_urls.get(session_id)

    def get_stream_token(self, session_id: str) -> str | None:
        """Retrieve the security token required for client stream authorization."""
        return self._stream_tokens.get(session_id)

    def register_stream_token(self, session_id: str, token: str) -> None:
        """Register a known security token for an active stream session."""
        self._stream_tokens[session_id] = token

    def validate_stream_token(self, session_id: str, token: str | None) -> bool:
        """Verify client token against registered session token."""
        expected = self._stream_tokens.get(session_id)
        if not expected or not token:
            return False
        return secrets.compare_digest(token, expected)

    def register_stream_url(
        self, session_id: str, stream_url: str, token: str = ""
    ) -> None:
        """Register an internal backend stream URL and security token."""
        self._stream_urls[session_id] = stream_url
        if not token:
            token = secrets.token_hex(16)
        self._stream_tokens[session_id] = token
        self._backend_terminated_sessions.discard(session_id)

    def unregister_stream_url(self, session_id: str) -> None:
        """Remove a registered internal backend stream URL."""
        _ = self._stream_urls.pop(session_id, None)
        _ = self._stream_tokens.pop(session_id, None)

    def notify_stream_closed(self, session_id: str) -> None:
        """Record socket disconnect indicating proxy backend has cleaned up session."""
        self._backend_terminated_sessions.add(session_id)
        for sess in self._sessions.values():
            if sess.session_id == session_id:
                sess.backend_terminated = True

    def is_backend_terminated(self, session_id: str) -> bool:
        """Check whether the backend proxy session is already terminated."""
        return session_id in self._backend_terminated_sessions

    def estimate_current_position(self, entity_id: str) -> float:
        """Estimate the current audio playback timestamp for an active session."""
        session = self._sessions.get(entity_id)
        if not session:
            return 0.0
        elapsed_real = time.monotonic() - session.start_time
        return session.initial_position + (elapsed_real * session.speed)

    def register_session(
        self,
        entity_id: str,
        session_id: str,
        item_id: str,
        episode_id: str | None,
        speed: float,
        initial_position: float,
        stream_url: str = "",
        stream_token: str = "",
    ) -> None:
        """Register a new active stream session and attach a state observer."""
        self._cleanup_listener(entity_id)
        self._cleanup_startup_timeout(entity_id)

        target_state = self.hass.states.get(entity_id)
        already_playing = (
            target_state is not None and target_state.state == STATE_PLAYING
        )

        if not stream_token:
            stream_token = secrets.token_hex(16)

        self._sessions[entity_id] = ActiveSession(
            entity_id=entity_id,
            session_id=session_id,
            item_id=item_id,
            episode_id=episode_id,
            speed=speed,
            initial_position=initial_position,
            start_time=time.monotonic(),
            stream_url=stream_url,
            stream_token=stream_token,
            has_played=False,
            awaiting_initial_stop=already_playing,
            backend_terminated=False,
        )
        if stream_url:
            self._stream_urls[session_id] = stream_url
        self._stream_tokens[session_id] = stream_token
        self._backend_terminated_sessions.discard(session_id)

        unsub = async_track_state_change_event(
            self.hass, [entity_id], self._handle_player_state_change
        )
        self._unsub_listeners[entity_id] = unsub
        self._unsub_startup_timeouts[entity_id] = async_call_later(
            self.hass,
            SESSION_STARTUP_TIMEOUT,
            partial(self._async_handle_startup_timeout, entity_id, session_id),
        )

    def _cleanup_listener(self, entity_id: str) -> None:
        """Remove state listener registration for a specific entity."""
        if unsub := self._unsub_listeners.pop(entity_id, None):
            unsub()

    def _cleanup_startup_timeout(self, entity_id: str) -> None:
        """Cancel the startup watchdog associated with a player session."""
        if unsub := self._unsub_startup_timeouts.pop(entity_id, None):
            unsub()

    async def _async_handle_startup_timeout(
        self,
        entity_id: str,
        session_id: str,
        _now: datetime,
    ) -> None:
        """End sessions that never reached playback after the startup grace period."""
        session = self._sessions.get(entity_id)
        target_state = self.hass.states.get(entity_id)
        if (
            session is None
            or session.session_id != session_id
            or session.has_played
            or target_state is None
            or target_state.state not in TERMINAL_PLAYER_STATES
        ):
            return

        LOGGER.warning(
            "Player %s did not start session %s within %s seconds",
            entity_id,
            session_id,
            SESSION_STARTUP_TIMEOUT,
        )
        _ = await self.async_stop_session_for_entity(entity_id)

    async def _handle_player_state_change(
        self, event: Event[EventStateChangedData]
    ) -> None:
        """Evaluate player state changes to trigger proxy session termination."""
        entity_id = event.data.get("entity_id")
        new_state = event.data.get("new_state")

        if not entity_id or entity_id not in self._sessions:
            return

        sess = self._sessions[entity_id]
        if new_state is None:
            return

        state = new_state.state
        if sess.awaiting_initial_stop:
            if state == STATE_PLAYING:
                return
            sess.awaiting_initial_stop = False

        if state == STATE_PLAYING:
            sess.has_played = True
            self._cleanup_startup_timeout(entity_id)
            return

        grace_expired = (time.monotonic() - sess.start_time) > SESSION_STARTUP_TIMEOUT
        if (sess.has_played or grace_expired) and state in TERMINAL_PLAYER_STATES:
            LOGGER.debug(
                "Player %s entered state %s, stopping abstp session %s",
                entity_id,
                state,
                sess.session_id,
            )
            if state == STATE_PAUSED:
                try:
                    _ = await self.hass.services.async_call(
                        "media_player",
                        "media_stop",
                        {ATTR_ENTITY_ID: entity_id},
                        blocking=False,
                    )
                except HomeAssistantError as err:
                    LOGGER.warning(
                        "Failed to send media_stop to %s on pause: %s",
                        entity_id,
                        err,
                    )
            _ = await self.async_stop_session_for_entity(entity_id)

    async def async_stop_session_for_entity(self, entity_id: str) -> bool:
        """Stop and synchronize an active session for a specific player."""
        session = self._sessions.pop(entity_id, None)
        self._cleanup_listener(entity_id)
        self._cleanup_startup_timeout(entity_id)

        if session is None:
            return False

        _ = self._stream_urls.pop(session.session_id, None)
        _ = self._stream_tokens.pop(session.session_id, None)
        already_terminated = (
            session.backend_terminated
            or session.session_id in self._backend_terminated_sessions
        )
        self._backend_terminated_sessions.discard(session.session_id)
        async_dispatcher_send(self.hass, f"{DOMAIN}_session_stopped_{entity_id}")

        if already_terminated:
            return True

        try:
            return await self._client.async_stop_session(session.session_id)
        except AbstpApiError as err:
            LOGGER.warning(
                "Failed to stop session %s on proxy: %s", session.session_id, err
            )
            return False

    async def async_stop_session_by_id(self, session_id: str) -> bool:
        """Find and terminate an active session by proxy session identifier."""
        target_entity = None
        for entity_id, sess in self._sessions.items():
            if sess.session_id == session_id:
                target_entity = entity_id
                break

        if target_entity:
            return await self.async_stop_session_for_entity(target_entity)

        _ = self._stream_urls.pop(session_id, None)
        _ = self._stream_tokens.pop(session_id, None)
        if session_id in self._backend_terminated_sessions:
            self._backend_terminated_sessions.discard(session_id)
            return True

        try:
            return await self._client.async_stop_session(session_id)
        except AbstpApiError as err:
            LOGGER.warning("Failed to stop session %s on proxy: %s", session_id, err)
            return False

    async def async_stop_all(self) -> None:
        """Terminate all active playback sessions upon integration shutdown."""
        active_entities = list(self._sessions.keys())
        for entity_id in active_entities:
            _ = await self.async_stop_session_for_entity(entity_id)
        self._stream_urls.clear()
        self._stream_tokens.clear()
        self._backend_terminated_sessions.clear()
