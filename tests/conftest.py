"""Global fixtures for custom component tests."""

import pytest

from custom_components.abstp_controller.api import (
    MediaItem,
    PlaySession,
    PodcastEpisode,
)

TEST_URL = "http://abstp.example.com:8099"
TEST_API_KEY = "test_proxy_secret_key_12345"
TEST_DEFAULT_SPEED = 1.25


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(
    enable_custom_integrations: None,
) -> None:
    """Enable custom integrations loading in tests."""
    _ = enable_custom_integrations


@pytest.fixture
def mock_books() -> list[MediaItem]:
    """Return a fixture of mock audiobooks."""
    return [
        MediaItem(
            id="book_1",
            title="Dune",
            author="Frank Herbert",
            media_type="book",
            cover_url="/api/proxy/covers/book_1",
            duration=36000.0,
            progress=1200.0,
        ),
        MediaItem(
            id="book_2",
            title="Foundation",
            author="Isaac Asimov",
            media_type="book",
            cover_url="/api/proxy/covers/book_2",
            duration=28000.0,
            progress=0.0,
        ),
    ]


@pytest.fixture
def mock_podcasts() -> list[MediaItem]:
    """Return a fixture of mock podcasts."""
    return [
        MediaItem(
            id="podcast_1",
            title="Science Weekly",
            author="Science Group",
            media_type="podcast",
            cover_url="/api/proxy/covers/podcast_1",
            duration=7200.0,
            progress=500.0,
        )
    ]


@pytest.fixture
def mock_episodes() -> list[PodcastEpisode]:
    """Return a fixture of mock podcast episodes."""
    return [
        PodcastEpisode(
            id="ep_1",
            title="Episode 1: Mars Exploration",
            season="1",
            episode="1",
            published_at="2026-01-01",
            duration=1800.0,
            progress=300.0,
        ),
        PodcastEpisode(
            id="ep_2",
            title="Episode 2: Quantum Computing",
            season="1",
            episode="2",
            published_at="2026-01-08",
            duration=2400.0,
            progress=0.0,
        ),
    ]


@pytest.fixture
def mock_play_session() -> PlaySession:
    """Return a fixture of a mock playback session."""
    return PlaySession(
        session_id="sess_019234ab89cd",
        stream_url="http://abstp.example.com:8099/stream/sess_019234ab89cd.aac?token=secret123",
        current_time=1200.0,
        duration=36000.0,
    )
