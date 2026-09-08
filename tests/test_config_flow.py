"""Unit tests for the config flow."""

from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

import pytest
from homeassistant import config_entries
from homeassistant.components.media_player.const import MediaPlayerEntityFeature
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import State
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
    async_collect_friendly_names,
    filter_target_player_ids,
    get_supported_target_player_ids,
    is_supported_target_player,
)
from custom_components.abstp_controller.const import (
    CONF_API_KEY,
    CONF_DEFAULT_SPEED,
    CONF_PLAYER_FRIENDLY_NAMES,
    CONF_TARGET_PLAYERS,
    CONF_URL,
    DEFAULT_NAME,
    DOMAIN,
    SOURCE_BROWSER_ID,
)


async def test_config_flow_user_step_success(hass: HomeAssistant) -> None:
    """Test standard successful config flow with player selection and friendly names."""
    hass.states.async_set(
        "media_player.living_room",
        "idle",
        {
            "friendly_name": "Living Room Speaker",
            "supported_features": int(MediaPlayerEntityFeature.PLAY_MEDIA),
        },
    )
    hass.states.async_set(
        "media_player.bedroom",
        "idle",
        {
            "friendly_name": "Bedroom Speaker",
            "supported_features": int(MediaPlayerEntityFeature.PLAY_MEDIA),
        },
    )
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
            DOMAIN,
            context={"source": "user"},
        )
        assert result.get("type") == FlowResultType.FORM
        assert result.get("step_id") == "user"

        flow_id = result["flow_id"]
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
        assert result2.get("type") == FlowResultType.FORM
        assert result2.get("step_id") == "players"

        result3 = await async_configure(
            flow_id,
            {
                CONF_TARGET_PLAYERS: [
                    "media_player.bedroom",
                    "media_player.living_room",
                ],
            },
        )
        assert result3.get("type") == FlowResultType.FORM
        assert result3.get("step_id") == "friendly_names"

        result4 = await async_configure(
            flow_id,
            {
                "media_player.bedroom": "Custom Bedroom Speaker",
                "media_player.living_room": "Living Room Speaker",
            },
        )
        assert result4.get("type") == FlowResultType.CREATE_ENTRY
        assert result4.get("title") == DEFAULT_NAME
        data = cast("dict[str, object]", result4.get("data", {}))
        assert data.get(CONF_URL) == "http://abstp.example.com:8099"
        assert data.get(CONF_API_KEY) == "test_secret_key_12345"
        options = cast("dict[str, object]", result4.get("options", {}))
        assert options.get(CONF_DEFAULT_SPEED) == 1.25
        assert options.get(CONF_TARGET_PLAYERS) == [
            "media_player.bedroom",
            "media_player.living_room",
        ]
        assert options.get(CONF_PLAYER_FRIENDLY_NAMES) == {
            "media_player.bedroom": "Custom Bedroom Speaker",
            "media_player.living_room": "Living Room Speaker",
        }


async def test_async_collect_friendly_names(hass: HomeAssistant) -> None:
    """Test collecting friendly names from user input."""
    names = await async_collect_friendly_names(
        hass,
        ["media_player.living_room"],
        {"media_player.living_room": "Living Room Speaker"},
    )
    assert names == {"media_player.living_room": "Living Room Speaker"}


async def test_config_flow_no_target_players(hass: HomeAssistant) -> None:
    """Test config flow when user selects no target players."""
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
        flow_id = str(result.get("flow_id", ""))
        async_configure = cast(
            "Callable[[str, dict[str, object]], Awaitable[dict[str, object]]]",
            hass.config_entries.flow.async_configure,
        )
        _ = await async_configure(
            flow_id,
            {
                CONF_URL: "http://abstp.example.com:8099",
                CONF_API_KEY: "test_secret_key_12345",
                CONF_DEFAULT_SPEED: 1.0,
            },
        )
        result2 = await async_configure(flow_id, {CONF_TARGET_PLAYERS: []})
        assert result2.get("type") == FlowResultType.CREATE_ENTRY
        assert result2.get("title") == DEFAULT_NAME
        options = cast("dict[str, object]", result2.get("options", {}))
        assert options.get(CONF_TARGET_PLAYERS) == []
        assert options.get(CONF_PLAYER_FRIENDLY_NAMES) == {}


