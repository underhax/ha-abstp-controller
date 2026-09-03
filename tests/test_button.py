"""Unit tests for button entity."""

from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock

from homeassistant.config_entries import ConfigEntry

if TYPE_CHECKING:
    from collections.abc import Iterable

    from homeassistant.core import HomeAssistant
    from homeassistant.helpers.entity import Entity

from custom_components.abstp_controller.api import AbstpApiClient
from custom_components.abstp_controller.button import (
    AbstpRefreshLibraryButton,
    async_setup_entry,
)
from custom_components.abstp_controller.const import DOMAIN
from custom_components.abstp_controller.coordinator import (
    AbstpData,
    AbstpDataUpdateCoordinator,
)


async def test_button_entity_setup_and_press(hass: HomeAssistant) -> None:
    """Test button entity configuration and pressing."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"

    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.last_update_success = True
    coordinator.data = AbstpData(
        healthy=True,
        books=[],
        podcasts=[],
    )
    coordinator.async_request_refresh = AsyncMock()

    entry = MagicMock(spec=ConfigEntry)
    entry_id = "test_entry_id"
    entry.entry_id = entry_id

    hass.data[DOMAIN] = {entry_id: {"coordinator": coordinator}}

    added_entities: list[Entity] = []

    def add_entities(
        new_entities: Iterable[Entity],
        update_before_add: bool = False,
    ) -> None:
        _ = update_before_add
        added_entities.extend(new_entities)

    await async_setup_entry(hass, entry, add_entities)

    assert len(added_entities) == 1
    button_entity = added_entities[0]
    assert isinstance(button_entity, AbstpRefreshLibraryButton)
    assert button_entity.available is True

    await button_entity.async_press()
    refresh_mock = cast("AsyncMock", coordinator.async_request_refresh)
    refresh_mock.assert_called_once()
