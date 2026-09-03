"""Unit tests for media source provider."""

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock

from homeassistant.components.media_source.models import MediaSourceItem
from homeassistant.config_entries import ConfigEntry

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

from custom_components.abstp_controller.api import (
    AbstpApiClient,
    MediaItem,
    PlaySession,
    PodcastEpisode,
)
from custom_components.abstp_controller.const import DOMAIN
from custom_components.abstp_controller.coordinator import (
    AbstpData,
    AbstpDataUpdateCoordinator,
)
from custom_components.abstp_controller.media_source import (
    async_get_media_source,
)


async def test_media_source_browse_and_resolve(
    hass: HomeAssistant,
    mock_books: list[MediaItem],
    mock_podcasts: list[MediaItem],
    mock_episodes: list[PodcastEpisode],
    mock_play_session: PlaySession,
) -> None:
    """Test media source browsing hierarchy and stream resolution."""
    client = AsyncMock(spec=AbstpApiClient)
    client.base_url = "http://abstp.example.com:8099"
    client.async_get_podcast_episodes = AsyncMock(return_value=mock_episodes)
    client.async_start_session = AsyncMock(return_value=mock_play_session)

    config_entry = MagicMock(spec=ConfigEntry)
    config_entry.options = {}
    config_entry.data = {}

    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.config_entry = config_entry
    coordinator.data = AbstpData(
        healthy=True,
        books=mock_books,
        podcasts=mock_podcasts,
    )

    hass.data[DOMAIN] = {"test_entry": {"coordinator": coordinator}}

    source = await async_get_media_source(hass)
    assert source.domain == DOMAIN

    root_item = MediaSourceItem(hass, DOMAIN, "", None)
    root_browse = await source.async_browse_media(root_item)
    assert len(root_browse.children or []) == 2

    books_item = MediaSourceItem(hass, DOMAIN, "audiobooks", None)
    books_browse = await source.async_browse_media(books_item)
    assert len(books_browse.children or []) == 2

    podcasts_item = MediaSourceItem(hass, DOMAIN, "podcasts", None)
    podcasts_browse = await source.async_browse_media(podcasts_item)
    assert len(podcasts_browse.children or []) == 1

    episodes_item = MediaSourceItem(hass, DOMAIN, "podcast/podcast_1", None)
    episodes_browse = await source.async_browse_media(episodes_item)
    assert len(episodes_browse.children or []) == 2

    resolved_book = await source.async_resolve_media(
        MediaSourceItem(hass, DOMAIN, "book/book_1", None)
    )
    assert (
        resolved_book.url
        == "http://abstp.example.com:8099/stream/sess_019234ab89cd.aac?token=secret123"
    )
    assert resolved_book.mime_type == "audio/aac"
