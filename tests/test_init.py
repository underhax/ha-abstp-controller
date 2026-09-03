"""Unit tests for integration lifecycle setup and unloading."""

from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock, patch

from aiohttp import web
from homeassistant.config_entries import ConfigEntry

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

from custom_components.abstp_controller import (
    async_remove_entry,
    async_setup_entry,
    async_unload_entry,
)
from custom_components.abstp_controller.const import (
    CONF_API_KEY,
    CONF_DEFAULT_SPEED,
    CONF_URL,
    DOMAIN,
)


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
    entry.add_update_listener = MagicMock()
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
            "custom_components.abstp_controller._register_static_path",
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

        unload_result = await async_unload_entry(hass, entry)
        assert unload_result is True
        assert entry_id not in hass.data[DOMAIN]


async def test_async_remove_entry(hass: HomeAssistant) -> None:
    """Test integration removal unregisters Lovelace resource."""
    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_id"

    with patch(
        "custom_components.abstp_controller.async_unregister_resource",
        new_callable=AsyncMock,
    ) as mock_unregister:
        await async_remove_entry(hass, entry)
        mock_unregister.assert_called_once_with(hass)


async def test_abstp_cover_view(hass: HomeAssistant) -> None:
    """Test AbstpCoverView proxies cover artwork."""
    from custom_components.abstp_controller import AbstpCoverView

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
