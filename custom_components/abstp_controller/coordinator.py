"""DataUpdateCoordinator for the Audiobookshelf Transcoder Proxy integration."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import timedelta
from typing import TYPE_CHECKING, cast, override

from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from .tracker import SessionTracker

from .api import AbstpApiClient, AbstpApiError, InProgressItem, MediaItem
from .const import DEFAULT_SCAN_INTERVAL, DOMAIN, LOGGER


@dataclass(frozen=True, slots=True)
class AbstpData:
    """Consolidated state snapshot of the proxy instance and media catalog."""

    healthy: bool
    books: list[MediaItem]
    podcasts: list[MediaItem]
    in_progress: list[InProgressItem] = field(default_factory=list)

    @property
    def books_count(self) -> int:
        """Return the total number of audiobooks present in the catalog."""
        return len(self.books)

    @property
    def podcasts_count(self) -> int:
        """Return the total number of podcast collections present in the catalog."""
        return len(self.podcasts)

    @property
    def in_progress_count(self) -> int:
        """Return the total number of items currently in progress."""
        return len(self.in_progress)


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
        """Fetch health status, media catalogs, and active progress concurrently."""
        try:
            health_task = self.client.async_get_health()
            books_task = self.client.async_get_books()
            podcasts_task = self.client.async_get_podcasts()
            in_progress_task = self.client.async_get_in_progress()

            healthy, books, podcasts, in_progress = await asyncio.gather(
                health_task,
                books_task,
                podcasts_task,
                in_progress_task,
            )

            return AbstpData(
                healthy=healthy,
                books=books,
                podcasts=podcasts,
                in_progress=in_progress,
            )
        except AbstpApiError as err:
            msg = f"Error communicating with abstp: {err}"
            raise UpdateFailed(msg) from err


def get_coordinators(hass: HomeAssistant) -> list[AbstpDataUpdateCoordinator]:
    """Locate active coordinators across loaded entries for batch state refreshes."""
    domain_data = cast("dict[str, object] | None", hass.data.get(DOMAIN))
    if not domain_data:
        return []
    return [
        cast("AbstpDataUpdateCoordinator", data["coordinator"])
        for data in domain_data.values()
        if isinstance(data, dict) and "coordinator" in data
    ]


def get_coordinator(hass: HomeAssistant) -> AbstpDataUpdateCoordinator | None:
    """Locate the primary coordinator instance for catalog query and update routing."""
    coordinators = get_coordinators(hass)
    return coordinators[0] if coordinators else None


def get_tracker(hass: HomeAssistant) -> SessionTracker | None:
    """Locate active session tracker instance for playback tracking and lifecycle."""
    domain_data = cast("dict[str, object] | None", hass.data.get(DOMAIN))
    if not domain_data:
        return None
    for data in domain_data.values():
        if isinstance(data, dict) and "tracker" in data:
            return cast("SessionTracker", data["tracker"])
    return None


def get_client(hass: HomeAssistant) -> AbstpApiClient | None:
    """Locate backend API client instance for media asset streaming and proxying."""
    domain_data = cast("dict[str, object] | None", hass.data.get(DOMAIN))
    if not domain_data:
        return None
    for data in domain_data.values():
        if isinstance(data, dict) and "client" in data:
            return cast("AbstpApiClient", data["client"])
    return None


def get_entry_components(
    hass: HomeAssistant,
) -> tuple[AbstpDataUpdateCoordinator, SessionTracker] | None:
    """Locate paired coordinator and tracker instances for service executions."""
    domain_data = cast("dict[str, object] | None", hass.data.get(DOMAIN))
    if not domain_data:
        return None
    for data in domain_data.values():
        if isinstance(data, dict) and "coordinator" in data and "tracker" in data:
            return (
                cast("AbstpDataUpdateCoordinator", data["coordinator"]),
                cast("SessionTracker", data["tracker"]),
            )
    return None
