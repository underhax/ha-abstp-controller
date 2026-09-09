"""Unit tests for integration lifecycle setup and unloading."""

import asyncio
from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

import pytest
from aiohttp import ClientError, web
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.network import NoURLAvailableError

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable, Coroutine

    from homeassistant.core import HomeAssistant

from custom_components.abstp_controller import (
    AbstpCoverView,
    AbstpStaticResource,
    AbstpStreamView,
    async_remove_entry,
    async_setup_entry,
    async_unload_entry,
    register_static_path,
)
from custom_components.abstp_controller.const import (
    CONF_API_KEY,
    CONF_DEFAULT_SPEED,
    CONF_URL,
    DOMAIN,
)
from custom_components.abstp_controller.preferences import CardPreferenceStore
from custom_components.abstp_controller.tracker import SessionTracker


async def test_async_setup_and_unload_entry(hass: HomeAssistant) -> None:
    """Test standard setup and unload cycle."""
    entry = MagicMock(spec=ConfigEntry)
    entry_id = "test_entry_id"
    entry.entry_id = entry_id
    entry.data = {
        CONF_URL: "http://abstp.example.com:8099",
        CONF_API_KEY: "test_secret_key_12345",
        CONF_DEFAULT_SPEED: 1.25,
    }
    entry.options = {CONF_DEFAULT_SPEED: 1.25}
    mock_add_listener = MagicMock()
    entry.add_update_listener = mock_add_listener
    entry.async_on_unload = MagicMock()

    with (
        patch(
            "custom_components.abstp_controller.coordinator.AbstpDataUpdateCoordinator.async_config_entry_first_refresh",
            new_callable=AsyncMock,
        ),
        patch(
            "custom_components.abstp_controller.async_register_resource",
            new_callable=AsyncMock,
        ),
        patch(
            "custom_components.abstp_controller.register_static_path",
        ),
        patch(
            "homeassistant.config_entries.ConfigEntries.async_forward_entry_setups",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "homeassistant.config_entries.ConfigEntries.async_unload_platforms",
            new_callable=AsyncMock,
            return_value=True,
        ),
    ):
        result = await async_setup_entry(hass, entry)
        assert result is True
        assert DOMAIN in hass.data
        assert entry_id in hass.data[DOMAIN]

        update_listener = cast(
            "Callable[[HomeAssistant, ConfigEntry], Coroutine[object, object, None]]",
            mock_add_listener.call_args[0][0],
        )
        with patch.object(
            hass.config_entries, "async_reload", new_callable=AsyncMock
        ) as mock_reload:
            await update_listener(hass, entry)
            mock_reload.assert_awaited_once_with(entry_id)

        unload_result = await async_unload_entry(hass, entry)
        assert unload_result is True
        assert entry_id not in hass.data[DOMAIN]


async def test_async_remove_entry(hass: HomeAssistant) -> None:
    """Test integration removal unregisters Lovelace resource."""
    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_id"

    preference_store = MagicMock()
    preference_remove = AsyncMock()
    preference_store.configure_mock(async_remove=preference_remove)
    with (
        patch(
            "custom_components.abstp_controller.async_unregister_resource",
            new_callable=AsyncMock,
        ) as mock_unregister,
        patch(
            "custom_components.abstp_controller.async_get_card_preference_store",
            return_value=preference_store,
        ),
    ):
        await async_remove_entry(hass, entry)
        mock_unregister.assert_called_once_with(hass)

    preference_remove.assert_awaited_once_with()


