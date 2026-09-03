"""Config Flow for Audiobookshelf Transcoder Proxy integration."""

from typing import TYPE_CHECKING, cast, override

import voluptuous as vol
from aiohttp import ClientError
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

from .api import (
    AbstpApiClient,
    AbstpApiError,
    AbstpAuthError,
    AbstpConnectionError,
)
from .const import (
    CONF_API_KEY,
    CONF_DEFAULT_SPEED,
    CONF_URL,
    DEFAULT_SPEED,
    DOMAIN,
    MAX_SPEED,
    MIN_SPEED,
    SPEED_STEP,
)


class AbstpConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Audiobookshelf Transcoder Proxy."""

    VERSION: int = 1

    @override
    async def async_step_user(
        self, user_input: dict[str, object] | None = None
    ) -> ConfigFlowResult:
        """Handle the initial setup step initiated by the user."""
        errors: dict[str, str] = {}

        if user_input is not None:
            url = str(user_input[CONF_URL]).strip().rstrip("/")
            api_key = str(user_input[CONF_API_KEY])
            speed_val: object = user_input.get(CONF_DEFAULT_SPEED, DEFAULT_SPEED)
            speed = float(str(speed_val))

            session = async_get_clientsession(self.hass)
            client = AbstpApiClient(session, url, api_key)

            try:
                healthy = await client.async_get_health()
                if not healthy:
                    errors["base"] = "cannot_connect"
                else:
                    _ = await client.async_get_books()
            except AbstpAuthError:
                errors["base"] = "invalid_auth"
            except AbstpConnectionError:
                errors["base"] = "cannot_connect"
            except AbstpApiError, TimeoutError, ClientError:
                errors["base"] = "unknown"

            if not errors:
                _ = await self.async_set_unique_id(url)
                self._abort_if_unique_id_configured()

                return self.async_create_entry(
                    title="Audiobookshelf Transcoder Proxy",
                    data={
                        CONF_URL: url,
                        CONF_API_KEY: api_key,
                        CONF_DEFAULT_SPEED: speed,
                    },
                )

        number_selector = cast(
            "Callable[[selector.NumberSelectorConfig], object]",
            selector.NumberSelector,
        )
        speed_selector = number_selector(
            selector.NumberSelectorConfig(
                min=MIN_SPEED,
                max=MAX_SPEED,
                step=SPEED_STEP,
                mode=selector.NumberSelectorMode.BOX,
            )
        )

        schema = vol.Schema(
            {
                vol.Required(CONF_URL, default="http://127.0.0.1:8099"): str,
                vol.Required(CONF_API_KEY): str,
                vol.Optional(
                    CONF_DEFAULT_SPEED,
                    default=DEFAULT_SPEED,
                ): speed_selector,
            }
        )

        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(schema, user_input),
            errors=errors,
        )

    @override
    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: ConfigEntry,
    ) -> OptionsFlow:
        """Return the options flow handler for tuning integration parameters."""
        _ = config_entry
        return AbstpOptionsFlowHandler()


class AbstpOptionsFlowHandler(OptionsFlow):
    """Handle options updates for an existing abstp config entry."""

    async def async_step_init(
        self, user_input: dict[str, object] | None = None
    ) -> ConfigFlowResult:
        """Manage integration options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        options_dict = cast("Mapping[str, object]", self.config_entry.options)
        data_dict = cast("Mapping[str, object]", self.config_entry.data)
        raw_speed = options_dict.get(
            CONF_DEFAULT_SPEED,
            data_dict.get(CONF_DEFAULT_SPEED, DEFAULT_SPEED),
        )
        current_speed = float(str(raw_speed))

        number_selector = cast(
            "Callable[[selector.NumberSelectorConfig], object]",
            selector.NumberSelector,
        )
        speed_selector = number_selector(
            selector.NumberSelectorConfig(
                min=MIN_SPEED,
                max=MAX_SPEED,
                step=SPEED_STEP,
                mode=selector.NumberSelectorMode.BOX,
            )
        )

        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_DEFAULT_SPEED,
                    default=current_speed,
                ): speed_selector,
            }
        )

        return self.async_show_form(step_id="init", data_schema=schema)
