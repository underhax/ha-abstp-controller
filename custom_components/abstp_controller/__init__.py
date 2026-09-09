"""The Audiobookshelf Transcoder Proxy Controller integration."""

import asyncio
from typing import TYPE_CHECKING, cast, override

from aiohttp import ClientError, ClientTimeout, web
from aiohttp.hdrs import CACHE_CONTROL
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.http import (
    KEY_ALLOW_CONFIGURED_CORS,
    HomeAssistantView,
)
from homeassistant.helpers.network import NoURLAvailableError, get_url

if TYPE_CHECKING:
    from collections.abc import Mapping

    from homeassistant.config_entries import ConfigEntry
    from homeassistant.core import HomeAssistant

from .api import AbstpApiClient
from .const import CONF_API_KEY, CONF_URL, DOMAIN, LOGGER, PLATFORMS
from .coordinator import AbstpDataUpdateCoordinator
from .lovelace import (
    async_register_resource,
    async_unregister_resource,
    compute_frontend_hash,
)
from .preferences import CardPreferenceStore, async_get_card_preference_store
from .services import async_setup_services, async_unload_services
from .tracker import SessionTracker, is_allowed_player
from .websocket import async_register_websocket_handlers

COVER_CACHE_CONTROL = "public, max-age=86400"
COVER_REQUEST_TIMEOUT = 10
FRONTEND_CACHE_CONTROL = "no-cache, max-age=0, must-revalidate"
STREAM_CONNECT_TIMEOUT = 10
STREAM_CACHE_CONTROL = "no-cache, no-store"
STREAM_ACCEPT_RANGES = "none"
SECURITY_HEADERS: dict[str, str] = {
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none';",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}
ALLOWED_CORS_ORIGINS: frozenset[str] = frozenset({"https://www.gstatic.com"})


def _resolve_cors_headers(request: web.Request, hass: HomeAssistant) -> dict[str, str]:
    """Determine CORS response headers based on an explicit allowed origin whitelist."""
    origin = request.headers.get("Origin")
    if not origin:
        return {}

    allowed = set(ALLOWED_CORS_ORIGINS)
    if hass.config.internal_url:
        allowed.add(hass.config.internal_url.rstrip("/"))
    if hass.config.external_url:
        allowed.add(hass.config.external_url.rstrip("/"))

    try:
        base_url = get_url(hass)
        allowed.add(base_url.rstrip("/"))
    except NoURLAvailableError:
        pass

    host = request.host
    if host:
        allowed.add(f"http://{host}")
        allowed.add(f"https://{host}")

    if origin in allowed:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "Range, Authorization, Content-Type",
            "Access-Control-Max-Age": "86400",
        }
    return {}


class AbstpStaticResource(web.StaticResource):
    """Require validation so rebuilt frontend assets are never served stale."""

    @override
    async def _handle(self, request: web.Request) -> web.StreamResponse:
        """Inject cache control headers preventing caching of frontend bundle."""
        response = await super()._handle(request)
        response.headers[CACHE_CONTROL] = FRONTEND_CACHE_CONTROL
        return response


class AbstpCoverView(HomeAssistantView):
    """Serve cover images with caching headers and local proxy forwarding."""

    url: str | None = "/api/abstp_controller/cover/{item_id}"
    name: str | None = "api:abstp_controller:cover"
    requires_auth: bool = False
    cors_allowed: bool = False

    async def get(self, request: web.Request, item_id: str) -> web.StreamResponse:
        """Stream the cover image from the backend proxy instance."""
        hass = cast("HomeAssistant", request.app["hass"])
        cors_headers = _resolve_cors_headers(request, hass)
        domain_data = cast("dict[str, object]", hass.data.get(DOMAIN, {}))
        client: AbstpApiClient | None = None
        for data in domain_data.values():
            if isinstance(data, dict) and "client" in data:
                client = cast("AbstpApiClient", data["client"])
                break

        if client is None:
            return web.Response(
                status=404, headers={**cors_headers, **SECURITY_HEADERS}
            )

        session = async_get_clientsession(hass)
        target_url = f"{client.base_url}/api/proxy/covers/{item_id}"
        timeout = ClientTimeout(total=COVER_REQUEST_TIMEOUT)

        try:
            async with session.get(target_url, timeout=timeout) as response:
                if response.status != 200:
                    return web.Response(
                        status=response.status,
                        headers={**cors_headers, **SECURITY_HEADERS},
                    )
                body = await response.read()
                content_type = response.headers.get("Content-Type", "image/jpeg")
                return web.Response(
                    body=body,
                    content_type=content_type,
                    headers={
                        "Cache-Control": COVER_CACHE_CONTROL,
                        **cors_headers,
                        **SECURITY_HEADERS,
                    },
                )
        except (ClientError, TimeoutError) as err:
            LOGGER.warning("Failed to proxy cover for %s: %s", item_id, err)
            return web.Response(
                status=404, headers={**cors_headers, **SECURITY_HEADERS}
            )