async def test_abstp_cover_view(hass: HomeAssistant) -> None:
    """Test AbstpCoverView proxies cover artwork."""
    view = AbstpCoverView()
    request = MagicMock()
    request.app = {"hass": hass}

    hass.data[DOMAIN] = {}
    resp_404 = await view.get(request, "book_1")
    assert resp_404.status == 404

    mock_client = MagicMock()
    mock_client.base_url = "http://abstp.example.com:8099"
    hass.data[DOMAIN]["entry_1"] = {"client": mock_client}

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.read = AsyncMock(return_value=b"fake_image_bytes")
    mock_resp.headers = {"Content-Type": "image/jpeg"}

    mock_session = MagicMock()
    session_get = cast("MagicMock", mock_session.get)
    get_ctx = cast("MagicMock", session_get.return_value)
    get_enter = cast("MagicMock", get_ctx.__aenter__)
    get_enter.return_value = mock_resp

    with patch(
        "custom_components.abstp_controller.async_get_clientsession",
        return_value=mock_session,
    ):
        resp_200 = await view.get(request, "book_1")
        assert isinstance(resp_200, web.Response)
        assert resp_200.status == 200
        assert resp_200.body == b"fake_image_bytes"
        assert resp_200.headers["Cache-Control"] == "public, max-age=86400"
        assert (
            resp_200.headers["Content-Security-Policy"]
            == "default-src 'none'; frame-ancestors 'none';"
        )
        assert resp_200.headers["X-Content-Type-Options"] == "nosniff"
        assert resp_200.headers["X-Frame-Options"] == "DENY"
        assert view.cors_allowed is False

        request_cors = MagicMock()
        request_cors.app = {"hass": hass}
        request_cors.headers = {"Origin": "https://www.gstatic.com"}
        resp_cors = await view.get(request_cors, "book_1")
        assert resp_cors.status == 200
        assert (
            resp_cors.headers["Access-Control-Allow-Origin"]
            == "https://www.gstatic.com"
        )

        request_cors_bad = MagicMock()
        request_cors_bad.app = {"hass": hass}
        request_cors_bad.headers = {"Origin": "https://malicious.example.com"}
        resp_cors_bad = await view.get(request_cors_bad, "book_1")
        assert resp_cors_bad.status == 200
        assert "Access-Control-Allow-Origin" not in resp_cors_bad.headers


async def test_abstp_stream_view_head(hass: HomeAssistant) -> None:
    """Test AbstpStreamView handling probe HEAD requests."""
    view = AbstpStreamView()
    assert view.cors_allowed is False
    request = MagicMock()
    request.app = {"hass": hass}
    request.headers = {}
    request.query = {"token": "xyz"}
    request.get = MagicMock(return_value=False)

    hass.data[DOMAIN] = {}
    resp_404 = await view.head(request, "sess_1")
    assert resp_404.status == 404
    assert (
        resp_404.headers["Content-Security-Policy"]
        == "default-src 'none'; frame-ancestors 'none';"
    )

    mock_tracker = MagicMock(spec=SessionTracker)
    mock_tracker.is_backend_terminated = MagicMock(return_value=False)
    mock_tracker.validate_stream_token = MagicMock(return_value=True)
    mock_tracker.get_session_by_id = MagicMock(return_value=None)
    stream_url_mock = cast("MagicMock", mock_tracker.get_stream_url)
    stream_url_mock.return_value = None
    hass.data[DOMAIN]["entry_1"] = {"tracker": mock_tracker}

    resp_not_found = await view.head(request, "sess_1")
    assert resp_not_found.status == 404

    stream_url_mock.return_value = "http://example.com:8099/stream/sess_1.aac?token=xyz"
    request.headers = {"Origin": "https://www.gstatic.com"}
    resp_200 = await view.head(request, "sess_1")
    assert resp_200.status == 200
    assert resp_200.content_type == "audio/aac"
    assert resp_200.headers["Cache-Control"] == "no-cache, no-store"
    assert resp_200.headers["Accept-Ranges"] == "none"
    assert resp_200.headers["Access-Control-Allow-Origin"] == "https://www.gstatic.com"
    assert (
        resp_200.headers["Content-Security-Policy"]
        == "default-src 'none'; frame-ancestors 'none';"
    )
    assert resp_200.headers["X-Content-Type-Options"] == "nosniff"
    assert resp_200.headers["X-Frame-Options"] == "DENY"

    cast("MagicMock", mock_tracker.validate_stream_token).return_value = False
    resp_unauth = await view.head(request, "sess_1")
    assert resp_unauth.status == 401

    cast("MagicMock", mock_tracker.validate_stream_token).return_value = True
    cast("MagicMock", mock_tracker.is_backend_terminated).return_value = True
    resp_410 = await view.head(request, "sess_1")
    assert resp_410.status == 410


