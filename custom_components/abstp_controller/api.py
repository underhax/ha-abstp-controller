"""Asynchronous API client for Audiobookshelf Transcoder Proxy (abstp)."""

from dataclasses import dataclass
from typing import TYPE_CHECKING, cast

from aiohttp import ClientError, ClientResponseError, ClientTimeout

if TYPE_CHECKING:
    from aiohttp import ClientSession

REQUEST_TIMEOUT_SECONDS = 15


class AbstpApiError(Exception):
    """Base exception for abstp client communication errors."""


class AbstpAuthError(AbstpApiError):
    """Authentication or authorization failure when communicating with abstp."""


class AbstpConnectionError(AbstpApiError):
    """Network connection failure or timeout when reaching abstp."""


@dataclass(frozen=True, slots=True)
class MediaItem:
    """Representation of an Audiobookshelf library item."""

    id: str
    title: str
    author: str
    media_type: str
    cover_url: str | None = None
    duration: float = 0.0
    progress: float = 0.0
    is_finished: bool = False


@dataclass(frozen=True, slots=True)
class PodcastEpisode:
    """Representation of an individual podcast episode."""

    id: str
    title: str
    season: str | None = None
    episode: str | None = None
    published_at: str | None = None
    duration: float = 0.0
    progress: float = 0.0
    is_finished: bool = False


@dataclass(frozen=True, slots=True)
class InProgressItem:
    """Representation of an in-progress audiobook or podcast episode."""

    id: str
    title: str
    author: str
    media_type: str
    current_time: float
    duration: float
    progress: float
    cover_url: str | None = None
    narrator: str | None = None
    episode_id: str | None = None
    episode_title: str | None = None


@dataclass(frozen=True, slots=True)
class PlaySession:
    """Active real-time audio transcoding session descriptor."""

    session_id: str
    stream_url: str
    current_time: float
    duration: float