def _get_active_tracker(hass: HomeAssistant) -> SessionTracker | None:
    """Retrieve the active session tracker from the integration domain data."""
    domain_data = cast("dict[str, object]", hass.data.get(DOMAIN, {}))
    for data in domain_data.values():
        if isinstance(data, dict) and "tracker" in data:
            return cast("SessionTracker", data["tracker"])
    return None


class AbstpStreamView(HomeAssistantView):
    """Proxy real-time transcoded audio streams to clients and media players."""

    url: str | None = "/api/abstp_controller/stream/{session_id}.aac"
    name: str | None = "api:abstp_controller:stream"
    requires_auth: bool = False
    cors_allowed: bool = False

    async def head(self, request: web.Request, session_id: str) -> web.StreamResponse:
        """Handle stream probe requests from players."""
        hass = cast("HomeAssistant", request.app["hass"])
        cors_headers = _resolve_cors_headers(request, hass)
        tracker = _get_active_tracker(hass)
        if tracker is None or tracker.get_stream_url(session_id) is None:
            return web.Response(
                status=404, headers={**cors_headers, **SECURITY_HEADERS}
            )

        if tracker.is_backend_terminated(session_id):
            return web.Response(
                status=410, headers={**cors_headers, **SECURITY_HEADERS}
            )

        token = request.query.get("token")
        is_auth = request.get(
            "hass_authenticated"
        ) is True or tracker.validate_stream_token(session_id, token)
        if not is_auth:
            return web.Response(
                status=401, headers={**cors_headers, **SECURITY_HEADERS}
            )

        active_session = tracker.get_session_by_id(session_id)
        if active_session and not is_allowed_player(hass, active_session.entity_id):
            return web.Response(
                status=403, headers={**cors_headers, **SECURITY_HEADERS}
            )

        return web.Response(
            status=200,
            content_type="audio/aac",
            headers={
                "Cache-Control": STREAM_CACHE_CONTROL,
                "Accept-Ranges": STREAM_ACCEPT_RANGES,
                **cors_headers,
                **SECURITY_HEADERS,
            },
        )

    async def get(self, request: web.Request, session_id: str) -> web.StreamResponse:
        """Stream real-time audio transcoding output to client without buffering."""
        hass = cast("HomeAssistant", request.app["hass"])
        cors_headers = _resolve_cors_headers(request, hass)
        tracker = _get_active_tracker(hass)
        if tracker is None:
            return web.Response(
                status=404, headers={**cors_headers, **SECURITY_HEADERS}
            )

        if tracker.is_backend_terminated(session_id):
            return web.Response(
                status=410, headers={**cors_headers, **SECURITY_HEADERS}
            )

        backend_stream_url = tracker.get_stream_url(session_id)
        if backend_stream_url is None:
            return web.Response(
                status=404, headers={**cors_headers, **SECURITY_HEADERS}
            )

        token = request.query.get("token")
        is_auth = request.get(
            "hass_authenticated"
        ) is True or tracker.validate_stream_token(session_id, token)
        if not is_auth:
            return web.Response(
                status=401, headers={**cors_headers, **SECURITY_HEADERS}
            )

        active_session = tracker.get_session_by_id(session_id)
        if active_session and not is_allowed_player(hass, active_session.entity_id):
            return web.Response(
                status=403, headers={**cors_headers, **SECURITY_HEADERS}
            )

        LOGGER.debug(
            "HA stream proxy request: session=%s peer=%s forwarded_for=%s",
            session_id,
            request.remote,
            request.headers.get("X-Forwarded-For", ""),
        )
        session = async_get_clientsession(hass)
        timeout = ClientTimeout(
            total=None,
            connect=None,
            sock_read=None,
            sock_connect=STREAM_CONNECT_TIMEOUT,
        )
        response: web.StreamResponse | None = None

        try:
            async with session.get(
                backend_stream_url, timeout=timeout
            ) as upstream_resp:
                if upstream_resp.status != 200:
                    return web.Response(
                        status=upstream_resp.status,
                        headers={**cors_headers, **SECURITY_HEADERS},
                    )

                client_headers: dict[str, str] = {
                    "Cache-Control": upstream_resp.headers.get(
                        "Cache-Control", STREAM_CACHE_CONTROL
                    ),
                    "Accept-Ranges": upstream_resp.headers.get(
                        "Accept-Ranges", STREAM_ACCEPT_RANGES
                    ),
                    **cors_headers,
                    **SECURITY_HEADERS,
                }
                for header_name, header_val in upstream_resp.headers.items():
                    lower_name = header_name.lower()
                    if lower_name.startswith(("icy-", "x-audiocast-")):
                        if (
                            lower_name in ("icy-logo", "icy-url")
                            and "/api/proxy/covers/" in header_val
                        ):
                            item_id = header_val.split("/api/proxy/covers/")[-1].split(
                                "?"
                            )[0]
                            try:
                                base_url = get_url(hass)
                                client_headers[lower_name] = (
                                    f"{base_url}/api/abstp_controller/cover/{item_id}"
                                )
                            except NoURLAvailableError:
                                client_headers[lower_name] = (
                                    f"/api/abstp_controller/cover/{item_id}"
                                )
                        else:
                            client_headers[lower_name] = header_val
                    elif lower_name in (
                        "content-security-policy",
                        "x-content-type-options",
                        "x-frame-options",
                    ):
                        client_headers[header_name] = header_val

                content_type = upstream_resp.headers.get("Content-Type", "audio/aac")
                response = web.StreamResponse(status=200, headers=client_headers)
                response.content_type = content_type
                response.enable_chunked_encoding()
                _ = await response.prepare(request)

                async for chunk, _ in upstream_resp.content.iter_chunks():
                    if chunk:
                        await response.write(chunk)

                await response.write_eof()
                return response
        except (ClientError, ConnectionResetError, TimeoutError) as err:
            LOGGER.debug("Stream connection closed for %s: %s", session_id, err)
            if response is not None and response.prepared:
                return response
            return web.Response(
                status=502, headers={**cors_headers, **SECURITY_HEADERS}
            )
        except asyncio.CancelledError:
            LOGGER.debug("Stream playback cancelled for %s", session_id)
            raise
        finally:
            tracker.notify_stream_closed(session_id)