async def test_abstp_stream_view_get_not_found(hass: HomeAssistant) -> None:
    """Test AbstpStreamView returns 404 for missing tracker or session."""
    view = AbstpStreamView()
    request = MagicMock()
    request.app = {"hass": hass}
    request.headers = {}
    request.query = {"token": "xyz"}
    request.get = MagicMock(return_value=False)

    hass.data[DOMAIN] = {}
    resp = await view.get(request, "sess_missing")
    assert resp.status == 404
    assert (
        resp.headers["Content-Security-Policy"]
        == "default-src 'none'; frame-ancestors 'none';"
    )

    mock_tracker = MagicMock(spec=SessionTracker)
    mock_tracker.is_backend_terminated = MagicMock(return_value=False)
    mock_tracker.validate_stream_token = MagicMock(return_value=True)
    mock_tracker.get_session_by_id = MagicMock(return_value=None)
    stream_url_mock = cast("MagicMock", mock_tracker.get_stream_url)
    stream_url_mock.return_value = None
    hass.data[DOMAIN]["entry_1"] = {"tracker": mock_tracker}
    resp_2 = await view.get(request, "sess_missing")
    assert resp_2.status == 404


async def test_abstp_stream_view_get_success(hass: HomeAssistant) -> None:
    """Test AbstpStreamView streams chunks and forwards metadata headers."""
    view = AbstpStreamView()
    request = MagicMock()
    request.app = {"hass": hass}
    request.headers = {}
    request.query = {"token": "secret"}
    request.get = MagicMock(return_value=False)

    mock_tracker = MagicMock(spec=SessionTracker)
    mock_tracker.is_backend_terminated = MagicMock(return_value=False)
    mock_tracker.validate_stream_token = MagicMock(return_value=True)
    mock_tracker.get_session_by_id = MagicMock(return_value=None)
    stream_url_mock = cast("MagicMock", mock_tracker.get_stream_url)
    stream_url_mock.return_value = (
        "http://example.com:8099/stream/sess_ok.aac?token=secret"
    )
    hass.data[DOMAIN] = {"entry_1": {"tracker": mock_tracker}}

    async def _mock_iter_chunks() -> AsyncIterator[tuple[bytes, bool]]:
        yield b"chunk_one", True
        yield b"chunk_two", True

    mock_content = MagicMock()
    mock_content.iter_chunks = _mock_iter_chunks

    mock_upstream = MagicMock()
    mock_upstream.status = 200
    mock_upstream.content = mock_content
    mock_upstream.headers = {
        "Content-Type": "audio/aac",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none';",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "icy-genre": "Audiobook",
        "icy-name": "Test Book • Author",
        "icy-description": "Narrator",
        "icy-logo": "http://127.0.0.1:8099/api/proxy/covers/item_123",
        "icy-url": "http://127.0.0.1:8099/api/proxy/covers/item_123",
    }

    mock_session = MagicMock()
    session_get = cast("MagicMock", mock_session.get)
    get_ctx = cast("MagicMock", session_get.return_value)
    get_enter = cast("MagicMock", get_ctx.__aenter__)
    get_enter.return_value = mock_upstream

    with (
        patch(
            "custom_components.abstp_controller.async_get_clientsession",
            return_value=mock_session,
        ),
        patch(
            "custom_components.abstp_controller.get_url",
            return_value="http://example.com",
        ),
        patch.object(
            web.StreamResponse, "prepare", new_callable=AsyncMock
        ) as mock_prep,
        patch.object(web.StreamResponse, "write", new_callable=AsyncMock) as mock_write,
        patch.object(
            web.StreamResponse, "write_eof", new_callable=AsyncMock
        ) as mock_eof,
    ):
        resp = await view.get(request, "sess_ok")
        assert isinstance(resp, web.StreamResponse)
        assert resp.status == 200
        assert resp.headers["icy-genre"] == "Audiobook"
        assert resp.headers["icy-name"] == "Test Book • Author"
        assert resp.headers["icy-description"] == "Narrator"
        assert (
            resp.headers["icy-logo"]
            == "http://example.com/api/abstp_controller/cover/item_123"
        )
        assert (
            resp.headers["icy-url"]
            == "http://example.com/api/abstp_controller/cover/item_123"
        )
        assert resp.headers["Cache-Control"] == "no-cache, no-store"
        assert resp.headers["Accept-Ranges"] == "none"
        assert (
            resp.headers["Content-Security-Policy"]
            == "default-src 'none'; frame-ancestors 'none';"
        )
        assert resp.headers["X-Content-Type-Options"] == "nosniff"
        assert resp.headers["X-Frame-Options"] == "DENY"
        assert resp.chunked is True
        mock_prep.assert_awaited_once_with(request)
        assert mock_write.await_count == 2
        mock_eof.assert_awaited_once()
        cast("MagicMock", mock_tracker.notify_stream_closed).assert_called_once_with(
            "sess_ok"
        )


