"""Unit tests for base entity class."""

from typing import TYPE_CHECKING, cast
from unittest.mock import MagicMock

from homeassistant.config_entries import ConfigEntry

if TYPE_CHECKING:
    from homeassistant.helpers.device_registry import DeviceInfo

from custom_components.abstp_controller.const import DEFAULT_NAME, DOMAIN
from custom_components.abstp_controller.coordinator import (
    AbstpData,
    AbstpDataUpdateCoordinator,
)
from custom_components.abstp_controller.entity import AbstpEntity


def _build_entity(
    last_update_success: bool,
    healthy: bool,
) -> AbstpEntity:
    client = MagicMock()
    client.base_url = "http://abstp.example.com:8099"
    coordinator = MagicMock(spec=AbstpDataUpdateCoordinator)
    coordinator.client = client
    coordinator.last_update_success = last_update_success
    coordinator.data = AbstpData(
        healthy=healthy,
        books=[],
        podcasts=[],
    )
    entry = MagicMock(spec=ConfigEntry)
    entry.entry_id = "test_entry_id"

    return AbstpEntity(coordinator=coordinator, entry=entry)


def test_entity_device_info() -> None:
    """Populate device registry binding from entry and coordinator."""
    entity = _build_entity(last_update_success=True, healthy=True)

    device_info = cast("DeviceInfo", entity.device_info)
    assert device_info.get("identifiers") == {(DOMAIN, "test_entry_id")}
    assert device_info.get("name") == DEFAULT_NAME
    assert device_info.get("manufacturer") == "underhax"
    assert device_info.get("model") == "abstp"
    assert device_info.get("configuration_url") == "http://abstp.example.com:8099"


def test_entity_has_entity_name_flag() -> None:
    """Expose entity name flag matching Home Assistant expectations."""
    entity = _build_entity(last_update_success=True, healthy=True)

    assert entity.has_entity_name is True


def test_entity_available_true() -> None:
    """Expose availability when both proxy health and update are successful."""
    entity = _build_entity(last_update_success=True, healthy=True)

    assert entity.available is True


def test_entity_available_false_update_failed() -> None:
    """Hide entity when the last coordinator update failed."""
    entity = _build_entity(last_update_success=False, healthy=True)

    assert entity.available is False


def test_entity_available_false_proxy_unhealthy() -> None:
    """Hide entity when the proxy instance reports unhealthy status."""
    entity = _build_entity(last_update_success=True, healthy=False)

    assert entity.available is False
