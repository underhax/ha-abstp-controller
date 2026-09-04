"""Tests for the AbstpApiClient."""

from typing import cast
from unittest.mock import AsyncMock, MagicMock

import aiohttp
import pytest

from custom_components.abstp_controller.api import (
    AbstpApiClient,
    AbstpApiError,
    AbstpAuthError,
    AbstpConnectionError,
)

BASE_TEST_URL = "http://abstp.example.com:8099"


@pytest.fixture
def mock_session() -> MagicMock:
    """Return a mocked aiohttp ClientSession."""
    return MagicMock(spec=aiohttp.ClientSession)


def set_mock_response(session: MagicMock, response: MagicMock | Exception) -> None:
    """Configure mock response context manager on session."""
    req = cast("MagicMock", session.request)
    ctx = cast("MagicMock", req.return_value)
    enter = cast("MagicMock", ctx.__aenter__)
    if isinstance(response, Exception):
        enter.side_effect = response
    else:
        enter.return_value = response


async def test_get_health_success(mock_session: MagicMock) -> None:
    """Test successful health check."""
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json = AsyncMock(return_value={"status": "ok"})
    set_mock_response(mock_session, mock_response)

    client = AbstpApiClient(mock_session, BASE_TEST_URL, "test_proxy_secret_key_12345")
    result = await client.async_get_health()
    assert result is True


async def test_get_health_unauthorized(mock_session: MagicMock) -> None:
    """Test health check returning false on unauthorized."""
    mock_response = MagicMock()
    mock_response.status = 401
    mock_response.raise_for_status = MagicMock()
    set_mock_response(mock_session, mock_response)

    client = AbstpApiClient(mock_session, BASE_TEST_URL, "test_proxy_secret_key_12345")
    result = await client.async_get_health()
    assert result is False


async def test_get_health_connection_error(mock_session: MagicMock) -> None:
    """Test health check returning false on connection error."""
    err = aiohttp.ClientConnectorError(
        connection_key=MagicMock(), os_error=OSError("connection refused")
    )
    set_mock_response(mock_session, err)

    client = AbstpApiClient(mock_session, BASE_TEST_URL, "test_proxy_secret_key_12345")
    result = await client.async_get_health()
    assert result is False


async def test_get_books_unauthorized(mock_session: MagicMock) -> None:
    """Test get_books raising AbstpAuthError on 401 status."""
    mock_response = MagicMock()
    mock_response.status = 401
    mock_response.raise_for_status = MagicMock()
    set_mock_response(mock_session, mock_response)

    client = AbstpApiClient(mock_session, BASE_TEST_URL, "test_proxy_secret_key_12345")
    with pytest.raises(AbstpAuthError):
        _ = await client.async_get_books()


async def test_get_books_connection_error(mock_session: MagicMock) -> None:
    """Test get_books raising AbstpConnectionError on network failure."""
    err = aiohttp.ClientConnectorError(
        connection_key=MagicMock(), os_error=OSError("connection refused")
    )
    set_mock_response(mock_session, err)

    client = AbstpApiClient(mock_session, BASE_TEST_URL, "test_proxy_secret_key_12345")
    with pytest.raises(AbstpConnectionError):
        _ = await client.async_get_books()


async def test_get_books_success(mock_session: MagicMock) -> None:
    """Test fetching books successfully."""
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json = AsyncMock(
        return_value=[
            {
                "id": "book_1",
                "title": "Dune",
                "author": "Frank Herbert",
                "mediaType": "book",
                "coverUrl": "/api/proxy/covers/book_1",
                "duration": 36000.0,
                "progress": 1200.0,
                "isFinished": True,
            }
        ]
    )
    set_mock_response(mock_session, mock_response)

    client = AbstpApiClient(mock_session, BASE_TEST_URL, "test_proxy_secret_key_12345")
    books = await client.async_get_books()
    assert len(books) == 1
    assert books[0].id == "book_1"
    assert books[0].title == "Dune"
    assert books[0].author == "Frank Herbert"
    assert books[0].media_type == "book"
    assert books[0].is_finished is True


async def test_get_podcasts_success(mock_session: MagicMock) -> None:
    """Test fetching podcasts successfully."""
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json = AsyncMock(
        return_value=[
            {
                "id": "podcast_1",
                "title": "Science Weekly",
                "author": "Science Group",
                "mediaType": "podcast",
                "coverUrl": "/api/proxy/covers/podcast_1",
                "duration": 7200.0,
                "progress": 500.0,
            }
        ]
    )
    set_mock_response(mock_session, mock_response)

    client = AbstpApiClient(mock_session, BASE_TEST_URL, "test_proxy_secret_key_12345")
    podcasts = await client.async_get_podcasts()
    assert len(podcasts) == 1
    assert podcasts[0].id == "podcast_1"
    assert podcasts[0].title == "Science Weekly"


