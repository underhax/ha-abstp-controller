"""Unit tests for Lovelace resource registration."""

import tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

from custom_components.abstp_controller.lovelace import (
    RESOURCE_BASE_URL,
    async_register_resource,
    async_unregister_resource,
    build_resource_url,
    compute_frontend_hash,
)


def test_compute_frontend_hash() -> None:
    """Test frontend SHA-256 hash computation."""
    with tempfile.TemporaryDirectory() as tmpdir:
        card_file = Path(tmpdir) / "abstp-player-card.js"
        _ = card_file.write_text("console.log('test');", encoding="utf-8")

        hash_val = compute_frontend_hash(Path(tmpdir))
        assert hash_val is not None
        assert len(hash_val) == 12
        assert compute_frontend_hash(Path(tmpdir)) == hash_val


def test_compute_frontend_hash_missing_bundle() -> None:
    """Return None and log a warning when the frontend bundle is absent."""
    with tempfile.TemporaryDirectory() as tmpdir:
        assert compute_frontend_hash(Path(tmpdir)) is None


def test_build_resource_url_without_hash() -> None:
    """Return the base URL when no content hash is supplied."""
    assert build_resource_url(None) == RESOURCE_BASE_URL


async def test_lovelace_register_and_unregister(hass: HomeAssistant) -> None:
    """Test registering and unregistering Lovelace resources."""
    mock_resources = MagicMock()
    mock_resources.loaded = True
    mock_resources.async_items = MagicMock(return_value=[])
    mock_resources.async_create_item = AsyncMock()
    mock_resources.async_delete_item = AsyncMock()

    mock_lovelace = MagicMock()
    mock_lovelace.resources = mock_resources

    hass.data["lovelace"] = mock_lovelace

    await async_register_resource(hass, "test_version_hash_123")
    create_mock = cast("AsyncMock", mock_resources.async_create_item)
    create_mock.assert_awaited_once()

    items_mock = cast("MagicMock", mock_resources.async_items)
    items_mock.return_value = [
        {
            "id": "res_123",
            "url": "/abstp_controller/abstp-player-card.js?v=test_version_hash_123",
            "res_type": "module",
        }
    ]
    await async_unregister_resource(hass)
    delete_mock = cast("AsyncMock", mock_resources.async_delete_item)
    delete_mock.assert_awaited_once_with("res_123")


async def test_register_resource_without_lovelace(hass: HomeAssistant) -> None:
    """Return early when Lovelace data is not present in Home Assistant."""
    await async_register_resource(hass, "test_version_hash_123")


async def test_register_resource_without_resources_collection(
    hass: HomeAssistant,
) -> None:
    """Return early when Lovelace exposes no resources collection."""
    mock_lovelace = MagicMock()
    mock_lovelace.resources = None

    hass.data["lovelace"] = mock_lovelace

    await async_register_resource(hass, "test_version_hash_123")


async def test_register_resource_not_in_storage_mode(hass: HomeAssistant) -> None:
    """Return early when resources are not backed by Lovelace storage mode."""
    mock_resources = SimpleNamespace(loaded=True)
    mock_lovelace = MagicMock()
    mock_lovelace.resources = mock_resources

    hass.data["lovelace"] = mock_lovelace

    await async_register_resource(hass, "test_version_hash_123")


async def test_register_resource_already_up_to_date(hass: HomeAssistant) -> None:
    """Leave matching resource untouched when the URL is already current."""
    mock_resources = MagicMock()
    mock_resources.loaded = True
    mock_resources.async_items = MagicMock(
        return_value=[
            {
                "id": "res_123",
                "url": f"{RESOURCE_BASE_URL}?v=test_version_hash_123",
            }
        ]
    )
    mock_resources.async_create_item = AsyncMock()
    mock_resources.async_delete_item = AsyncMock()

    mock_lovelace = MagicMock()
    mock_lovelace.resources = mock_resources

    hass.data["lovelace"] = mock_lovelace

    await async_register_resource(hass, "test_version_hash_123")

    create_mock = cast("AsyncMock", mock_resources.async_create_item)
    create_mock.assert_not_awaited()
    delete_mock = cast("AsyncMock", mock_resources.async_delete_item)
    delete_mock.assert_not_awaited()


