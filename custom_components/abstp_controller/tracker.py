"""Session lifecycle tracker and media player state listener for abstp."""

import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from homeassistant.const import (
    STATE_IDLE,
    STATE_OFF,
    STATE_PAUSED,
    STATE_STANDBY,
    STATE_UNAVAILABLE,
)
from homeassistant.helpers.event import async_track_state_change_event

if TYPE_CHECKING:
    from collections.abc import Callable

    from homeassistant.core import Event, EventStateChangedData, HomeAssistant

    from .api import AbstpApiClient

from .api import AbstpApiError
from .const import LOGGER

TERMINAL_PLAYER_STATES = {
    STATE_IDLE,
    STATE_OFF,
    STATE_PAUSED,
    STATE_STANDBY,
    STATE_UNAVAILABLE,
}


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
    has_played: bool = False


class SessionTracker:
    """Tracks active sessions, synchronizes playback offsets, and stops idle streams."""

    hass: HomeAssistant
    _client: AbstpApiClient
    _sessions: dict[str, ActiveSession]
    _unsub_listeners: dict[str, Callable[[], None]]

    def __init__(self, hass: HomeAssistant, client: AbstpApiClient) -> None:
        """Initialize tracker with Home Assistant reference and API client."""
        self.hass = hass
        self._client = client
        self._sessions = {}
        self._unsub_listeners = {}

    def get_active_session(self, entity_id: str) -> ActiveSession | None:
        """Return the active session descriptor for a specific player entity."""
        return self._sessions.get(entity_id)

    def get_all_active_sessions(self) -> dict[str, ActiveSession]:
        """Return a snapshot map of all currently monitored player sessions."""
        return dict(self._sessions)

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
    ) -> None:
        """Register a new active stream session and attach a state observer."""
        self._cleanup_listener(entity_id)

        self._sessions[entity_id] = ActiveSession(
            entity_id=entity_id,
            session_id=session_id,
            item_id=item_id,
            episode_id=episode_id,
            speed=speed,
            initial_position=initial_position,
            start_time=time.monotonic(),
            has_played=False,
        )

        unsub = async_track_state_change_event(
            self.hass, [entity_id], self._handle_player_state_change
        )
        self._unsub_listeners[entity_id] = unsub

    def _cleanup_listener(self, entity_id: str) -> None:
        """Remove state listener registration for a specific entity."""
        if unsub := self._unsub_listeners.pop(entity_id, None):
            unsub()

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
        if state == "playing":
            sess.has_played = True
            return

        grace_expired = (time.monotonic() - sess.start_time) > 10.0
        if (sess.has_played or grace_expired) and state in TERMINAL_PLAYER_STATES:
            LOGGER.debug(
                "Player %s entered state %s, stopping abstp session %s",
                entity_id,
                state,
                sess.session_id,
            )
            _ = await self.async_stop_session_for_entity(entity_id)

    async def async_stop_session_for_entity(self, entity_id: str) -> bool:
        """Stop and synchronize an active session for a specific player."""
        session = self._sessions.pop(entity_id, None)
        self._cleanup_listener(entity_id)

        if session is None:
            return False

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