async def test_abstp_stream_view_get_upstream_error(hass: HomeAssistant) -> None:
    """Test AbstpStreamView propagates non-200 upstream error status codes."""
    view = AbstpStreamView()
    request = MagicMock()
    request.app = {"hass": hass}
    request.headers = {}
    request.query = {"token": "bad"}
    request.get = MagicMock(return_value=False)

    mock_tracker = MagicMock(spec=SessionTracker)
    mock_tracker.is_backend_terminated = MagicMock(return_value=False)
    mock_tracker.validate_stream_token = MagicMock(return_value=True)
    mock_tracker.get_session_by_id = MagicMock(return_value=None)
    stream_url_mock = cast("MagicMock", mock_tracker.get_stream_url)
    stream_url_mock.return_value = (
        "http://example.com:8099/stream/sess_err.aac?token=bad"
    )
    hass.data[DOMAIN] = {"entry_1": {"tracker": mock_tracker}}

    mock_upstream = MagicMock()
    mock_upstream.status = 401

    mock_session = MagicMock()
    session_get = cast("MagicMock", mock_session.get)
    get_ctx = cast("MagicMock", session_get.return_value)
    get_enter = cast("MagicMock", get_ctx.__aenter__)
    get_enter.return_value = mock_upstream

    with patch(
        "custom_components.abstp_controller.async_get_clientsession",
        return_value=mock_session,
    ):
        resp = await view.get(request, "sess_err")
        assert isinstance(resp, web.Response)
        assert resp.status == 401
        cast("MagicMock", mock_tracker.notify_stream_closed).assert_called_once_with(
            "sess_err"
        )


async def test_abstp_stream_view_get_connection_error(hass: HomeAssistant) -> None:
    """Test AbstpStreamView returns 502 when backend connection fails."""
    view = AbstpStreamView()
    request = MagicMock()
    request.app = {"hass": hass}
    request.headers = {}
    request.query = {"token": "bad"}
    request.get = MagicMock(return_value=False)

    mock_tracker = MagicMock(spec=SessionTracker)
    mock_tracker.is_backend_terminated = MagicMock(return_value=False)
    mock_tracker.validate_stream_token = MagicMock(return_value=True)
    mock_tracker.get_session_by_id = MagicMock(return_value=None)
    stream_url_mock = cast("MagicMock", mock_tracker.get_stream_url)
    stream_url_mock.return_value = (
        "http://example.com:8099/stream/sess_fail.aac?token=bad"
    )
    hass.data[DOMAIN] = {"entry_1": {"tracker": mock_tracker}}

    mock_session = MagicMock()
    session_get = cast("MagicMock", mock_session.get)
    session_get.side_effect = ClientError("Connection failed")

    with patch(
        "custom_components.abstp_controller.async_get_clientsession",
        return_value=mock_session,
    ):
        resp = await view.get(request, "sess_fail")
        assert isinstance(resp, web.Response)
        assert resp.status == 502
        cast("MagicMock", mock_tracker.notify_stream_closed).assert_called_once_with(
            "sess_fail"
        )