async def test_register_resource_replaces_stale_entry(hass: HomeAssistant) -> None:
    """Load storage and replace a stale registered resource with the new URL."""
    mock_resources = MagicMock()
    mock_resources.loaded = False
    mock_resources.async_load = AsyncMock()
    mock_resources.async_items = MagicMock(
        return_value=[
            {"id": "unrelated", "url": "/other/lovelace/card.js"},
            {"id": "res_stale", "url": f"{RESOURCE_BASE_URL}?v=old_hash"},
        ]
    )
    mock_resources.async_create_item = AsyncMock()
    mock_resources.async_delete_item = AsyncMock()

    mock_lovelace = MagicMock()
    mock_lovelace.resources = mock_resources

    hass.data["lovelace"] = mock_lovelace

    await async_register_resource(hass, "test_version_hash_123")

    load_mock = cast("AsyncMock", mock_resources.async_load)
    load_mock.assert_awaited_once()
    delete_mock = cast("AsyncMock", mock_resources.async_delete_item)
    delete_mock.assert_awaited_once_with("res_stale")
    create_mock = cast("AsyncMock", mock_resources.async_create_item)
    create_mock.assert_awaited_once()


async def test_register_resource_stale_delete_failure(hass: HomeAssistant) -> None:
    """Abort registration when removing the stale resource fails."""
    mock_resources = MagicMock()
    mock_resources.loaded = True
    mock_resources.async_items = MagicMock(
        return_value=[{"id": "res_stale", "url": f"{RESOURCE_BASE_URL}?v=old_hash"}]
    )
    mock_resources.async_create_item = AsyncMock()
    mock_resources.async_delete_item = AsyncMock(side_effect=TypeError("broken"))

    mock_lovelace = MagicMock()
    mock_lovelace.resources = mock_resources

    hass.data["lovelace"] = mock_lovelace

    await async_register_resource(hass, "test_version_hash_123")

    delete_mock = cast("AsyncMock", mock_resources.async_delete_item)
    delete_mock.assert_awaited_once_with("res_stale")
    create_mock = cast("AsyncMock", mock_resources.async_create_item)
    create_mock.assert_not_awaited()


async def test_register_resource_create_failure(hass: HomeAssistant) -> None:
    """Log an error when creating the new resource item fails."""
    mock_resources = MagicMock()
    mock_resources.loaded = True
    mock_resources.async_items = MagicMock(return_value=[])
    mock_resources.async_create_item = AsyncMock(side_effect=ValueError("broken"))
    mock_resources.async_delete_item = AsyncMock()

    mock_lovelace = MagicMock()
    mock_lovelace.resources = mock_resources

    hass.data["lovelace"] = mock_lovelace

    await async_register_resource(hass, "test_version_hash_123")

    create_mock = cast("AsyncMock", mock_resources.async_create_item)
    create_mock.assert_awaited_once()


async def test_unregister_resource_without_lovelace(hass: HomeAssistant) -> None:
    """Return early when Lovelace data is not present in Home Assistant."""
    await async_unregister_resource(hass)


async def test_unregister_resource_without_resources_collection(
    hass: HomeAssistant,
) -> None:
    """Return early when Lovelace exposes no usable resources collection."""
    mock_lovelace = MagicMock()
    mock_lovelace.resources = None

    hass.data["lovelace"] = mock_lovelace

    await async_unregister_resource(hass)


async def test_unregister_resource_not_in_storage_mode(hass: HomeAssistant) -> None:
    """Return early when resources lack the required deletion interface."""
    mock_resources = SimpleNamespace(loaded=True)
    mock_lovelace = MagicMock()
    mock_lovelace.resources = mock_resources

    hass.data["lovelace"] = mock_lovelace

    await async_unregister_resource(hass)


async def test_unregister_resource_delete_failure(hass: HomeAssistant) -> None:
    """Log an error when removing the registered resource fails."""
    mock_resources = MagicMock()
    mock_resources.loaded = True
    mock_resources.async_items = MagicMock(
        return_value=[
            {"id": "res_123", "url": f"{RESOURCE_BASE_URL}?v=test_version_hash_123"}
        ]
    )
    mock_resources.async_create_item = AsyncMock()
    mock_resources.async_delete_item = AsyncMock(side_effect=ValueError("broken"))

    mock_lovelace = MagicMock()
    mock_lovelace.resources = mock_resources

    hass.data["lovelace"] = mock_lovelace

    await async_unregister_resource(hass)

    delete_mock = cast("AsyncMock", mock_resources.async_delete_item)
    delete_mock.assert_awaited_once_with("res_123")
