"""Unit tests for number entity."""

from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

from homeassistant.config_entries import ConfigEntry

if TYPE_CHECKING:
    from collections.abc import Iterable

    from homeassistant.core import HomeAssistant
    from homeassistant.helpers.entity import Entity

from custom_components.abstp_controller.api import AbstpApiClient
from custom_components.abstp_controller.const import (
    CONF_DEFAULT_SPEED,
    DEFAULT_SPEED,
    DOMAIN,
)
from custom_components.abstp_controller.coordinator import (
    AbstpData,
    AbstpDataUpdateCoordinator,
)
from custom_components.abstp_controller.number import (
    AbstpDefaultSpeedNumber,
    async_setup_entry,
)


async def test_number_entity_setup_and_set_value(hass: HomeAssistant) -> None:
    """Test number entity configuration and updating value."""
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

    entry = MagicMock(spec=ConfigEntry)
    entry_id = "test_entry_id"
    entry.entry_id = entry_id
    entry.data = {CONF_DEFAULT_SPEED: DEFAULT_SPEED}
    entry.options = {CONF_DEFAULT_SPEED: 1.25}

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
    number_entity = added_entities[0]
    assert isinstance(number_entity, AbstpDefaultSpeedNumber)
    assert number_entity.native_value == 1.25
    assert number_entity.available is True

    number_entity.hass = hass
    with (
        patch.object(hass.config_entries, "async_update_entry"),
        patch.object(number_entity, "async_write_ha_state") as mock_write,
    ):
        await number_entity.async_set_native_value(1.5)
        assert number_entity.native_value == 1.5
        mock_write.assert_called_once()