async def test_register_static_path_idempotent(hass: HomeAssistant) -> None:
    """Test register_static_path registers resources and views only once."""
    mock_router = MagicMock()
    mock_app = MagicMock()
    mock_app.router = mock_router
    getitem_mock = cast("MagicMock", mock_app.__getitem__)
    getitem_mock.return_value = MagicMock()
    mock_http = MagicMock()
    mock_http.app = mock_app
    with (
        patch.object(hass, "http", mock_http),
        patch("custom_components.abstp_controller.AbstpStaticResource") as mock_res_cls,
    ):
        mock_resource = MagicMock()
        mock_res_cls.return_value = mock_resource

        register_static_path(hass)
        assert hass.data[DOMAIN]["static_path_registered"] is True
        reg_res_mock = cast("MagicMock", mock_router.register_resource)
        reg_res_mock.assert_called_once_with(mock_resource)
        reg_view_mock = cast("MagicMock", mock_http.register_view)
        assert reg_view_mock.call_count == 2

        register_static_path(hass)
        reg_res_mock.assert_called_once_with(mock_resource)
        assert reg_view_mock.call_count == 2


@pytest.mark.parametrize(
    ("origin", "expected_cors"),
    [
        ("http://internal.example.com", True),
        ("https://external.example.com", True),
        ("http://base.example.com", True),
        ("http://direct.example.com", True),
        ("https://untrusted.example.org", False),
    ],
)
async def test_resolve_cors_headers_origins(
    hass: HomeAssistant, origin: str, expected_cors: bool
) -> None:
    """Validate CORS header resolution against internal, external, and base URLs."""
    hass.config.internal_url = "http://internal.example.com"
    hass.config.external_url = "https://external.example.com"
    hass.data[DOMAIN] = {}
    view = AbstpCoverView()
    request = MagicMock(spec=web.Request)
    request.app = {"hass": hass}
    request.headers = {"Origin": origin}
    request.host = "direct.example.com"
    with patch(
        "custom_components.abstp_controller.get_url",
        return_value="http://base.example.com",
    ):
        resp = await view.get(request, "book_1")
        if expected_cors:
            assert resp.headers.get("Access-Control-Allow-Origin") == origin
        else:
            assert "Access-Control-Allow-Origin" not in resp.headers


async def test_abstp_static_resource_handle() -> None:
    """Verify that AbstpStaticResource attaches revalidation cache control headers."""
    resource = AbstpStaticResource("/prefix", "/tmp")
    route = next(iter(resource))
    request = MagicMock(spec=web.Request)
    fake_response = web.Response()
    with patch.object(
        web.StaticResource,
        "_handle",
        new_callable=AsyncMock,
        return_value=fake_response,
    ) as mock_super_handle:
        result = await route.handler(request)
        mock_super_handle.assert_awaited_once_with(request)
        assert result.headers["Cache-Control"] == "no-cache, max-age=0, must-revalidate"


async def test_abstp_cover_view_upstream_non_200(hass: HomeAssistant) -> None:
    """Ensure AbstpCoverView proxies upstream non-200 response codes."""
    view = AbstpCoverView()
    request = MagicMock()
    request.app = {"hass": hass}
    request.headers = {}
    mock_client = MagicMock()
    mock_client.base_url = "http://abstp.example.com:8099"
    hass.data[DOMAIN] = {"entry_1": {"client": mock_client}}

    mock_resp = MagicMock()
    mock_resp.status = 500

    mock_session = MagicMock()
    session_get = cast("MagicMock", mock_session.get)
    get_ctx = cast("MagicMock", session_get.return_value)
    get_enter = cast("MagicMock", get_ctx.__aenter__)
    get_enter.return_value = mock_resp

    with patch(
        "custom_components.abstp_controller.async_get_clientsession",
        return_value=mock_session,
    ):
        resp = await view.get(request, "book_1")
        assert resp.status == 500


