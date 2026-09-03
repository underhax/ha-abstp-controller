"""Unit tests for the config flow."""

from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

import pytest
from homeassistant import config_entries
from homeassistant.config_entries import ConfigEntry
from homeassistant.data_entry_flow import FlowResultType

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from homeassistant.core import HomeAssistant

from custom_components.abstp_controller.api import (
    AbstpApiError,
    AbstpAuthError,
    AbstpConnectionError,
)
from custom_components.abstp_controller.config_flow import (
    AbstpOptionsFlowHandler,
)
from custom_components.abstp_controller.const import (
    CONF_API_KEY,
    CONF_DEFAULT_SPEED,
    CONF_URL,
    DOMAIN,
)


async def test_config_flow_user_step_success(hass: HomeAssistant) -> None:
    """Test standard successful config flow."""
    with (
        patch(
            "custom_components.abstp_controller.config_flow.AbstpApiClient.async_get_health",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "custom_components.abstp_controller.config_flow.AbstpApiClient.async_get_books",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch(
            "custom_components.abstp_controller.async_setup_entry",
            return_value=True,
        ),
    ):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": config_entries.SOURCE_USER}
        )
        assert result.get("type") == FlowResultType.FORM
        assert result.get("step_id") == "user"

        flow_id = str(result.get("flow_id", ""))
        async_configure = cast(
            "Callable[[str, dict[str, object]], Awaitable[dict[str, object]]]",
            hass.config_entries.flow.async_configure,
        )
        result2 = await async_configure(
            flow_id,
            {
                CONF_URL: "http://abstp.example.com:8099",
                CONF_API_KEY: "test_secret_key_12345",
                CONF_DEFAULT_SPEED: 1.25,
            },
        )
        assert result2.get("type") == FlowResultType.CREATE_ENTRY
        assert result2.get("title") == "Audiobookshelf Transcoder Proxy"
        data = cast("dict[str, object]", result2.get("data", {}))
        assert data.get(CONF_URL) == "http://abstp.example.com:8099"
        assert data.get(CONF_API_KEY) == "test_secret_key_12345"


@pytest.mark.parametrize(
    ("side_effect", "expected_error"),
    [
        (AbstpAuthError("invalid key"), "invalid_auth"),
        (AbstpConnectionError("cannot connect"), "cannot_connect"),
        (AbstpApiError("unknown error"), "unknown"),
    ],
)
async def test_config_flow_errors(
    hass: HomeAssistant, side_effect: Exception, expected_error: str
) -> None:
    """Test error handling in config flow."""
    with patch(
        "custom_components.abstp_controller.config_flow.AbstpApiClient.async_get_health",
        side_effect=side_effect,
    ):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": config_entries.SOURCE_USER}
        )
        flow_id = str(result.get("flow_id", ""))
        async_configure = cast(
            "Callable[[str, dict[str, object]], Awaitable[dict[str, object]]]",
            hass.config_entries.flow.async_configure,
        )
        result2 = await async_configure(
            flow_id,
            {
                CONF_URL: "http://abstp.example.com:8099",
                CONF_API_KEY: "test_secret_key_12345",
            },
        )
        assert result2.get("type") == FlowResultType.FORM
        errors = cast("dict[str, str]", result2.get("errors", {}))
        assert errors.get("base") == expected_error


async def test_config_flow_options(hass: HomeAssistant) -> None:
    """Test options flow configuration."""
    entry = MagicMock(spec=ConfigEntry)
    entry.options = {CONF_DEFAULT_SPEED: 1.25}
    entry.data = {
        CONF_URL: "http://abstp.example.com:8099",
        CONF_API_KEY: "test_secret_key_12345",
        CONF_DEFAULT_SPEED: 1.25,
    }

    handler = AbstpOptionsFlowHandler()
    handler.hass = hass

    with patch(
        "custom_components.abstp_controller.config_flow.AbstpOptionsFlowHandler.config_entry",
        new_callable=PropertyMock,
        return_value=entry,
    ):
        result = await handler.async_step_init()
        assert result.get("type") == FlowResultType.FORM
        assert result.get("step_id") == "init"

        result2 = await handler.async_step_init(user_input={CONF_DEFAULT_SPEED: 1.75})
        assert result2.get("type") == FlowResultType.CREATE_ENTRY
        data = cast("dict[str, object]", result2.get("data", {}))
        assert data.get(CONF_DEFAULT_SPEED) == 1.75
