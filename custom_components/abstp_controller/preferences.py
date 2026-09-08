"""Persistent card preferences for the Audiobookshelf Transcoder Proxy integration."""

import asyncio
from typing import TYPE_CHECKING, cast

from homeassistant.helpers.storage import Store

from .const import DOMAIN

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

_STORAGE_VERSION = 1
_STORAGE_KEY = f"{DOMAIN}.card_preferences"


class CardPreferenceStore:
    """Persist card selections independently for each Home Assistant user."""

    _store: Store[dict[str, object]]
    _data: dict[str, dict[str, str]] | None
    _lock: asyncio.Lock

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize persistent card preference storage."""
        self._store = Store(hass, _STORAGE_VERSION, _STORAGE_KEY)
        self._data = None
        self._lock = asyncio.Lock()

    async def async_get(self, user_id: str, card_id: str) -> str | None:
        """Return a saved player selection for a user and card."""
        async with self._lock:
            data = await self._async_get_data()
            return data.get(user_id, {}).get(card_id)

    async def async_set(
        self,
        user_id: str,
        card_id: str,
        selected_player: str | None,
    ) -> None:
        """Save or remove a card selection and persist the updated mapping."""
        async with self._lock:
            data = await self._async_get_data()
            user_preferences = data.setdefault(user_id, {})
            if selected_player is None:
                _ = user_preferences.pop(card_id, None)
                if not user_preferences:
                    _ = data.pop(user_id, None)
            else:
                user_preferences[card_id] = selected_player
            await self._store.async_save({"users": data})

    async def async_remove(self) -> None:
        """Remove all persisted card preferences when the integration is deleted."""
        async with self._lock:
            self._data = {}
            await self._store.async_remove()

    async def _async_get_data(self) -> dict[str, dict[str, str]]:
        """Load and validate the storage payload once per Home Assistant run."""
        if self._data is not None:
            return self._data

        raw_data = await self._store.async_load()
        self._data = self._parse_data(raw_data)
        return self._data

    @staticmethod
    def _parse_data(raw_data: dict[str, object] | None) -> dict[str, dict[str, str]]:
        """Convert persisted untyped storage data into validated preferences."""
        if not isinstance(raw_data, dict):
            return {}
        raw_users = raw_data.get("users")
        if not isinstance(raw_users, dict):
            return {}

        typed_users = cast("dict[object, object]", raw_users)
        users: dict[str, dict[str, str]] = {}
        for raw_user_id, raw_preferences in typed_users.items():
            if not isinstance(raw_user_id, str) or not isinstance(
                raw_preferences, dict
            ):
                continue
            typed_preferences = cast("dict[object, object]", raw_preferences)
            preferences = {
                raw_card_id: raw_player_id
                for raw_card_id, raw_player_id in typed_preferences.items()
                if isinstance(raw_card_id, str) and isinstance(raw_player_id, str)
            }
            if preferences:
                users[raw_user_id] = preferences
        return users


def async_get_card_preference_store(hass: HomeAssistant) -> CardPreferenceStore:
    """Return the Home Assistant scoped card preference store."""
    domain_data = cast("dict[str, object]", hass.data.setdefault(DOMAIN, {}))
    existing_store = domain_data.get("card_preference_store")
    if isinstance(existing_store, CardPreferenceStore):
        return existing_store

    store = CardPreferenceStore(hass)
    domain_data["card_preference_store"] = store
    return store