@pytest.mark.parametrize(
    "error_cls",
    [ClientError, TimeoutError],
)
async def test_abstp_cover_view_network_errors(
    hass: HomeAssistant, error_cls: type[Exception]
) -> None:
    """Ensure AbstpCoverView handles client or timeout errors by returning 404."""
    view = AbstpCoverView()
    request = MagicMock()
    request.app = {"hass": hass}
    request.headers = {}
    mock_client = MagicMock()
    mock_client.base_url = "http://abstp.example.com:8099"
    hass.data[DOMAIN] = {"entry_1": {"client": mock_client}}

    mock_session = MagicMock()
    session_get = cast("MagicMock", mock_session.get)
    session_get.side_effect = error_cls("Upstream failure")

    with patch(
        "custom_components.abstp_controller.async_get_clientsession",
        return_value=mock_session,
    ):
        resp = await view.get(request, "book_1")
        assert resp.status == 404


async def test_abstp_stream_view_head_forbidden_player(
    hass: HomeAssistant,
) -> None:
    """Ensure AbstpStreamView head returns 403 when media player is not allowed."""
    view = AbstpStreamView()
    request = MagicMock()
    request.app = {"hass": hass}
    request.headers = {}
    request.query = {"token": "valid_token"}
    request.get = MagicMock(return_value=False)

    mock_session_obj = MagicMock()
    mock_session_obj.entity_id = "media_player.unauthorized"

    mock_tracker = MagicMock(spec=SessionTracker)
    mock_tracker.is_backend_terminated = MagicMock(return_value=False)
    mock_tracker.validate_stream_token = MagicMock(return_value=True)
    mock_tracker.get_session_by_id = MagicMock(return_value=mock_session_obj)
    stream_url_mock = cast("MagicMock", mock_tracker.get_stream_url)
    stream_url_mock.return_value = "http://example.com:8099/stream/sess_1.aac"
    hass.data[DOMAIN] = {"entry_1": {"tracker": mock_tracker}}

    with patch(
        "custom_components.abstp_controller.is_allowed_player",
        return_value=False,
    ):
        resp = await view.head(request, "sess_1")
        assert resp.status == 403


async def test_abstp_stream_view_get_terminated_unauthorized_and_forbidden(
    hass: HomeAssistant,
) -> None:
    """Ensure stream get checks termination, auth, and player permission."""
    view = AbstpStreamView()
    request = MagicMock()
    request.app = {"hass": hass}
    request.headers = {}
    request.query = {"token": "tok"}
    request.get = MagicMock(return_value=False)

    mock_tracker = MagicMock(spec=SessionTracker)
    is_backend_terminated_mock = cast("MagicMock", mock_tracker.is_backend_terminated)
    is_backend_terminated_mock.return_value = True
    hass.data[DOMAIN] = {"entry_1": {"tracker": mock_tracker}}

    resp_terminated = await view.get(request, "sess_1")
    assert resp_terminated.status == 410

    is_backend_terminated_mock.return_value = False
    stream_url_mock = cast("MagicMock", mock_tracker.get_stream_url)
    stream_url_mock.return_value = "http://example.com:8099/stream/sess_1.aac"
    validate_token_mock = cast("MagicMock", mock_tracker.validate_stream_token)
    validate_token_mock.return_value = False

    resp_unauth = await view.get(request, "sess_1")
    assert resp_unauth.status == 401

    validate_token_mock.return_value = True
    mock_session_obj = MagicMock()
    mock_session_obj.entity_id = "media_player.forbidden"
    mock_tracker.get_session_by_id = MagicMock(return_value=mock_session_obj)

    with patch(
        "custom_components.abstp_controller.is_allowed_player",
        return_value=False,
    ):
        resp_forbidden = await view.get(request, "sess_1")
        assert resp_forbidden.status == 403


