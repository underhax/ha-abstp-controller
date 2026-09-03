"""Number platform for the Audiobookshelf Transcoder Proxy integration."""

from typing import TYPE_CHECKING, cast, override

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.const import EntityCategory
from homeassistant.helpers.device_registry import DeviceInfo

if TYPE_CHECKING:
    from collections.abc import Mapping

    from homeassistant.config_entries import ConfigEntry
    from homeassistant.core import HomeAssistant
    from homeassistant.helpers.entity_platform import AddEntitiesCallback

    from .coordinator import AbstpDataUpdateCoordinator

from .const import (
    CONF_DEFAULT_SPEED,
    DEFAULT_SPEED,
    DOMAIN,
    MAX_SPEED,
    MIN_SPEED,
    SPEED_STEP,
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up abstp number entities from a config entry."""
    coordinator = cast(
        "AbstpDataUpdateCoordinator",
        hass.data[DOMAIN][entry.entry_id]["coordinator"],
    )
    async_add_entities([AbstpDefaultSpeedNumber(coordinator, entry)])


class AbstpDefaultSpeedNumber(NumberEntity):
    """Number entity controlling the default transcoding playback speed."""

    coordinator: AbstpDataUpdateCoordinator
    _entry: ConfigEntry
    _attr_has_entity_name: bool = True
    _attr_translation_key: str | None = "default_speed"
    _attr_icon: str | None = "mdi:play-speed"
    _attr_native_min_value: float = MIN_SPEED
    _attr_native_max_value: float = MAX_SPEED
    _attr_native_step: float = SPEED_STEP
    _attr_native_unit_of_measurement: str | None = "x"
    _attr_mode: NumberMode = NumberMode.SLIDER
    _attr_entity_category: EntityCategory | None = EntityCategory.CONFIG
    _attr_unique_id: str | None = None
    _attr_device_info: DeviceInfo | None = None
    _attr_native_value: float | None = None
    _attr_available: bool = True

    def __init__(
        self,
        coordinator: AbstpDataUpdateCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the speed number entity."""
        self.coordinator = coordinator
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_default_speed"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Audiobookshelf Transcoder Proxy",
            manufacturer="underhax",
            model="abstp",
            configuration_url=coordinator.client.base_url,
        )
        opts = cast("Mapping[str, object]", entry.options)
        entry_data = cast("Mapping[str, object]", entry.data)
        default_val = opts.get(
            CONF_DEFAULT_SPEED,
            entry_data.get(CONF_DEFAULT_SPEED, DEFAULT_SPEED),
        )
        self._attr_native_value = float(str(default_val))
        self._attr_available = (
            coordinator.last_update_success and coordinator.data.healthy
        )

    @override
    async def async_set_native_value(self, value: float) -> None:
        """Update the default playback speed option in config entry."""
        new_options = {**self._entry.options, CONF_DEFAULT_SPEED: float(value)}
        self._attr_native_value = float(value)
        _ = self.hass.config_entries.async_update_entry(
            self._entry, options=new_options
        )
        self.async_write_ha_state()
