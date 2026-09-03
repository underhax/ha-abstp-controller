"""The Audiobookshelf Transcoder Proxy Controller integration."""

from typing import TYPE_CHECKING, cast, override

from aiohttp import ClientError, ClientTimeout, web
from aiohttp.hdrs import CACHE_CONTROL
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.http import (
    KEY_ALLOW_CONFIGURED_CORS,
    HomeAssistantView,
)

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
from .services import async_setup_services, async_unload_services
from .tracker import SessionTracker
from .websocket import async_register_websocket_handlers

COVER_CACHE_CONTROL = "public, max-age=86400"
COVER_REQUEST_TIMEOUT = 10
FRONTEND_CACHE_CONTROL = "no-cache, max-age=0, must-revalidate"


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

    async def get(self, request: web.Request, item_id: str) -> web.StreamResponse:
        """Stream the cover image from the backend proxy instance."""
        hass = cast("HomeAssistant", request.app["hass"])
        domain_data = cast("dict[str, dict[str, object]]", hass.data.get(DOMAIN, {}))
        client: AbstpApiClient | None = None
        for data in domain_data.values():
            if "client" in data:
                client = cast("AbstpApiClient", data["client"])
                break

        if client is None:
            return web.Response(status=404)

        session = async_get_clientsession(hass)
        target_url = f"{client.base_url}/api/proxy/covers/{item_id}"
        timeout = ClientTimeout(total=COVER_REQUEST_TIMEOUT)

        try:
            async with session.get(target_url, timeout=timeout) as response:
                if response.status != 200:
                    return web.Response(status=response.status)
                body = await response.read()
                content_type = response.headers.get("Content-Type", "image/jpeg")
                return web.Response(
                    body=body,
                    content_type=content_type,
                    headers={"Cache-Control": COVER_CACHE_CONTROL},
                )
        except (ClientError, TimeoutError) as err:
            LOGGER.warning("Failed to proxy cover for %s: %s", item_id, err)
            return web.Response(status=404)


def _register_static_path(hass: HomeAssistant) -> None:
    """Serve the frontend with revalidation while preserving static path safety."""
    resource = AbstpStaticResource(
        f"/{DOMAIN}",
        hass.config.path(f"custom_components/{DOMAIN}/www"),
    )
    hass.http.app.router.register_resource(resource)
    hass.http.app[KEY_ALLOW_CONFIGURED_CORS](resource)
    hass.http.register_view(AbstpCoverView)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Audiobookshelf Transcoder Proxy from a config entry."""
    _register_static_path(hass)

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
            "dict[str, dict[str, object]]",
            hass.data.get(DOMAIN, {}),
        )
        data = domain_data.pop(entry.entry_id, None)
        if data and "tracker" in data:
            tracker = cast("SessionTracker", data["tracker"])
            await tracker.async_stop_all()

        if not domain_data:
            await async_unload_services(hass)

    return unload_ok


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Handle removal of an entry."""
    _ = entry
    await async_unregister_resource(hass)
