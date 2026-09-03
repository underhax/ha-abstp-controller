"""Unit tests for Lovelace resource registration."""

import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, cast
from unittest.mock import MagicMock

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

from custom_components.abstp_controller.lovelace import (
    async_register_resource,
    async_unregister_resource,
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


async def test_lovelace_register_and_unregister(hass: HomeAssistant) -> None:
    """Test registering and unregistering Lovelace resources."""
    mock_resources = MagicMock()
    mock_resources.loaded = True
    mock_resources.async_items = MagicMock(return_value=[])
    mock_resources.async_create_item = MagicMock()
    mock_resources.async_delete_item = MagicMock()

    mock_lovelace = MagicMock()
    mock_lovelace.resources = mock_resources

    hass.data["lovelace"] = mock_lovelace

    await async_register_resource(hass, "test_version_hash_123")
    create_mock = cast("MagicMock", mock_resources.async_create_item)
    create_mock.assert_called_once()

    items_mock = cast("MagicMock", mock_resources.async_items)
    items_mock.return_value = [
        {
            "id": "res_123",
            "url": "/abstp_controller/abstp-player-card.js?v=test_version_hash_123",
            "res_type": "module",
        }
    ]
    await async_unregister_resource(hass)
    delete_mock = cast("MagicMock", mock_resources.async_delete_item)
    delete_mock.assert_called_once_with("res_123")