async def test_get_podcast_episodes_success(mock_session: MagicMock) -> None:
    """Test fetching episodes for a podcast."""
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json = AsyncMock(
        return_value=[
            {
                "id": "ep_1",
                "title": "Episode 1",
                "season": "1",
                "episode": "1",
                "publishedAt": "2026-01-01",
                "duration": 1800.0,
                "progress": 300.0,
                "isFinished": True,
            }
        ]
    )
    set_mock_response(mock_session, mock_response)

    client = AbstpApiClient(mock_session, BASE_TEST_URL, "test_proxy_secret_key_12345")
    episodes = await client.async_get_podcast_episodes("podcast_1")
    assert len(episodes) == 1
    assert episodes[0].id == "ep_1"
    assert episodes[0].title == "Episode 1"
    assert episodes[0].is_finished is True


async def test_start_session_success(mock_session: MagicMock) -> None:
    """Test starting a playback session."""
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json = AsyncMock(
        return_value={
            "session_id": "sess_123",
            "stream_url": "http://abstp.example.com:8099/stream/sess_123.aac",
            "current_time": 100.0,
            "duration": 5000.0,
        }
    )
    set_mock_response(mock_session, mock_response)

    client = AbstpApiClient(mock_session, BASE_TEST_URL, "test_proxy_secret_key_12345")
    session = await client.async_start_session(
        item_id="book_1", speed=1.5, current_time=100.0
    )
    assert session.session_id == "sess_123"
    assert session.current_time == 100.0
    assert session.duration == 5000.0


async def test_stop_session_success(mock_session: MagicMock) -> None:
    """Test stopping an active playback session."""
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json = AsyncMock(return_value={"status": "stopped"})
    set_mock_response(mock_session, mock_response)

    client = AbstpApiClient(mock_session, BASE_TEST_URL, "test_proxy_secret_key_12345")
    result = await client.async_stop_session("sess_123")
    assert result is True


async def test_api_client_error_handling(mock_session: MagicMock) -> None:
    """Test general error status handling."""
    mock_response = MagicMock()
    mock_response.status = 500
    mock_response.raise_for_status = MagicMock(
        side_effect=aiohttp.ClientResponseError(
            request_info=MagicMock(), history=(), status=500
        )
    )
    mock_response.text = AsyncMock(return_value="Internal Server Error")
    set_mock_response(mock_session, mock_response)

    client = AbstpApiClient(mock_session, BASE_TEST_URL, "test_proxy_secret_key_12345")
    with pytest.raises(AbstpApiError):
        _ = await client.async_get_books()


async def test_get_in_progress_success(mock_session: MagicMock) -> None:
    """Test fetching in-progress media items successfully."""
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json = AsyncMock(
        return_value=[
            {
                "id": "item_1",
                "title": "Book 1",
                "author": "Author 1",
                "mediaType": "book",
                "coverUrl": "/cover1.jpg",
                "duration": 1000.0,
                "progress": 250.0,
                "currentTime": 250.0,
                "narrator": "Narrator 1",
            },
            {
                "id": "podcast_1",
                "title": "Podcast 1",
                "author": "Author 2",
                "mediaType": "podcast",
                "coverUrl": "",
                "duration": 2000.0,
                "progress": 500.0,
                "currentTime": 500.0,
                "episodeId": "ep_1",
                "episodeTitle": "Ep 1",
            },
            {
                "id": "",
                "title": "Invalid Item Without ID",
            },
        ]
    )
    set_mock_response(mock_session, mock_response)

    client = AbstpApiClient(mock_session, BASE_TEST_URL, "test_proxy_secret_key_12345")
    items = await client.async_get_in_progress()
    assert len(items) == 2
    assert items[0].id == "item_1"
    assert items[0].media_type == "book"
    assert items[0].current_time == 250.0
    assert items[0].narrator == "Narrator 1"
    assert items[1].id == "podcast_1"
    assert items[1].episode_id == "ep_1"
    assert items[1].episode_title == "Ep 1"


async def test_get_in_progress_empty_and_invalid(mock_session: MagicMock) -> None:
    """Test get_in_progress with empty or non-list response structures."""
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json = AsyncMock(return_value={"error": "not a list"})
    set_mock_response(mock_session, mock_response)

    client = AbstpApiClient(mock_session, BASE_TEST_URL, "test_proxy_secret_key_12345")
    items = await client.async_get_in_progress()
    assert items == []


async def test_get_in_progress_unauthorized(mock_session: MagicMock) -> None:
    """Test get_in_progress raising AbstpAuthError on 401 status."""
    mock_response = MagicMock()
    mock_response.status = 401
    mock_response.raise_for_status = MagicMock()
    set_mock_response(mock_session, mock_response)

    client = AbstpApiClient(mock_session, BASE_TEST_URL, "test_proxy_secret_key_12345")
    with pytest.raises(AbstpAuthError):
        _ = await client.async_get_in_progress()