class AbstpApiClient:
    """Asynchronous client interacting with the abstp proxy REST endpoints."""

    _session: ClientSession
    _base_url: str
    _api_key: str

    def __init__(self, session: ClientSession, base_url: str, api_key: str) -> None:
        """Initialize the API client with connection parameters."""
        self._session = session
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key

    @property
    def base_url(self) -> str:
        """Return the configured base URL for the abstp instance."""
        return self._base_url

    def _get_headers(self) -> dict[str, str]:
        """Construct standard authorization and content-type headers."""
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_data: dict[str, object] | None = None,
        auth_required: bool = True,
    ) -> object:
        """Execute an asynchronous HTTP request with error classification."""
        url = f"{self._base_url}{path}"
        headers = self._get_headers() if auth_required else {}
        timeout = ClientTimeout(total=REQUEST_TIMEOUT_SECONDS)

        try:
            async with self._session.request(
                method,
                url,
                json=json_data,
                headers=headers,
                timeout=timeout,
            ) as response:
                if response.status in (401, 403):
                    msg = f"Auth failed for {url} with status {response.status}"
                    raise AbstpAuthError(msg)
                response.raise_for_status()
                return cast("object", await response.json())
        except ClientResponseError as err:
            if err.status in (401, 403):
                msg = f"Authentication failed with status {err.status}"
                raise AbstpAuthError(msg) from err
            msg = f"HTTP error {err.status} received from abstp: {err.message}"
            raise AbstpApiError(msg) from err
        except (ClientError, TimeoutError) as err:
            msg = f"Failed to connect to abstp at {url}: {err}"
            raise AbstpConnectionError(msg) from err

    async def async_get_health(self) -> bool:
        """Verify server responsiveness and liveness probe status."""
        try:
            data = await self._request("GET", "/health", auth_required=False)
        except AbstpApiError:
            return False
        else:
            if isinstance(data, dict):
                typed_data = cast("dict[str, object]", data)
                return typed_data.get("status") == "ok"
            return False

    async def async_get_books(self) -> list[MediaItem]:
        """Fetch all audiobook catalog entries with duration and progress."""
        data = await self._request("GET", "/api/proxy/books")
        if not isinstance(data, list):
            return []

        books: list[MediaItem] = []
        raw_list = cast("list[object]", data)
        for raw_item in raw_list:
            if isinstance(raw_item, dict):
                item = cast("dict[str, object]", raw_item)
                item_id = str(item.get("id", ""))
                if not item_id:
                    continue
                cover = str(item.get("coverUrl", "")) if item.get("coverUrl") else None
                books.append(
                    MediaItem(
                        id=item_id,
                        title=str(item.get("title", "")),
                        author=str(item.get("author", "")),
                        media_type="book",
                        cover_url=cover,
                        duration=float(str(item.get("duration", 0.0))),
                        progress=float(str(item.get("progress", 0.0))),
                        is_finished=bool(item.get("isFinished", False)),
                    )
                )
        return books

    async def async_get_podcasts(self) -> list[MediaItem]:
        """Fetch all podcast channel entries."""
        data = await self._request("GET", "/api/proxy/podcasts")
        if not isinstance(data, list):
            return []

        podcasts: list[MediaItem] = []
        raw_list = cast("list[object]", data)
        for raw_item in raw_list:
            if isinstance(raw_item, dict):
                item = cast("dict[str, object]", raw_item)
                item_id = str(item.get("id", ""))
                if not item_id:
                    continue
                cover = str(item.get("coverUrl", "")) if item.get("coverUrl") else None
                podcasts.append(
                    MediaItem(
                        id=item_id,
                        title=str(item.get("title", "")),
                        author=str(item.get("author", "")),
                        media_type="podcast",
                        cover_url=cover,
                        duration=float(str(item.get("duration", 0.0))),
                        progress=float(str(item.get("progress", 0.0))),
                        is_finished=bool(item.get("isFinished", False)),
                    )
                )
        return podcasts

    async def async_get_in_progress(self) -> list[InProgressItem]:
        """Fetch all in-progress media items with current playback offsets."""
        data = await self._request("GET", "/api/proxy/in-progress")
        if not isinstance(data, list):
            return []

        items: list[InProgressItem] = []
        raw_list = cast("list[object]", data)
        for raw_item in raw_list:
            if isinstance(raw_item, dict):
                item = cast("dict[str, object]", raw_item)
                item_id = str(item.get("id", ""))
                if not item_id:
                    continue
                cover = str(item.get("coverUrl", "")) if item.get("coverUrl") else None
                narrator = (
                    str(item.get("narrator", "")) if item.get("narrator") else None
                )
                ep_id = (
                    str(item.get("episodeId", "")) if item.get("episodeId") else None
                )
                ep_title = (
                    str(item.get("episodeTitle", ""))
                    if item.get("episodeTitle")
                    else None
                )
                items.append(
                    InProgressItem(
                        id=item_id,
                        title=str(item.get("title", "")),
                        author=str(item.get("author", "")),
                        media_type=str(item.get("mediaType", "book")),
                        cover_url=cover,
                        narrator=narrator,
                        episode_id=ep_id,
                        episode_title=ep_title,
                        duration=float(str(item.get("duration", 0.0))),
                        progress=float(str(item.get("progress", 0.0))),
                        current_time=float(str(item.get("currentTime", 0.0))),
                    )
                )
        return items

    async def async_get_podcast_episodes(self, podcast_id: str) -> list[PodcastEpisode]:
        """Fetch individual episodes for a specified podcast collection."""
        data = await self._request("GET", f"/api/proxy/podcasts/{podcast_id}/episodes")
        raw_list: object = data
        if isinstance(data, dict):
            raw_dict = cast("dict[str, object]", data)
            if "episodes" in raw_dict and isinstance(raw_dict["episodes"], list):
                raw_list = cast("list[object]", raw_dict["episodes"])

        if not isinstance(raw_list, list):
            return []

        episodes: list[PodcastEpisode] = []
        items = cast("list[object]", raw_list)
        for raw_ep in items:
            if isinstance(raw_ep, dict):
                ep = cast("dict[str, object]", raw_ep)
                ep_id = str(ep.get("id", ""))
                if not ep_id:
                    continue
                pub_at = ep.get("publishedAt") or ep.get("published_at")
                episodes.append(
                    PodcastEpisode(
                        id=ep_id,
                        title=str(ep.get("title", "")),
                        season=str(ep.get("season", "")) if ep.get("season") else None,
                        episode=str(ep.get("episode", ""))
                        if ep.get("episode")
                        else None,
                        published_at=str(pub_at) if pub_at else None,
                        duration=float(str(ep.get("duration", 0.0))),
                        progress=float(str(ep.get("progress", 0.0))),
                        is_finished=bool(ep.get("isFinished", False)),
                    )
                )
        return episodes

    async def async_start_session(
        self,
        item_id: str,
        episode_id: str | None = None,
        speed: float = 1.0,
        current_time: float = 0.0,
    ) -> PlaySession:
        """Initiate a real-time transcoding session on abstp."""
        payload: dict[str, object] = {
            "item_id": item_id,
            "speed": speed,
            "current_time": current_time,
        }
        if episode_id:
            payload["episode_id"] = episode_id

        data = await self._request(
            "POST", "/api/proxy/session/start", json_data=payload
        )
        if not isinstance(data, dict):
            msg = "Unexpected response format when starting session"
            raise AbstpApiError(msg)

        resp = cast("dict[str, object]", data)
        return PlaySession(
            session_id=str(resp.get("session_id", "")),
            stream_url=str(resp.get("stream_url", "")),
            current_time=float(str(resp.get("current_time", 0.0))),
            duration=float(str(resp.get("duration", 0.0))),
        )

    async def async_stop_session(self, session_id: str) -> bool:
        """Terminate active session and trigger final progress commit on ABS."""
        payload: dict[str, object] = {"session_id": session_id}
        data = await self._request("POST", "/api/proxy/session/stop", json_data=payload)
        if isinstance(data, dict):
            resp = cast("dict[str, object]", data)
            return resp.get("status") == "stopped"
        return False