def register_static_path(hass: HomeAssistant) -> None:
    """Serve the frontend with revalidation while preserving static path safety."""
    domain_data = cast("dict[str, object]", hass.data.setdefault(DOMAIN, {}))
    if domain_data.get("static_path_registered"):
        return
    domain_data["static_path_registered"] = True

    resource = AbstpStaticResource(
        f"/{DOMAIN}",
        hass.config.path(f"custom_components/{DOMAIN}/www"),
    )
    hass.http.app.router.register_resource(resource)
    hass.http.app[KEY_ALLOW_CONFIGURED_CORS](resource)
    hass.http.register_view(AbstpCoverView)
    hass.http.register_view(AbstpStreamView)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Audiobookshelf Transcoder Proxy from a config entry."""
    register_static_path(hass)

    session = async_get_clientsession(hass)
    entry_data = cast("Mapping[str, object]", entry.data)
    url = str(entry_data[CONF_URL])
    api_key = str(entry_data[CONF_API_KEY])
    client = AbstpApiClient(
        session,
        base_url=url,
        api_key=api_key,
    )

    coordinator = AbstpDataUpdateCoordinator(hass, client)
    await coordinator.async_config_entry_first_refresh()

    tracker = SessionTracker(hass, client)

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {
        "client": client,
        "coordinator": coordinator,
        "tracker": tracker,
    }

    await async_setup_services(hass)
    async_register_websocket_handlers(hass)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    www_dir = hass.config.path(f"custom_components/{DOMAIN}/www")
    content_hash = await hass.async_add_executor_job(compute_frontend_hash, www_dir)
    _ = hass.async_create_task(async_register_resource(hass, content_hash))

    LOGGER.info("Audiobookshelf Transcoder Proxy initialized successfully")
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the integration when options change."""
    _ = await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        domain_data = cast(
            "dict[str, object]",
            hass.data.get(DOMAIN, {}),
        )
        data = domain_data.pop(entry.entry_id, None)
        if isinstance(data, dict) and "tracker" in data:
            tracker = cast("SessionTracker", data["tracker"])
            await tracker.async_stop_all()

        if not any(isinstance(v, dict) and "client" in v for v in domain_data.values()):
            await async_unload_services(hass)

    return unload_ok


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Handle removal of an entry and delete integration-owned preferences."""
    await async_unregister_resource(hass)
    remaining_entries = [
        config_entry
        for config_entry in hass.config_entries.async_entries(DOMAIN)
        if config_entry.entry_id != entry.entry_id
    ]
    if remaining_entries:
        return

    preference_store = async_get_card_preference_store(hass)
    await preference_store.async_remove()
    domain_data = cast("dict[str, object]", hass.data.get(DOMAIN, {}))
    stored_store = domain_data.get("card_preference_store")
    if isinstance(stored_store, CardPreferenceStore):
        _ = domain_data.pop("card_preference_store", None)
