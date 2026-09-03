"""Base entity class for the Audiobookshelf Transcoder Proxy integration."""

from typing import TYPE_CHECKING, override

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry

from .const import DOMAIN
from .coordinator import AbstpDataUpdateCoordinator


class AbstpEntity(CoordinatorEntity[AbstpDataUpdateCoordinator]):
    """Common base entity providing device registry binding and coordinator updates."""

    _attr_has_entity_name: bool = True
    _attr_device_info: DeviceInfo | None
    _entry: ConfigEntry

    def __init__(
        self,
        coordinator: AbstpDataUpdateCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the base entity with coordinator context and device info."""
        super().__init__(coordinator)
        self._entry = entry
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Audiobookshelf Transcoder Proxy",
            manufacturer="underhax",
            model="abstp",
            configuration_url=coordinator.client.base_url,
        )

    @property
    @override
    def available(self) -> bool:
        """Return true if the proxy service is healthy and responding."""
        return self.coordinator.last_update_success and self.coordinator.data.healthy
