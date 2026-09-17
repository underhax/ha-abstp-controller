"""Unit tests for AbstpDataUpdateCoordinator."""

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock

from homeassistant.config_entries import ConfigEntry

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from custom_components.abstp_controller.api import InProgressItem, MediaItem

from custom_components.abstp_controller.api import (
    AbstpApiClient,
    AbstpApiError,
)
from custom_components.abstp_controller.const import DOMAIN
from custom_components.abstp_controller.coordinator import (
    AbstpDataUpdateCoordinator,
    get_client,
    get_coordinator,
    get_coordinators,
    get_entry_components,
    get_tracker,
)
from custom_components.abstp_controller.tracker import SessionTracker


async def test_coordinator_successful_update(
    hass: HomeAssistant,
    mock_books: list[MediaItem],
    mock_podcasts: list[MediaItem],
    mock_in_progress: list[InProgressItem],
) -> None:
    """Test coordinator data fetch under normal healthy conditions."""
    client = AsyncMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"
    client.async_get_health = AsyncMock(return_value=True)
    client.async_get_books = AsyncMock(return_value=mock_books)
    client.async_get_podcasts = AsyncMock(return_value=mock_podcasts)
    client.async_get_in_progress = AsyncMock(return_value=mock_in_progress)

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
    assert coordinator.data.in_progress_count == 2
    assert coordinator.data.in_progress == mock_in_progress


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


async def test_domain_data_accessors_empty(hass: HomeAssistant) -> None:
    """Test domain data accessors return safe defaults when unloaded."""
    assert get_coordinators(hass) == []
    assert get_coordinator(hass) is None
    assert get_tracker(hass) is None
    assert get_client(hass) is None
    assert get_entry_components(hass) is None

    hass.data[DOMAIN] = {"invalid_entry": "not_a_dict"}
    assert get_coordinators(hass) == []
    assert get_coordinator(hass) is None
    assert get_tracker(hass) is None
    assert get_client(hass) is None
    assert get_entry_components(hass) is None


async def test_domain_data_accessors_populated(hass: HomeAssistant) -> None:
    """Test domain data accessors retrieve active instances from populated entry."""
    client = AsyncMock(spec=AbstpApiClient)
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    tracker = MagicMock(spec=SessionTracker)

    hass.data[DOMAIN] = {
        "entry_1": {
            "client": client,
            "coordinator": coordinator,
            "tracker": tracker,
        }
    }

    assert get_coordinators(hass) == [coordinator]
    assert get_coordinator(hass) is coordinator
    assert get_tracker(hass) is tracker
    assert get_client(hass) is client
    assert get_entry_components(hass) == (coordinator, tracker)
