"""Button platform for the Audiobookshelf Transcoder Proxy integration."""

from typing import TYPE_CHECKING, cast, override

from homeassistant.components.button import ButtonEntity
from homeassistant.const import EntityCategory
from homeassistant.helpers.device_registry import DeviceInfo

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry
    from homeassistant.core import HomeAssistant
    from homeassistant.helpers.entity_platform import AddEntitiesCallback

    from .coordinator import AbstpDataUpdateCoordinator

from .const import DOMAIN


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up abstp button entities from a config entry."""
    coordinator = cast(
        "AbstpDataUpdateCoordinator",
        hass.data[DOMAIN][entry.entry_id]["coordinator"],
    )
    async_add_entities([AbstpRefreshLibraryButton(coordinator, entry)])


class AbstpRefreshLibraryButton(ButtonEntity):
    """Button entity to trigger an immediate catalog reload from abstp."""

    coordinator: AbstpDataUpdateCoordinator
    _attr_has_entity_name: bool = True
    _attr_translation_key: str | None = "refresh_library"
    _attr_icon: str | None = "mdi:refresh"
    _attr_entity_category: EntityCategory | None = EntityCategory.DIAGNOSTIC
    _attr_unique_id: str | None = None
    _attr_device_info: DeviceInfo | None = None
    _attr_available: bool = True

    def __init__(
        self,
        coordinator: AbstpDataUpdateCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the refresh library button entity."""
        self.coordinator = coordinator
        self._attr_unique_id = f"{entry.entry_id}_refresh_library"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Audiobookshelf Transcoder Proxy",
            manufacturer="underhax",
            model="abstp",
            configuration_url=coordinator.client.base_url,
        )
        self._attr_available = (
            coordinator.last_update_success and coordinator.data.healthy
        )

    @override
    async def async_press(self) -> None:
        """Trigger an immediate data refresh through the coordinator."""
        await self.coordinator.async_request_refresh()
