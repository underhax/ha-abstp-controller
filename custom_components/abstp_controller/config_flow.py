"""Config Flow for Audiobookshelf Transcoder Proxy integration."""

from collections.abc import Mapping
from typing import TYPE_CHECKING, cast, override

import voluptuous as vol
from aiohttp import ClientError
from homeassistant.components.media_player.const import MediaPlayerEntityFeature
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import State, callback
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.translation import async_get_translations

if TYPE_CHECKING:
    from collections.abc import Callable

    from homeassistant.core import HomeAssistant

from .api import (
    AbstpApiClient,
    AbstpApiError,
    AbstpAuthError,
    AbstpConnectionError,
)
from .const import (
    CONF_API_KEY,
    CONF_DEFAULT_SPEED,
    CONF_PLAYER_FRIENDLY_NAMES,
    CONF_TARGET_PLAYERS,
    CONF_URL,
    DEFAULT_NAME,
    DEFAULT_SPEED,
    DOMAIN,
    MAX_SPEED,
    MIN_SPEED,
    PREFIX_VIRTUAL_PLAYER,
    SOURCE_BROWSER_ID,
    SPEED_STEP,
)


def filter_target_player_ids(raw_players: object) -> list[str]:
    """Filter and sanitize target media player entity IDs."""
    player_items: list[object]
    if isinstance(raw_players, list):
        player_items = cast("list[object]", raw_players)
    elif isinstance(raw_players, str):
        player_items = [raw_players]
    else:
        return []

    result: list[str] = []
    prefix = f"media_player.{PREFIX_VIRTUAL_PLAYER}"
    for item in player_items:
        entity_id = str(item).strip()
        lower_id = entity_id.lower()
        if entity_id == SOURCE_BROWSER_ID:
            result.append(entity_id)
            continue
        if (
            entity_id.startswith("media_player.")
            and not entity_id.startswith(prefix)
            and "yandex_station_intents" not in lower_id
        ):
            result.append(entity_id)
    return result


def is_supported_target_player(state: State) -> bool:
    """Evaluate if a media player entity supports audio playback."""
    entity_id = state.entity_id
    if not entity_id.startswith("media_player."):
        return False

    prefix = f"media_player.{PREFIX_VIRTUAL_PLAYER}"
    if entity_id.startswith(prefix):
        return False

    lower_id = entity_id.lower()
    if "yandex_station_intents" in lower_id:
        return False

    features = state.attributes.get("supported_features")
    return isinstance(features, int) and bool(
        features & MediaPlayerEntityFeature.PLAY_MEDIA
    )


def get_supported_target_player_ids(hass: HomeAssistant) -> list[str]:
    """Return sorted list of supported candidate media player entity IDs."""
    candidates = [
        state.entity_id
        for state in hass.states.async_all("media_player")
        if is_supported_target_player(state)
    ]
    return sorted(candidates)


async def async_collect_friendly_names(
    hass: HomeAssistant,
    target_players: list[str],
    user_input: Mapping[str, object],
) -> dict[str, str]:
    """Collect configured names for target players."""
    _ = hass
    names: dict[str, str] = {}
    for entity_id in target_players:
        name = str(user_input.get(entity_id, "")).strip()
        if name:
            names[entity_id] = name
    return names


def get_entity_friendly_name(state: State | None) -> str:
    """Extract friendly name from entity state attributes safely."""
    if state is None:
        return ""
    attributes = cast("Mapping[str, object]", state.attributes)
    name = attributes.get("friendly_name")
    return str(name) if name is not None else ""


async def async_get_browser_default_name(hass: HomeAssistant) -> str:
    """Return localized default name for the browser/local device."""
    translations = await async_get_translations(
        hass,
        hass.config.language,
        "entity",
        {DOMAIN},
    )
    return translations.get(
        f"component.{DOMAIN}.entity.media_player.browser.name",
        translations.get(
            f"entity.{DOMAIN}.media_player.browser.name",
            "This device",
        ),
    )


class AbstpConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Audiobookshelf Transcoder Proxy Controller."""

    VERSION: int = 1

    def __init__(self) -> None:
        """Initialize the config flow with internal step buffers."""
        super().__init__()
        self._user_data: dict[str, object] = {}
        self._target_players: list[str] = []

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

                self._user_data = {
                    CONF_URL: url,
                    CONF_API_KEY: api_key,
                    CONF_DEFAULT_SPEED: speed,
                }
                return await self.async_step_players()

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

        text_selector = cast(
            "Callable[[selector.TextSelectorConfig], object]",
            selector.TextSelector,
        )
        api_key_selector = text_selector(
            selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
        )

        schema = vol.Schema(
            {
                vol.Required(CONF_URL, default="http://127.0.0.1:8099"): str,
                vol.Required(CONF_API_KEY): api_key_selector,
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

    async def async_step_players(
        self, user_input: dict[str, object] | None = None
    ) -> ConfigFlowResult:
        """Select target media player speakers during initial setup."""
        if user_input is not None:
            self._target_players = filter_target_player_ids(
                user_input.get(CONF_TARGET_PLAYERS, [])
            )
            if any(p != SOURCE_BROWSER_ID for p in self._target_players):
                return await self.async_step_friendly_names()

            speed = self._user_data.get(CONF_DEFAULT_SPEED, DEFAULT_SPEED)
            return self.async_create_entry(
                title=DEFAULT_NAME,
                data=self._user_data,
                options={
                    CONF_DEFAULT_SPEED: speed,
                    CONF_TARGET_PLAYERS: self._target_players,
                    CONF_PLAYER_FRIENDLY_NAMES: {},
                },
            )

        browser_name = await async_get_browser_default_name(self.hass)
        supported_players = get_supported_target_player_ids(self.hass)
        options: list[selector.SelectOptionDict] = [
            selector.SelectOptionDict(
                value=SOURCE_BROWSER_ID,
                label=f"{browser_name} ({SOURCE_BROWSER_ID})",
            ),
        ]
        for entity_id in supported_players:
            name = get_entity_friendly_name(self.hass.states.get(entity_id))
            short_id = entity_id.removeprefix("media_player.")
            label = f"{name} ({short_id})" if name != entity_id else entity_id
            options.append(selector.SelectOptionDict(value=entity_id, label=label))

        select_selector = cast(
            "Callable[[selector.SelectSelectorConfig], object]",
            selector.SelectSelector,
        )
        players_selector = select_selector(
            selector.SelectSelectorConfig(
                options=options,
                multiple=True,
                mode=selector.SelectSelectorMode.DROPDOWN,
            )
        )

        schema = vol.Schema(
            {
                vol.Optional(CONF_TARGET_PLAYERS, default=[]): players_selector,
            }
        )

        return self.async_show_form(
            step_id="players",
            data_schema=schema,
        )

    async def async_step_friendly_names(
        self, user_input: dict[str, object] | None = None
    ) -> ConfigFlowResult:
        """Collect friendly names for selected media player speakers."""
        physical_players = [p for p in self._target_players if p != SOURCE_BROWSER_ID]
        if not physical_players:
            speed = self._user_data.get(CONF_DEFAULT_SPEED, DEFAULT_SPEED)
            return self.async_create_entry(
                title=DEFAULT_NAME,
                data=self._user_data,
                options={
                    CONF_DEFAULT_SPEED: speed,
                    CONF_TARGET_PLAYERS: self._target_players,
                    CONF_PLAYER_FRIENDLY_NAMES: {},
                },
            )

        if user_input is not None:
            names = await async_collect_friendly_names(
                self.hass,
                physical_players,
                user_input,
            )
            speed = self._user_data.get(CONF_DEFAULT_SPEED, DEFAULT_SPEED)
            return self.async_create_entry(
                title=DEFAULT_NAME,
                data=self._user_data,
                options={
                    CONF_DEFAULT_SPEED: speed,
                    CONF_TARGET_PLAYERS: self._target_players,
                    CONF_PLAYER_FRIENDLY_NAMES: names,
                },
            )

        text_selector = cast(
            "Callable[[selector.TextSelectorConfig], object]", selector.TextSelector
        )
        name_selector = text_selector(selector.TextSelectorConfig())

        name_schema: dict[vol.Marker, object] = {}
        for entity_id in physical_players:
            default_name = get_entity_friendly_name(self.hass.states.get(entity_id))
            name_schema[vol.Optional(entity_id, default=default_name)] = name_selector

        return self.async_show_form(
            step_id="friendly_names",
            data_schema=vol.Schema(name_schema),
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

    def __init__(self) -> None:
        """Initialize the options flow with an empty pending options buffer."""
        super().__init__()
        self._pending_options: dict[str, object] = {}

    async def async_step_init(
        self, user_input: dict[str, object] | None = None
    ) -> ConfigFlowResult:
        """Manage integration options."""
        if user_input is not None:
            target_players = filter_target_player_ids(
                user_input.get(CONF_TARGET_PLAYERS, [])
            )
            self._pending_options = {
                **user_input,
                CONF_TARGET_PLAYERS: target_players,
            }
            if any(p != SOURCE_BROWSER_ID for p in target_players):
                return await self.async_step_friendly_names()

            return self.async_create_entry(
                title="",
                data={**self._pending_options, CONF_PLAYER_FRIENDLY_NAMES: {}},
            )

        options_dict = cast("Mapping[str, object]", self.config_entry.options)
        data_dict = cast("Mapping[str, object]", self.config_entry.data)
        raw_speed = options_dict.get(
            CONF_DEFAULT_SPEED,
            data_dict.get(CONF_DEFAULT_SPEED, DEFAULT_SPEED),
        )
        current_speed = float(str(raw_speed))
        current_players = options_dict.get(
            CONF_TARGET_PLAYERS,
            data_dict.get(CONF_TARGET_PLAYERS, []),
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
        browser_name = await async_get_browser_default_name(self.hass)
        supported_players = get_supported_target_player_ids(self.hass)
        raw_list: list[object] = (
            cast("list[object]", current_players)
            if isinstance(current_players, list)
            else []
        )
        current_list = [
            str(x)
            for x in raw_list
            if str(x) != f"media_player.{PREFIX_VIRTUAL_PLAYER}browser"
        ]
        include_list = sorted(
            {*supported_players, *[p for p in current_list if p != SOURCE_BROWSER_ID]}
        )

        options: list[selector.SelectOptionDict] = [
            selector.SelectOptionDict(
                value=SOURCE_BROWSER_ID,
                label=f"{browser_name} ({SOURCE_BROWSER_ID})",
            ),
        ]
        for entity_id in include_list:
            name = get_entity_friendly_name(self.hass.states.get(entity_id))
            short_id = entity_id.removeprefix("media_player.")
            label = f"{name} ({short_id})" if name != entity_id else entity_id
            options.append(selector.SelectOptionDict(value=entity_id, label=label))

        select_selector = cast(
            "Callable[[selector.SelectSelectorConfig], object]",
            selector.SelectSelector,
        )
        players_selector = select_selector(
            selector.SelectSelectorConfig(
                options=options,
                multiple=True,
                mode=selector.SelectSelectorMode.DROPDOWN,
            )
        )

        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_DEFAULT_SPEED,
                    default=current_speed,
                ): speed_selector,
                vol.Optional(
                    CONF_TARGET_PLAYERS,
                    default=current_list,
                ): players_selector,
            }
        )

        return self.async_show_form(step_id="init", data_schema=schema)

    async def async_step_friendly_names(
        self, user_input: dict[str, object] | None = None
    ) -> ConfigFlowResult:
        """Collect friendly names for chosen target players."""
        raw_players = self._pending_options.get(CONF_TARGET_PLAYERS, [])
        target_players = filter_target_player_ids(raw_players)
        physical_players = [p for p in target_players if p != SOURCE_BROWSER_ID]
        if not physical_players:
            return self.async_create_entry(
                title="",
                data={**self._pending_options, CONF_PLAYER_FRIENDLY_NAMES: {}},
            )

        if user_input is not None:
            names = await async_collect_friendly_names(
                self.hass,
                physical_players,
                user_input,
            )
            self._pending_options[CONF_PLAYER_FRIENDLY_NAMES] = names
            return self.async_create_entry(title="", data=self._pending_options)

        options_dict = cast("Mapping[str, object]", self.config_entry.options)
        current_names_obj = options_dict.get(CONF_PLAYER_FRIENDLY_NAMES, {})
        current_names: Mapping[str, object] = (
            cast("Mapping[str, object]", current_names_obj)
            if isinstance(current_names_obj, Mapping)
            else {}
        )

        text_selector = cast(
            "Callable[[selector.TextSelectorConfig], object]", selector.TextSelector
        )
        name_selector = text_selector(selector.TextSelectorConfig())

        name_schema: dict[vol.Marker, object] = {}
        for entity_id in physical_players:
            raw_name = current_names.get(entity_id)
            default_name = (
                str(raw_name)
                if raw_name is not None
                else get_entity_friendly_name(self.hass.states.get(entity_id))
            )
            name_schema[vol.Optional(entity_id, default=default_name)] = name_selector

        return self.async_show_form(
            step_id="friendly_names",
            data_schema=vol.Schema(name_schema),
        )