async def test_config_flow_browser_only(hass: HomeAssistant) -> None:
    """Test config flow when user selects only browser."""
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
        flow_id = str(result.get("flow_id", ""))
        async_configure = cast(
            "Callable[[str, dict[str, object]], Awaitable[dict[str, object]]]",
            hass.config_entries.flow.async_configure,
        )
        _ = await async_configure(
            flow_id,
            {
                CONF_URL: "http://abstp.example.com:8099",
                CONF_API_KEY: "test_secret_key_12345",
                CONF_DEFAULT_SPEED: 1.0,
            },
        )
        result2 = await async_configure(
            flow_id, {CONF_TARGET_PLAYERS: [SOURCE_BROWSER_ID]}
        )
        assert result2.get("type") == FlowResultType.CREATE_ENTRY
        assert result2.get("title") == DEFAULT_NAME
        options = cast("dict[str, object]", result2.get("options", {}))
        assert options.get(CONF_TARGET_PLAYERS) == [SOURCE_BROWSER_ID]
        assert options.get(CONF_PLAYER_FRIENDLY_NAMES) == {}


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
    """Test options flow configuration with friendly names step."""
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

        result2 = await handler.async_step_init(
            user_input={
                CONF_DEFAULT_SPEED: 1.75,
                CONF_TARGET_PLAYERS: [
                    "media_player.bedroom",
                    "media_player.living_room",
                ],
            }
        )
        assert result2.get("type") == FlowResultType.FORM
        assert result2.get("step_id") == "friendly_names"

        result3 = await handler.async_step_friendly_names(
            user_input={
                "media_player.bedroom": "Custom Bedroom Speaker",
                "media_player.living_room": "Living Room Speaker",
            }
        )
        assert result3.get("type") == FlowResultType.CREATE_ENTRY
        data = cast("dict[str, object]", result3.get("data", {}))
        assert data.get(CONF_DEFAULT_SPEED) == 1.75
        assert data.get(CONF_TARGET_PLAYERS) == [
            "media_player.bedroom",
            "media_player.living_room",
        ]
        assert data.get(CONF_PLAYER_FRIENDLY_NAMES) == {
            "media_player.bedroom": "Custom Bedroom Speaker",
            "media_player.living_room": "Living Room Speaker",
        }


async def test_config_flow_options_empty_targets(hass: HomeAssistant) -> None:
    """Test options flow when no target players are chosen."""
    entry = MagicMock(spec=ConfigEntry)
    entry.options = {}
    entry.data = {CONF_URL: "http://abstp.example.com:8099", CONF_API_KEY: "k"}

    handler = AbstpOptionsFlowHandler()
    handler.hass = hass

    with patch(
        "custom_components.abstp_controller.config_flow.AbstpOptionsFlowHandler.config_entry",
        new_callable=PropertyMock,
        return_value=entry,
    ):
        result = await handler.async_step_init(
            user_input={
                CONF_DEFAULT_SPEED: 1.5,
                CONF_TARGET_PLAYERS: [],
            }
        )
        assert result.get("type") == FlowResultType.CREATE_ENTRY
        data = cast("dict[str, object]", result.get("data", {}))
        assert data.get(CONF_DEFAULT_SPEED) == 1.5
        assert data.get(CONF_TARGET_PLAYERS) == []
        assert data.get(CONF_PLAYER_FRIENDLY_NAMES) == {}


async def test_config_flow_options_browser_only(hass: HomeAssistant) -> None:
    """Test options flow when only browser is chosen."""
    entry = MagicMock(spec=ConfigEntry)
    entry.options = {}
    entry.data = {CONF_URL: "http://abstp.example.com:8099", CONF_API_KEY: "k"}

    handler = AbstpOptionsFlowHandler()
    handler.hass = hass

    with patch(
        "custom_components.abstp_controller.config_flow.AbstpOptionsFlowHandler.config_entry",
        new_callable=PropertyMock,
        return_value=entry,
    ):
        result = await handler.async_step_init(
            user_input={
                CONF_DEFAULT_SPEED: 1.5,
                CONF_TARGET_PLAYERS: [SOURCE_BROWSER_ID],
            }
        )
        assert result.get("type") == FlowResultType.CREATE_ENTRY
        data = cast("dict[str, object]", result.get("data", {}))
        assert data.get(CONF_DEFAULT_SPEED) == 1.5
        assert data.get(CONF_TARGET_PLAYERS) == [SOURCE_BROWSER_ID]
        assert data.get(CONF_PLAYER_FRIENDLY_NAMES) == {}


