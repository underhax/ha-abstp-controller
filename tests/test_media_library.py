"""Unit tests for the player-scoped Audiobookshelf media library."""

from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.components.media_player.const import MediaClass, MediaType
from homeassistant.exceptions import HomeAssistantError

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

from custom_components.abstp_controller.api import (
    AbstpApiClient,
    AbstpConnectionError,
    InProgressItem,
    MediaItem,
    PodcastEpisode,
)
from custom_components.abstp_controller.coordinator import (
    AbstpData,
    AbstpDataUpdateCoordinator,
)
from custom_components.abstp_controller.media_library import AbstpMediaLibrary


async def test_media_library_browse_hierarchy(
    hass: HomeAssistant,
    mock_books: list[MediaItem],
    mock_podcasts: list[MediaItem],
    mock_episodes: list[PodcastEpisode],
    mock_in_progress: list[InProgressItem],
) -> None:
    """Test library branches expose player-local navigation and playback IDs."""
    client = AsyncMock(spec=AbstpApiClient)
    get_podcast_episodes = cast("AsyncMock", client.async_get_podcast_episodes)
    get_podcast_episodes.return_value = mock_episodes
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.data = AbstpData(
        healthy=True,
        books=mock_books,
        podcasts=mock_podcasts,
        in_progress=mock_in_progress,
    )
    library = AbstpMediaLibrary(hass, coordinator)

    root = await library.async_browse_media(None)
    assert root.title == "Audiobookshelf"
    assert root.media_content_id == ""
    assert [(child.title, child.media_content_id) for child in root.children or []] == [
        ("Continue Listening (2)", "continue_listening"),
        ("Audiobooks (2)", "audiobooks"),
        ("Podcasts (1)", "podcasts"),
    ]

    continue_listening = await library.async_browse_media("continue_listening")
    assert [child.media_content_id for child in continue_listening.children or []] == [
        "in_progress/book_1",
        "in_progress/podcast_1/ep_1",
    ]

    audiobooks = await library.async_browse_media("audiobooks")
    assert [child.media_content_id for child in audiobooks.children or []] == [
        "book/book_1",
        "book/book_2",
    ]

    podcasts = await library.async_browse_media("podcasts")
    assert [child.media_content_id for child in podcasts.children or []] == [
        "podcast/podcast_1"
    ]
    assert (podcasts.children or [])[0].children_media_class == MediaClass.MUSIC

    episodes = await library.async_browse_media("podcast/podcast_1")
    assert episodes.title == "Science Weekly"
    assert [child.media_content_id for child in episodes.children or []] == [
        "episode/podcast_1/ep_1",
        "episode/podcast_1/ep_2",
    ]
    assert [child.media_class for child in episodes.children or []] == [
        MediaClass.MUSIC,
        MediaClass.MUSIC,
    ]
    assert [child.media_content_type for child in episodes.children or []] == [
        MediaType.MUSIC,
        MediaType.MUSIC,
    ]
    assert [child.thumbnail for child in episodes.children or []] == [
        "/api/abstp_controller/cover/podcast_1",
        "/api/abstp_controller/cover/podcast_1",
    ]
    get_podcast_episodes.assert_awaited_once_with("podcast_1")


async def test_media_library_uses_localized_name(hass: HomeAssistant) -> None:
    """Test media library name follows the configured Home Assistant language."""
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])
    with patch(
        "custom_components.abstp_controller.media_library.async_get_translations",
        new_callable=AsyncMock,
        return_value={
            "component.abstp_controller.media_source.name": "Localized Library",
        },
    ) as get_translations:
        root = await AbstpMediaLibrary(hass, coordinator).async_browse_media(None)

    get_translations.assert_awaited_once_with(
        hass,
        hass.config.language,
        "media_source",
        {"abstp_controller"},
    )
    assert root.title == "Localized Library"


async def test_media_library_rejects_unknown_identifier(
    hass: HomeAssistant,
) -> None:
    """Test invalid player-local library paths return a clear Home Assistant error."""
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])

    with pytest.raises(HomeAssistantError, match="Unknown media identifier: unknown"):
        _ = await AbstpMediaLibrary(hass, coordinator).async_browse_media("unknown")


async def test_media_library_reports_podcast_fetch_error(
    hass: HomeAssistant,
) -> None:
    """Test unavailable podcast episode feeds surface as Home Assistant errors."""
    client = AsyncMock(spec=AbstpApiClient)
    get_podcast_episodes = cast("AsyncMock", client.async_get_podcast_episodes)
    get_podcast_episodes.side_effect = AbstpConnectionError("offline")
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])

    with pytest.raises(
        HomeAssistantError, match="Failed to fetch podcast episodes: offline"
    ):
        _ = await AbstpMediaLibrary(hass, coordinator).async_browse_media(
            "podcast/podcast_1"
        )


async def test_media_library_falls_back_when_translations_unavailable(
    hass: HomeAssistant,
) -> None:
    """Test library preserves English labels when translation lookup fails."""
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.data = AbstpData(healthy=True, books=[], podcasts=[])
    with patch(
        "custom_components.abstp_controller.media_library.async_get_translations",
        new_callable=AsyncMock,
        side_effect=HomeAssistantError("translations unavailable"),
    ):
        root = await AbstpMediaLibrary(hass, coordinator).async_browse_media(None)

    assert root.title == "Audiobookshelf"
