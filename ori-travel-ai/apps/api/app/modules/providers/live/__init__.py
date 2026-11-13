"""LIVE adapters for official provider APIs.

Duffel (flights) and Viator (activities) make real HTTPS calls but only when explicitly enabled
(ORI_LIVE_PROVIDERS_ENABLED=true + credentials). Amadeus is discontinued; Booking.com Demand and Expedia
Rapid are non-functional placeholders awaiting partner approval.
"""

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
