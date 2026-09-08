"""Unit tests for persistent card preferences."""

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

from custom_components.abstp_controller.const import DOMAIN
from custom_components.abstp_controller.preferences import (
    CardPreferenceStore,
    async_get_card_preference_store,
)


async def test_card_preference_store_persists_and_removes_selection(
    hass: HomeAssistant,
) -> None:
    """Test saving a selection and removing it from persistent storage."""
    storage_load = AsyncMock(return_value=None)
    storage_save = AsyncMock()
    storage = MagicMock()
    storage.async_load = storage_load
    storage.async_save = storage_save

    with patch(
        "custom_components.abstp_controller.preferences.Store",
        return_value=storage,
    ):
        preference_store = CardPreferenceStore(hass)
        assert await preference_store.async_get("user_1", "card_1") is None

        await preference_store.async_set(
            "user_1",
            "card_1",
            "media_player.abstp_speaker",
        )
        assert (
            await preference_store.async_get("user_1", "card_1")
            == "media_player.abstp_speaker"
        )

        await preference_store.async_set("user_1", "card_1", None)
        assert await preference_store.async_get("user_1", "card_1") is None

    assert storage_load.await_count == 1
    assert storage_save.await_count == 2
    storage_save.assert_awaited_with({"users": {}})


@pytest.mark.parametrize(
    "stored_data",
    [
        None,
        {},
        {"users": None},
        {"users": {"user_1": None}},
        {"users": {"user_1": {"card_1": 1}}},
    ],
)
async def test_card_preference_store_ignores_invalid_storage(
    hass: HomeAssistant,
    stored_data: object,
) -> None:
    """Test malformed persisted data does not become a card preference."""
    storage = MagicMock()
    storage.async_load = AsyncMock(return_value=stored_data)

    with patch(
        "custom_components.abstp_controller.preferences.Store",
        return_value=storage,
    ):
        preference_store = CardPreferenceStore(hass)
        assert await preference_store.async_get("user_1", "card_1") is None


async def test_card_preference_store_removes_storage_file(hass: HomeAssistant) -> None:
    """Test removing the integration deletes its persistent preference store."""
    storage = MagicMock()
    storage_remove = AsyncMock()
    storage.configure_mock(async_remove=storage_remove)

    with patch(
        "custom_components.abstp_controller.preferences.Store",
        return_value=storage,
    ):
        preference_store = CardPreferenceStore(hass)
        await preference_store.async_remove()

    storage_remove.assert_awaited_once_with()


async def test_async_get_card_preference_store_reuses_home_assistant_instance(
    hass: HomeAssistant,
) -> None:
    """Test Home Assistant stores one preference store per integration instance."""
    first_store = async_get_card_preference_store(hass)
    second_store = async_get_card_preference_store(hass)

    assert first_store is second_store
    assert hass.data[DOMAIN]["card_preference_store"] is first_store
