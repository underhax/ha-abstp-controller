"""Unit tests for AbstpDataUpdateCoordinator."""

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock

from homeassistant.config_entries import ConfigEntry

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from custom_components.abstp_controller.api import MediaItem

from custom_components.abstp_controller.api import (
    AbstpApiClient,
    AbstpApiError,
)
from custom_components.abstp_controller.coordinator import (
    AbstpDataUpdateCoordinator,
)


async def test_coordinator_successful_update(
    hass: HomeAssistant,
    mock_books: list[MediaItem],
    mock_podcasts: list[MediaItem],
) -> None:
    """Test coordinator data fetch under normal healthy conditions."""
    client = AsyncMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"
    client.async_get_health = AsyncMock(return_value=True)
    client.async_get_books = AsyncMock(return_value=mock_books)
    client.async_get_podcasts = AsyncMock(return_value=mock_podcasts)

    coordinator = AbstpDataUpdateCoordinator(
        hass=hass,
        client=client,
        scan_interval_seconds=300,
    )
    entry = MagicMock(spec=ConfigEntry)
    coordinator.config_entry = entry

    await coordinator.async_refresh()
    assert coordinator.last_update_success is True
    assert coordinator.data.healthy is True
    assert coordinator.data.books_count == 2
    assert coordinator.data.podcasts_count == 1


async def test_coordinator_update_failure(
    hass: HomeAssistant,
) -> None:
    """Test coordinator handling API exceptions."""
    client = AsyncMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"
    client.async_get_health = AsyncMock(side_effect=AbstpApiError("API offline"))

    coordinator = AbstpDataUpdateCoordinator(
        hass=hass,
        client=client,
        scan_interval_seconds=300,
    )
    entry = MagicMock(spec=ConfigEntry)
    coordinator.config_entry = entry

    await coordinator.async_refresh()
    assert coordinator.last_update_success is False
