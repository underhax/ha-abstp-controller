"""Sensor platform for the Audiobookshelf Transcoder Proxy integration."""

from dataclasses import dataclass
from typing import TYPE_CHECKING, cast, override

from homeassistant.components.sensor import (
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import EntityCategory
from homeassistant.helpers.device_registry import DeviceInfo

if TYPE_CHECKING:
    from collections.abc import Callable
    from datetime import date, datetime
    from decimal import Decimal

    from homeassistant.config_entries import ConfigEntry
    from homeassistant.core import HomeAssistant
    from homeassistant.helpers.entity_platform import AddEntitiesCallback
    from homeassistant.helpers.typing import StateType

    from .coordinator import AbstpData, AbstpDataUpdateCoordinator

from .const import DOMAIN


@dataclass(frozen=True, kw_only=True)
class AbstpSensorEntityDescription(SensorEntityDescription):
    """Describes an abstp sensor entity with an extraction value getter."""

    value_fn: Callable[[AbstpData], str | int]


SENSOR_DESCRIPTIONS: tuple[AbstpSensorEntityDescription, ...] = (
    AbstpSensorEntityDescription(
        key="status",
        translation_key="status",
        icon="mdi:server-network",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: "ok" if data.healthy else "error",
    ),
    AbstpSensorEntityDescription(
        key="books_count",
        translation_key="books_count",
        icon="mdi:book-open-variant",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda data: data.books_count,
    ),
    AbstpSensorEntityDescription(
        key="podcasts_count",
        translation_key="podcasts_count",
        icon="mdi:podcast",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda data: data.podcasts_count,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up abstp sensor entities from a config entry."""
    coordinator = cast(
        "AbstpDataUpdateCoordinator",
        hass.data[DOMAIN][entry.entry_id]["coordinator"],
    )

    entities = [
        AbstpSensor(coordinator, entry, description)
        for description in SENSOR_DESCRIPTIONS
    ]
    async_add_entities(entities)


class AbstpSensor(SensorEntity):
    """Representation of an abstp telemetry and catalog sensor."""

    coordinator: AbstpDataUpdateCoordinator
    entity_description: SensorEntityDescription
    _attr_has_entity_name: bool = True
    _attr_unique_id: str | None = None
    _attr_device_info: DeviceInfo | None = None
    _attr_native_value: StateType | date | datetime | Decimal = None
    _attr_available: bool = True

    def __init__(
        self,
        coordinator: AbstpDataUpdateCoordinator,
        entry: ConfigEntry,
        description: AbstpSensorEntityDescription,
    ) -> None:
        """Initialize the sensor with description and unique identifier."""
        self.coordinator = coordinator
        self.entity_description = description
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Audiobookshelf Transcoder Proxy",
            manufacturer="underhax",
            model="abstp",
            configuration_url=coordinator.client.base_url,
        )
        self._attr_native_value = description.value_fn(coordinator.data)
        self._attr_available = (
            coordinator.last_update_success and coordinator.data.healthy
        )

    @override
    async def async_added_to_hass(self) -> None:
        """Register coordinator update listener when entity is added."""
        await super().async_added_to_hass()
        self.async_on_remove(
            self.coordinator.async_add_listener(self._handle_coordinator_update)
        )

    def _handle_coordinator_update(self) -> None:
        """Handle updated data from the coordinator."""
        desc = cast("AbstpSensorEntityDescription", self.entity_description)
        self._attr_native_value = desc.value_fn(self.coordinator.data)
        self._attr_available = (
            self.coordinator.last_update_success and self.coordinator.data.healthy
        )
        self.async_write_ha_state()
