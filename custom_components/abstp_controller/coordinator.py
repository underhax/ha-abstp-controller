"""DataUpdateCoordinator for the Audiobookshelf Transcoder Proxy integration."""

import asyncio
from dataclasses import dataclass
from datetime import timedelta
from typing import TYPE_CHECKING, override

from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

from .api import AbstpApiClient, AbstpApiError, MediaItem
from .const import DEFAULT_SCAN_INTERVAL, DOMAIN, LOGGER


@dataclass(frozen=True, slots=True)
class AbstpData:
    """Consolidated state snapshot of the proxy instance and media catalog."""

    healthy: bool
    books: list[MediaItem]
    podcasts: list[MediaItem]

    @property
    def books_count(self) -> int:
        """Return the total number of audiobooks present in the catalog."""
        return len(self.books)

    @property
    def podcasts_count(self) -> int:
        """Return the total number of podcast collections present in the catalog."""
        return len(self.podcasts)


class AbstpDataUpdateCoordinator(DataUpdateCoordinator[AbstpData]):
    """Manage fetching and caching media catalog data from the abstp instance."""

    client: AbstpApiClient

    def __init__(
        self,
        hass: HomeAssistant,
        client: AbstpApiClient,
        scan_interval_seconds: int = DEFAULT_SCAN_INTERVAL,
    ) -> None:
        """Initialize the coordinator with client transport and polling interval."""
        self.client = client
        super().__init__(
            hass,
            LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=scan_interval_seconds),
        )

    @override
    async def _async_update_data(self) -> AbstpData:
        """Fetch health status, audiobooks, and podcast channels concurrently."""
        try:
            health_task = self.client.async_get_health()
            books_task = self.client.async_get_books()
            podcasts_task = self.client.async_get_podcasts()

            healthy, books, podcasts = await asyncio.gather(
                health_task,
                books_task,
                podcasts_task,
            )

            return AbstpData(
                healthy=healthy,
                books=books,
                podcasts=podcasts,
            )
        except AbstpApiError as err:
            msg = f"Error communicating with abstp: {err}"
            raise UpdateFailed(msg) from err