async def test_abstp_stream_view_get_no_url_available_for_icy(
    hass: HomeAssistant,
) -> None:
    """Verify relative URL generation fallback when HA has no base URL."""
    view = AbstpStreamView()
    request = MagicMock()
    request.app = {"hass": hass}
    request.headers = {}
    request.query = {"token": "secret"}
    request.get = MagicMock(return_value=False)

    mock_tracker = MagicMock(spec=SessionTracker)
    mock_tracker.is_backend_terminated = MagicMock(return_value=False)
    mock_tracker.validate_stream_token = MagicMock(return_value=True)
    mock_tracker.get_session_by_id = MagicMock(return_value=None)
    stream_url_mock = cast("MagicMock", mock_tracker.get_stream_url)
    stream_url_mock.return_value = (
        "http://example.com:8099/stream/sess_ok.aac?token=secret"
    )
    hass.data[DOMAIN] = {"entry_1": {"tracker": mock_tracker}}

    async def _mock_iter_chunks() -> AsyncIterator[tuple[bytes, bool]]:
        yield b"", False

    mock_content = MagicMock()
    mock_content.iter_chunks = _mock_iter_chunks

    mock_upstream = MagicMock()
    mock_upstream.status = 200
    mock_upstream.content = mock_content
    mock_upstream.headers = {
        "icy-logo": "http://127.0.0.1:8099/api/proxy/covers/item_fallback?query=1",
    }

    mock_session = MagicMock()
    session_get = cast("MagicMock", mock_session.get)
    get_ctx = cast("MagicMock", session_get.return_value)
    get_enter = cast("MagicMock", get_ctx.__aenter__)
    get_enter.return_value = mock_upstream

    with (
        patch(
            "custom_components.abstp_controller.async_get_clientsession",
            return_value=mock_session,
        ),
        patch(
            "custom_components.abstp_controller.get_url",
            side_effect=NoURLAvailableError,
        ),
        patch.object(web.StreamResponse, "prepare", new_callable=AsyncMock),
        patch.object(web.StreamResponse, "write_eof", new_callable=AsyncMock),
    ):
        resp = await view.get(request, "sess_ok")
        assert isinstance(resp, web.StreamResponse)
        assert resp.headers["icy-logo"] == "/api/abstp_controller/cover/item_fallback"


async def test_abstp_stream_view_get_error_after_prepare(
    hass: HomeAssistant,
) -> None:
    """Return stream response when connection fails after headers are sent."""
    view = AbstpStreamView()
    request = MagicMock()
    request.app = {"hass": hass}
    request.headers = {}
    request.query = {"token": "secret"}
    request.get = MagicMock(return_value=False)

    mock_tracker = MagicMock(spec=SessionTracker)
    mock_tracker.is_backend_terminated = MagicMock(return_value=False)
    mock_tracker.validate_stream_token = MagicMock(return_value=True)
    mock_tracker.get_session_by_id = MagicMock(return_value=None)
    mock_tracker.get_stream_url = MagicMock(
        return_value="http://example.com:8099/stream/sess.aac"
    )
    hass.data[DOMAIN] = {"entry_1": {"tracker": mock_tracker}}

    async def _failing_iter_chunks() -> AsyncIterator[tuple[bytes, bool]]:
        yield b"chunk", True
        raise ConnectionResetError

    mock_content = MagicMock()
    mock_content.iter_chunks = _failing_iter_chunks

    mock_upstream = MagicMock()
    mock_upstream.status = 200
    mock_upstream.content = mock_content
    mock_upstream.headers = {}

    mock_session = MagicMock()
    session_get = cast("MagicMock", mock_session.get)
    get_ctx = cast("MagicMock", session_get.return_value)
    get_enter = cast("MagicMock", get_ctx.__aenter__)
    get_enter.return_value = mock_upstream

    with (
        patch(
            "custom_components.abstp_controller.async_get_clientsession",
            return_value=mock_session,
        ),
        patch.object(web.StreamResponse, "prepare", new_callable=AsyncMock),
        patch.object(web.StreamResponse, "write", new_callable=AsyncMock),
        patch.object(
            web.StreamResponse,
            "prepared",
            new_callable=PropertyMock,
            return_value=True,
        ),
    ):
        resp = await view.get(request, "sess")
        assert isinstance(resp, web.StreamResponse)
        cast("MagicMock", mock_tracker.notify_stream_closed).assert_called_once_with(
            "sess"
        )


