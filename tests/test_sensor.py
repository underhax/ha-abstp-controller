"""Unit tests for sensor entities."""

from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

from homeassistant.config_entries import ConfigEntry

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable

    from homeassistant.core import HomeAssistant
    from homeassistant.helpers.entity import Entity

    from custom_components.abstp_controller.api import MediaItem

from custom_components.abstp_controller.api import AbstpApiClient
from custom_components.abstp_controller.const import DOMAIN
from custom_components.abstp_controller.coordinator import (
    AbstpData,
    AbstpDataUpdateCoordinator,
)
from custom_components.abstp_controller.sensor import (
    SENSOR_DESCRIPTIONS,
    AbstpSensor,
    async_setup_entry,
)


async def test_sensor_entities_setup_and_state(
    hass: HomeAssistant,
    mock_books: list[MediaItem],
    mock_podcasts: list[MediaItem],
) -> None:
    """Test setting up sensor entities and verifying states."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"

    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.last_update_success = True
    coordinator.data = AbstpData(
        healthy=True,
        books=mock_books,
        podcasts=mock_podcasts,
    )

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

    assert len(added_entities) == 3
    status_sensor = added_entities[0]
    books_sensor = added_entities[1]
    podcasts_sensor = added_entities[2]

    assert isinstance(status_sensor, AbstpSensor)
    assert status_sensor.native_value == "ok"
    assert status_sensor.available is True

    assert isinstance(books_sensor, AbstpSensor)
    assert books_sensor.native_value == 2

    assert isinstance(podcasts_sensor, AbstpSensor)
    assert podcasts_sensor.native_value == 1


async def test_sensor_entity_update(hass: HomeAssistant) -> None:
    """Test sensor entity updating when coordinator data changes."""
    client = MagicMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"

    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.last_update_success = True
    coordinator.data = AbstpData(
        healthy=False,
        books=[],
        podcasts=[],
    )

    listeners: list[Callable[[], None]] = []

    def capture_listener(cb: Callable[[], None]) -> MagicMock:
        listeners.append(cb)
        return MagicMock()

    coordinator.async_add_listener = capture_listener

    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_id"

    sensor = AbstpSensor(coordinator, entry, SENSOR_DESCRIPTIONS[0])
    sensor.hass = hass
    assert sensor.native_value == "error"

    await sensor.async_added_to_hass()
    assert len(listeners) == 1

    with patch.object(sensor, "async_write_ha_state") as mock_write:
        listeners[0]()
        assert sensor.native_value == "error"
        mock_write.assert_called_once()
