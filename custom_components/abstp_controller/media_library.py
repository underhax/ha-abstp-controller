"""Private Audiobookshelf library browser for virtual media players."""

from __future__ import annotations

from typing import TYPE_CHECKING

from homeassistant.components.media_player.browse_media import BrowseMedia
from homeassistant.components.media_player.const import MediaClass, MediaType
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.translation import async_get_translations

from .api import AbstpApiError, AbstpAuthError, AbstpConnectionError
from .const import DOMAIN, LOGGER

if TYPE_CHECKING:
    from collections.abc import Mapping

    from homeassistant.core import HomeAssistant

    from .coordinator import AbstpData, AbstpDataUpdateCoordinator


class AbstpMediaLibrary:
    """Build a player-scoped library to keep Audiobookshelf out of global sources."""

    _hass: HomeAssistant
    _coordinator: AbstpDataUpdateCoordinator
    _translations: Mapping[str, str]

    def __init__(
        self,
        hass: HomeAssistant,
        coordinator: AbstpDataUpdateCoordinator,
    ) -> None:
        """Bind browsing to the config entry represented by the virtual player."""
        self._hass = hass
        self._coordinator = coordinator
        self._translations = {}

    async def async_browse_media(
        self,
        media_content_id: str | None,
    ) -> BrowseMedia:
        """Return the requested Audiobookshelf branch for this virtual player."""
        await self._async_refresh_translations()
        identifier = media_content_id or ""
        data = self._coordinator.data

        if not identifier:
            return self._browse_root(data)
        if identifier == "continue_listening":
            return self._browse_continue_listening(data)
        if identifier == "audiobooks":
            return self._browse_audiobooks(data)
        if identifier == "podcasts":
            return self._browse_podcasts(data)
        if identifier.startswith("podcast/"):
            return await self._async_browse_podcast(identifier, data)

        msg = f"Unknown media identifier: {identifier}"
        raise HomeAssistantError(msg)

    async def _async_refresh_translations(self) -> None:
        """Refresh labels so library names follow Home Assistant language changes."""
        current_language = self._hass.config.language
        try:
            translations = await async_get_translations(
                self._hass,
                current_language,
                "media_source",
                {DOMAIN},
            )
        except (HomeAssistantError, OSError) as err:
            LOGGER.debug(
                "Could not refresh media library translations for %s: %s",
                current_language,
                err,
            )
        else:
            self._translations = translations

    def _translate(
        self,
        key: str,
        fallback: str,
        placeholders: Mapping[str, str] | None = None,
    ) -> str:
        """Return a localized media library label with an English fallback."""
        translation_key = f"component.{DOMAIN}.media_source.{key}"
        value = self._translations.get(translation_key, fallback)
        return value.format_map(placeholders or {})

    def _browse_root(self, data: AbstpData) -> BrowseMedia:
        """Build the library entry point presented when the player is selected."""
        continue_listening_title = self._translate(
            "continue_listening", "Continue Listening"
        )
        audiobooks_title = self._translate("audiobooks", "Audiobooks")
        podcasts_title = self._translate("podcasts", "Podcasts")
        return BrowseMedia(
            media_class=MediaClass.DIRECTORY,
            media_content_id="",
            media_content_type=MediaType.MUSIC,
            title=self._translate("name", "Audiobookshelf"),
            can_play=False,
            can_expand=True,
            children_media_class=MediaClass.DIRECTORY,
            children=[
                BrowseMedia(
                    media_class=MediaClass.DIRECTORY,
                    media_content_id="continue_listening",
                    media_content_type=MediaType.MUSIC,
                    title=f"{continue_listening_title} ({data.in_progress_count})",
                    can_play=False,
                    can_expand=True,
                    children_media_class=MediaClass.MUSIC,
                ),
                BrowseMedia(
                    media_class=MediaClass.DIRECTORY,
                    media_content_id="audiobooks",
                    media_content_type=MediaType.MUSIC,
                    title=f"{audiobooks_title} ({data.books_count})",
                    can_play=False,
                    can_expand=True,
                    children_media_class=MediaClass.MUSIC,
                ),
                BrowseMedia(
                    media_class=MediaClass.DIRECTORY,
                    media_content_id="podcasts",
                    media_content_type=MediaType.PODCAST,
                    title=f"{podcasts_title} ({data.podcasts_count})",
                    can_play=False,
                    can_expand=True,
                    children_media_class=MediaClass.PODCAST,
                ),
            ],
        )

    def _browse_continue_listening(self, data: AbstpData) -> BrowseMedia:
        """Build resumable items while preserving podcast episode identity."""
        children = [
            BrowseMedia(
                media_class=MediaClass.MUSIC,
                media_content_id=(
                    f"in_progress/{item.id}/{item.episode_id}"
                    if item.episode_id
                    else f"in_progress/{item.id}"
                ),
                media_content_type=MediaType.MUSIC,
                title=(
                    f"{item.title}: {item.episode_title}"
                    if item.episode_title
                    else (
                        f"{item.title} - {item.author}" if item.author else item.title
                    )
                ),
                can_play=True,
                can_expand=False,
                thumbnail=(
                    f"/api/abstp_controller/cover/{item.id}" if item.cover_url else None
                ),
            )
            for item in data.in_progress
        ]
        return BrowseMedia(
            media_class=MediaClass.DIRECTORY,
            media_content_id="continue_listening",
            media_content_type=MediaType.MUSIC,
            title=self._translate("continue_listening", "Continue Listening"),
            can_play=False,
            can_expand=True,
            children_media_class=MediaClass.MUSIC,
            children=children,
        )

    def _browse_audiobooks(self, data: AbstpData) -> BrowseMedia:
        """Build the audiobooks branch from the latest coordinator data."""
        children = [
            BrowseMedia(
                media_class=MediaClass.MUSIC,
                media_content_id=f"book/{book.id}",
                media_content_type=MediaType.MUSIC,
                title=f"{book.title} - {book.author}" if book.author else book.title,
                can_play=True,
                can_expand=False,
                thumbnail=(
                    f"/api/abstp_controller/cover/{book.id}" if book.cover_url else None
                ),
            )
            for book in data.books
        ]
        return BrowseMedia(
            media_class=MediaClass.DIRECTORY,
            media_content_id="audiobooks",
            media_content_type=MediaType.MUSIC,
            title=self._translate("audiobooks", "Audiobooks"),
            can_play=False,
            can_expand=True,
            children_media_class=MediaClass.MUSIC,
            children=children,
        )

    def _browse_podcasts(self, data: AbstpData) -> BrowseMedia:
        """Build expandable podcast directories from the latest coordinator data."""
        children = [
            BrowseMedia(
                media_class=MediaClass.PODCAST,
                media_content_id=f"podcast/{podcast.id}",
                media_content_type=MediaType.PODCAST,
                title=podcast.title,
                can_play=False,
                can_expand=True,
                thumbnail=(
                    f"/api/abstp_controller/cover/{podcast.id}"
                    if podcast.cover_url
                    else None
                ),
                children_media_class=MediaClass.MUSIC,
            )
            for podcast in data.podcasts
        ]
        return BrowseMedia(
            media_class=MediaClass.DIRECTORY,
            media_content_id="podcasts",
            media_content_type=MediaType.PODCAST,
            title=self._translate("podcasts", "Podcasts"),
            can_play=False,
            can_expand=True,
            children_media_class=MediaClass.PODCAST,
            children=children,
        )

    async def _async_browse_podcast(
        self,
        identifier: str,
        data: AbstpData,
    ) -> BrowseMedia:
        """Fetch episodes on demand so the player exposes the current podcast feed."""
        podcast_id = identifier.split("/", 1)[1]
        try:
            episodes = await self._coordinator.client.async_get_podcast_episodes(
                podcast_id
            )
        except (AbstpApiError, AbstpConnectionError, AbstpAuthError) as err:
            msg = f"Failed to fetch podcast episodes: {err}"
            raise HomeAssistantError(msg) from err

        podcast_title = self._translate("episodes", "Episodes")
        podcast_thumbnail: str | None = None
        for podcast in data.podcasts:
            if podcast.id == podcast_id:
                podcast_title = podcast.title
                if podcast.cover_url:
                    podcast_thumbnail = f"/api/abstp_controller/cover/{podcast.id}"
                break

        return BrowseMedia(
            media_class=MediaClass.PODCAST,
            media_content_id=identifier,
            media_content_type=MediaType.PODCAST,
            title=podcast_title,
            can_play=False,
            can_expand=True,
            children_media_class=MediaClass.MUSIC,
            children=[
                BrowseMedia(
                    media_class=MediaClass.MUSIC,
                    media_content_id=f"episode/{podcast_id}/{episode.id}",
                    media_content_type=MediaType.MUSIC,
                    title=episode.title
                    or self._translate(
                        "episode",
                        f"Episode {episode.episode or episode.id}",
                        {"number": str(episode.episode or episode.id)},
                    ),
                    can_play=True,
                    can_expand=False,
                    thumbnail=podcast_thumbnail,
                )
                for episode in episodes
            ],
        )
