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
from homeassistant.helpers.translation import async_get_translations

if TYPE_CHECKING:
    from collections.abc import Mapping

    from homeassistant.core import HomeAssistant

    from .coordinator import AbstpDataUpdateCoordinator

from .api import AbstpApiError, AbstpAuthError, AbstpConnectionError
from .const import CONF_DEFAULT_SPEED, DEFAULT_SPEED, DOMAIN


async def async_get_media_source(hass: HomeAssistant) -> MediaSource:
    """Instantiate and return the abstp media source provider."""
    translations = await async_get_translations(
        hass,
        hass.config.language,
        "media_source",
        {DOMAIN},
    )
    return AbstpMediaSource(hass, translations)


class AbstpMediaSource(MediaSource):
    """Media source provider exposing Audiobookshelf library collections."""

    name: str | None
    hass: HomeAssistant
    _translations: Mapping[str, str]

    def __init__(
        self,
        hass: HomeAssistant,
        translations: Mapping[str, str],
    ) -> None:
        """Initialize the media source with Home Assistant reference."""
        super().__init__(DOMAIN)
        self.hass = hass
        self._translations = translations
        self.name = self._translate("name", "Audiobookshelf")

    def _translate(
        self,
        key: str,
        fallback: str,
        placeholders: Mapping[str, str] | None = None,
    ) -> str:
        """Return a localized media source label with an English fallback."""
        translation_key = f"component.{DOMAIN}.media_source.{key}"
        value = self._translations.get(translation_key, fallback)
        return value.format_map(placeholders or {})

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
            source_name = self._translate("name", "Audiobookshelf")
            continue_listening_title = self._translate(
                "continue_listening", "Continue Listening"
            )
            audiobooks_title = self._translate("audiobooks", "Audiobooks")
            podcasts_title = self._translate("podcasts", "Podcasts")
            return BrowseMediaSource(
                domain=DOMAIN,
                identifier="",
                media_class=MediaClass.DIRECTORY,
                media_content_type=MediaType.MUSIC,
                title=source_name,
                can_play=False,
                can_expand=True,
                children_media_class=MediaClass.DIRECTORY,
                children=[
                    BrowseMediaSource(
                        domain=DOMAIN,
                        identifier="continue_listening",
                        media_class=MediaClass.DIRECTORY,
                        media_content_type=MediaType.MUSIC,
                        title=f"{continue_listening_title} ({data.in_progress_count})",
                        can_play=False,
                        can_expand=True,
                        children_media_class=MediaClass.MUSIC,
                    ),
                    BrowseMediaSource(
                        domain=DOMAIN,
                        identifier="audiobooks",
                        media_class=MediaClass.DIRECTORY,
                        media_content_type=MediaType.MUSIC,
                        title=f"{audiobooks_title} ({data.books_count})",
                        can_play=False,
                        can_expand=True,
                        children_media_class=MediaClass.MUSIC,
                    ),
                    BrowseMediaSource(
                        domain=DOMAIN,
                        identifier="podcasts",
                        media_class=MediaClass.DIRECTORY,
                        media_content_type=MediaType.PODCAST,
                        title=f"{podcasts_title} ({data.podcasts_count})",
                        can_play=False,
                        can_expand=True,
                        children_media_class=MediaClass.PODCAST,
                    ),
                ],
            )

        if identifier == "continue_listening":
            children = [
                BrowseMediaSource(
                    domain=DOMAIN,
                    identifier=(
                        f"in_progress/{item.id}/{item.episode_id}"
                        if item.episode_id
                        else f"in_progress/{item.id}"
                    ),
                    media_class=(
                        MediaClass.EPISODE
                        if item.media_type == "podcast"
                        else MediaClass.MUSIC
                    ),
                    media_content_type=(
                        MediaType.PODCAST
                        if item.media_type == "podcast"
                        else MediaType.MUSIC
                    ),
                    title=(
                        f"{item.title}: {item.episode_title}"
                        if item.episode_title
                        else (
                            f"{item.title} - {item.author}"
                            if item.author
                            else item.title
                        )
                    ),
                    can_play=True,
                    can_expand=False,
                    thumbnail=(
                        f"/api/abstp_controller/cover/{item.id}"
                        if item.cover_url
                        else None
                    ),
                )
                for item in data.in_progress
            ]
            return BrowseMediaSource(
                domain=DOMAIN,
                identifier="continue_listening",
                media_class=MediaClass.DIRECTORY,
                media_content_type=MediaType.MUSIC,
                title=self._translate("continue_listening", "Continue Listening"),
                can_play=False,
                can_expand=True,
                children_media_class=MediaClass.MUSIC,
                children=children,
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
                title=self._translate("audiobooks", "Audiobooks"),
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
                title=self._translate("podcasts", "Podcasts"),
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

            podcast_title = self._translate("episodes", "Episodes")
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
                    title=ep.title
                    or self._translate(
                        "episode",
                        f"Episode {ep.episode or ep.id}",
                        {"number": str(ep.episode or ep.id)},
                    ),
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

        if identifier.startswith("in_progress/"):
            parts = identifier.split("/", 2)
            item_id = parts[1]
            episode_id = parts[2] if len(parts) > 2 else None
            current_time = 0.0
            for in_prog in coordinator.data.in_progress:
                if in_prog.id == item_id and (
                    episode_id is None or in_prog.episode_id == episode_id
                ):
                    current_time = in_prog.current_time
                    break
            session = await coordinator.client.async_start_session(
                item_id=item_id,
                episode_id=episode_id,
                speed=default_speed,
                current_time=current_time,
            )
            return PlayMedia(url=session.stream_url, mime_type="audio/aac")

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