async def test_abstp_stream_view_get_cancelled(hass: HomeAssistant) -> None:
    """Ensure CancelledError during stream iteration is logged and re-raised."""
    view = AbstpStreamView()
    request = MagicMock()
    request.app = {"hass": hass}
    request.headers = {}
    request.query = {"token": "secret"}
    request.get = MagicMock(return_value=False)

    mock_tracker = MagicMock(spec=SessionTracker)
    mock_tracker.is_backend_terminated = MagicMock(return_value=False)
    mock_tracker.validate_stream_token = MagicMock(return_value=True)
    mock_tracker.get_session_by_id = MagicMock(return_value=None)
    mock_tracker.get_stream_url = MagicMock(
        return_value="http://example.com:8099/stream/sess.aac"
    )
    hass.data[DOMAIN] = {"entry_1": {"tracker": mock_tracker}}

    async def _cancelled_iter_chunks() -> AsyncIterator[tuple[bytes, bool]]:
        yield b"chunk", True
        raise asyncio.CancelledError

    mock_content = MagicMock()
    mock_content.iter_chunks = _cancelled_iter_chunks

    mock_upstream = MagicMock()
    mock_upstream.status = 200
    mock_upstream.content = mock_content
    mock_upstream.headers = {}

    mock_session = MagicMock()
    session_get = cast("MagicMock", mock_session.get)
    get_ctx = cast("MagicMock", session_get.return_value)
    get_enter = cast("MagicMock", get_ctx.__aenter__)
    get_enter.return_value = mock_upstream

    with (
        patch(
            "custom_components.abstp_controller.async_get_clientsession",
            return_value=mock_session,
        ),
        patch.object(web.StreamResponse, "prepare", new_callable=AsyncMock),
        patch.object(web.StreamResponse, "write", new_callable=AsyncMock),
        pytest.raises(asyncio.CancelledError),
    ):
        _ = await view.get(request, "sess")

    cast("MagicMock", mock_tracker.notify_stream_closed).assert_called_once_with("sess")


async def test_async_remove_entry_with_remaining_entries(
    hass: HomeAssistant,
) -> None:
    """Do not delete global preferences if other integration entries exist."""
    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "entry_1"

    other_entry = MagicMock(spec=ConfigEntry)
    other_entry.entry_id = "entry_2"

    with (
        patch.object(
            hass.config_entries,
            "async_entries",
            return_value=[entry, other_entry],
        ),
        patch(
            "custom_components.abstp_controller.async_unregister_resource",
            new_callable=AsyncMock,
        ) as mock_unregister,
        patch(
            "custom_components.abstp_controller.async_get_card_preference_store",
        ) as mock_get_store,
    ):
        await async_remove_entry(hass, entry)
        mock_unregister.assert_awaited_once_with(hass)
        mock_get_store.assert_not_called()


async def test_async_remove_entry_cleans_stored_preference(
    hass: HomeAssistant,
) -> None:
    """Ensure cached card preference store is removed on last entry removal."""
    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "entry_1"

    mock_store = MagicMock(spec=CardPreferenceStore)
    preference_remove = AsyncMock()
    mock_store.configure_mock(async_remove=preference_remove)
    hass.data[DOMAIN] = {"card_preference_store": mock_store}

    with (
        patch.object(
            hass.config_entries,
            "async_entries",
            return_value=[entry],
        ),
        patch(
            "custom_components.abstp_controller.async_unregister_resource",
            new_callable=AsyncMock,
        ),
        patch(
            "custom_components.abstp_controller.async_get_card_preference_store",
            return_value=mock_store,
        ),
    ):
        await async_remove_entry(hass, entry)
        assert "card_preference_store" not in hass.data[DOMAIN]
        preference_remove.assert_awaited_once_with()