async def test_config_flow_options_with_browser_and_speaker(
    hass: HomeAssistant,
) -> None:
    """Test options flow with both browser and physical speaker."""
    hass.states.async_set(
        "media_player.bedroom",
        "idle",
        {
            "friendly_name": "Bedroom Speaker",
            "supported_features": int(MediaPlayerEntityFeature.PLAY_MEDIA),
        },
    )
    entry = MagicMock(spec=ConfigEntry)
    entry.options = {}
    entry.data = {CONF_URL: "http://abstp.example.com:8099", CONF_API_KEY: "k"}

    handler = AbstpOptionsFlowHandler()
    handler.hass = hass

    with patch(
        "custom_components.abstp_controller.config_flow.AbstpOptionsFlowHandler.config_entry",
        new_callable=PropertyMock,
        return_value=entry,
    ):
        result = await handler.async_step_init(
            user_input={
                CONF_DEFAULT_SPEED: 1.5,
                CONF_TARGET_PLAYERS: [SOURCE_BROWSER_ID, "media_player.bedroom"],
            }
        )
        assert result.get("type") == FlowResultType.FORM
        assert result.get("step_id") == "friendly_names"

        result2 = await handler.async_step_friendly_names(
            user_input={"media_player.bedroom": "Custom Bedroom"}
        )
        assert result2.get("type") == FlowResultType.CREATE_ENTRY
        data = cast("dict[str, object]", result2.get("data", {}))
        assert data.get(CONF_DEFAULT_SPEED) == 1.5
        assert data.get(CONF_TARGET_PLAYERS) == [
            SOURCE_BROWSER_ID,
            "media_player.bedroom",
        ]
        assert data.get(CONF_PLAYER_FRIENDLY_NAMES) == {
            "media_player.bedroom": "Custom Bedroom"
        }


@pytest.mark.parametrize(
    ("entity_id", "attributes", "expected"),
    [
        (
            "media_player.kitchen_speaker",
            {"supported_features": MediaPlayerEntityFeature.PLAY_MEDIA},
            True,
        ),
        (
            "media_player.abstp_kitchen",
            {"supported_features": MediaPlayerEntityFeature.PLAY_MEDIA},
            False,
        ),
        (
            "media_player.yandex_station_intents_123",
            {"supported_features": MediaPlayerEntityFeature.PLAY_MEDIA},
            False,
        ),
        (
            "media_player.bedroom_tv",
            {
                "supported_features": MediaPlayerEntityFeature.PLAY_MEDIA,
                "friendly_name": "sb TV",
            },
            True,
        ),
        (
            "media_player.silent_speaker",
            {"supported_features": 0},
            False,
        ),
        (
            "light.kitchen_lamp",
            {"supported_features": MediaPlayerEntityFeature.PLAY_MEDIA},
            False,
        ),
    ],
)
def test_is_supported_target_player(
    entity_id: str, attributes: dict[str, object], expected: bool
) -> None:
    """Test candidate player filtering against entity IDs and playback features."""
    state = State(entity_id, "idle", attributes)
    assert is_supported_target_player(state) is expected


def test_get_supported_target_player_ids(hass: HomeAssistant) -> None:
    """Test retrieval and filtering of candidate target players from hass states."""
    hass.states.async_set(
        "media_player.kitchen_speaker",
        "idle",
        {"supported_features": MediaPlayerEntityFeature.PLAY_MEDIA},
    )
    hass.states.async_set(
        "media_player.silent_speaker",
        "idle",
        {"supported_features": 0},
    )
    hass.states.async_set(
        "media_player.yandex_station_intents_123",
        "idle",
        {"supported_features": MediaPlayerEntityFeature.PLAY_MEDIA},
    )
    hass.states.async_set(
        "media_player.abstp_virtual",
        "idle",
        {"supported_features": MediaPlayerEntityFeature.PLAY_MEDIA},
    )
    hass.states.async_set(
        "media_player.living_room_speaker",
        "idle",
        {"supported_features": MediaPlayerEntityFeature.PLAY_MEDIA},
    )

    candidates = get_supported_target_player_ids(hass)
    assert candidates == [
        "media_player.kitchen_speaker",
        "media_player.living_room_speaker",
    ]


@pytest.mark.parametrize(
    ("raw_input", "expected"),
    [
        (
            [
                "browser",
                "media_player.speaker_1",
                "media_player.bedroom_tv",
                "media_player.abstp_speaker",
                "media_player.yandex_station_intents_123",
            ],
            [
                "browser",
                "media_player.speaker_1",
                "media_player.bedroom_tv",
            ],
        ),
        ("media_player.speaker_single", ["media_player.speaker_single"]),
        ("browser", ["browser"]),
        (None, []),
        (12345, []),
    ],
)
def test_filter_target_player_ids(raw_input: object, expected: list[str]) -> None:
    """Test target player sanitization and invalid item discarding."""
    assert filter_target_player_ids(raw_input) == expected
