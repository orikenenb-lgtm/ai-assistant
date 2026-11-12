"""LIVE adapters for official provider APIs (placeholders in this wave — no network calls)."""

from app.modules.providers.live.amadeus import AmadeusAdapter
from app.modules.providers.live.booking_demand import BookingDemandAdapter
from app.modules.providers.live.common import LiveAdapter
from app.modules.providers.live.duffel import DuffelAdapter
from app.modules.providers.live.expedia_rapid import ExpediaRapidAdapter
from app.modules.providers.live.viator import ViatorAdapter

LIVE_ADAPTER_CLASSES: tuple[type[LiveAdapter], ...] = (
    DuffelAdapter,
    AmadeusAdapter,
    BookingDemandAdapter,
    ExpediaRapidAdapter,
    ViatorAdapter,
)

__all__ = [
    "LIVE_ADAPTER_CLASSES",
    "AmadeusAdapter",
    "BookingDemandAdapter",
    "DuffelAdapter",
    "ExpediaRapidAdapter",
    "LiveAdapter",
    "ViatorAdapter",
]
