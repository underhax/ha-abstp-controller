"""Media Source platform for the Audiobookshelf Transcoder Proxy integration."""

from typing import TYPE_CHECKING, cast, override

from homeassistant.components.media_player.const import MediaClass, MediaType
from homeassistant.components.media_source import (
    MediaSource,
    MediaSourceItem,
    PlayMedia,
    Unresolvable,
)
from homeassistant.components.media_source.models import BrowseMediaSource

if TYPE_CHECKING:
    from collections.abc import Mapping

    from homeassistant.core import HomeAssistant

    from .coordinator import AbstpDataUpdateCoordinator

from .api import AbstpApiError, AbstpAuthError, AbstpConnectionError
from .const import CONF_DEFAULT_SPEED, DEFAULT_SPEED, DOMAIN


async def async_get_media_source(hass: HomeAssistant) -> MediaSource:
    """Instantiate and return the abstp media source provider."""
    return AbstpMediaSource(hass)


class AbstpMediaSource(MediaSource):
    """Media source provider exposing Audiobookshelf library collections."""

    name: str | None = "Audiobookshelf Transcoder"
    hass: HomeAssistant

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the media source with Home Assistant reference."""
        super().__init__(DOMAIN)
        self.hass = hass

    def _get_coordinator(self) -> AbstpDataUpdateCoordinator:
        """Retrieve the active coordinator or raise an unresolvable error."""
        domain_data = cast(
            "dict[str, dict[str, object]]",
            self.hass.data.get(DOMAIN, {}),
        )
        for data in domain_data.values():
            if "coordinator" in data:
                return cast("AbstpDataUpdateCoordinator", data["coordinator"])
        msg = "Integration is not initialized or loaded"
        raise Unresolvable(msg)

    @override
    async def async_browse_media(self, item: MediaSourceItem) -> BrowseMediaSource:
        """Build the hierarchical media browsing tree."""
        coordinator = self._get_coordinator()
        data = coordinator.data
        identifier = item.identifier or ""

        if not identifier:
            return BrowseMediaSource(
                domain=DOMAIN,
                identifier="",
                media_class=MediaClass.DIRECTORY,
                media_content_type=MediaType.MUSIC,
                title="Audiobookshelf Transcoder",
                can_play=False,
                can_expand=True,
                children_media_class=MediaClass.DIRECTORY,
                children=[
                    BrowseMediaSource(
                        domain=DOMAIN,
                        identifier="audiobooks",
                        media_class=MediaClass.DIRECTORY,
                        media_content_type=MediaType.MUSIC,
                        title=f"Audiobooks ({data.books_count})",
                        can_play=False,
                        can_expand=True,
                        children_media_class=MediaClass.MUSIC,
                    ),
                    BrowseMediaSource(
                        domain=DOMAIN,
                        identifier="podcasts",
                        media_class=MediaClass.DIRECTORY,
                        media_content_type=MediaType.PODCAST,
                        title=f"Podcasts ({data.podcasts_count})",
                        can_play=False,
                        can_expand=True,
                        children_media_class=MediaClass.PODCAST,
                    ),
                ],
            )

        if identifier == "audiobooks":
            children = [
                BrowseMediaSource(
                    domain=DOMAIN,
                    identifier=f"book/{book.id}",
                    media_class=MediaClass.MUSIC,
                    media_content_type=MediaType.MUSIC,
                    title=f"{book.title} - {book.author}"
                    if book.author
                    else book.title,
                    can_play=True,
                    can_expand=False,
                    thumbnail=f"/api/abstp_controller/cover/{book.id}"
                    if book.cover_url
                    else None,
                )
                for book in data.books
            ]
            return BrowseMediaSource(
                domain=DOMAIN,
                identifier="audiobooks",
                media_class=MediaClass.DIRECTORY,
                media_content_type=MediaType.MUSIC,
                title="Audiobooks",
                can_play=False,
                can_expand=True,
                children_media_class=MediaClass.MUSIC,
                children=children,
            )

        if identifier == "podcasts":
            children = [
                BrowseMediaSource(
                    domain=DOMAIN,
                    identifier=f"podcast/{podcast.id}",
                    media_class=MediaClass.PODCAST,
                    media_content_type=MediaType.PODCAST,
                    title=podcast.title,
                    can_play=False,
                    can_expand=True,
                    thumbnail=f"/api/abstp_controller/cover/{podcast.id}"
                    if podcast.cover_url
                    else None,
                    children_media_class=MediaClass.EPISODE,
                )
                for podcast in data.podcasts
            ]
            return BrowseMediaSource(
                domain=DOMAIN,
                identifier="podcasts",
                media_class=MediaClass.DIRECTORY,
                media_content_type=MediaType.PODCAST,
                title="Podcasts",
                can_play=False,
                can_expand=True,
                children_media_class=MediaClass.PODCAST,
                children=children,
            )

        if identifier.startswith("podcast/"):
            podcast_id = identifier.split("/", 1)[1]
            try:
                episodes = await coordinator.client.async_get_podcast_episodes(
                    podcast_id
                )
            except (AbstpApiError, AbstpConnectionError, AbstpAuthError) as err:
                msg = f"Failed to fetch podcast episodes: {err}"
                raise Unresolvable(msg) from err

            podcast_title = "Episodes"
            for podcast in data.podcasts:
                if podcast.id == podcast_id:
                    podcast_title = podcast.title
                    break

            children = [
                BrowseMediaSource(
                    domain=DOMAIN,
                    identifier=f"episode/{podcast_id}/{ep.id}",
                    media_class=MediaClass.EPISODE,
                    media_content_type=MediaType.PODCAST,
                    title=ep.title or f"Episode {ep.episode or ep.id}",
                    can_play=True,
                    can_expand=False,
                )
                for ep in episodes
            ]
            return BrowseMediaSource(
                domain=DOMAIN,
                identifier=identifier,
                media_class=MediaClass.PODCAST,
                media_content_type=MediaType.PODCAST,
                title=podcast_title,
                can_play=False,
                can_expand=True,
                children_media_class=MediaClass.EPISODE,
                children=children,
            )

        msg = f"Unknown media identifier: {identifier}"
        raise Unresolvable(msg)

    @override
    async def async_resolve_media(self, item: MediaSourceItem) -> PlayMedia:
        """Resolve a media item identifier to a live AAC stream URL."""
        coordinator = self._get_coordinator()
        identifier = item.identifier or ""

        default_speed = DEFAULT_SPEED
        if coordinator.config_entry is not None:
            opts = cast("Mapping[str, object]", coordinator.config_entry.options)
            entry_data = cast("Mapping[str, object]", coordinator.config_entry.data)
            raw_speed = opts.get(
                CONF_DEFAULT_SPEED,
                entry_data.get(CONF_DEFAULT_SPEED, DEFAULT_SPEED),
            )
            default_speed = float(str(raw_speed))

        if identifier.startswith("book/"):
            book_id = identifier.split("/", 1)[1]
            session = await coordinator.client.async_start_session(
                item_id=book_id,
                speed=default_speed,
            )
            return PlayMedia(url=session.stream_url, mime_type="audio/aac")

        if identifier.startswith("episode/"):
            parts = identifier.split("/", 2)
            if len(parts) == 3:
                podcast_id, episode_id = parts[1], parts[2]
                session = await coordinator.client.async_start_session(
                    item_id=podcast_id,
                    episode_id=episode_id,
                    speed=default_speed,
                )
                return PlayMedia(url=session.stream_url, mime_type="audio/aac")

        msg = f"Cannot resolve stream for identifier: {identifier}"
        raise Unresolvable(msg)
