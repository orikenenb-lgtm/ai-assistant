"""DEMO adapters — fictional suppliers, real geography, deterministic, clearly labeled DEMO."""

from app.modules.providers.demo.activities import DemoFunTripAdapter, DemoKidVenturesAdapter
from app.modules.providers.demo.cars import DemoDriveAdapter, DemoRentwayAdapter
from app.modules.providers.demo.common import DEMO_NOTE, DemoAdapter
from app.modules.providers.demo.flights import DemoAuroraAdapter, DemoSkylineAdapter
from app.modules.providers.demo.hotels import DemoHoteliaAdapter, DemoStayPlusAdapter

DEMO_ADAPTER_CLASSES: tuple[type[DemoAdapter], ...] = (
    DemoSkylineAdapter,
    DemoAuroraAdapter,
    DemoStayPlusAdapter,
    DemoHoteliaAdapter,
    DemoDriveAdapter,
    DemoRentwayAdapter,
    DemoFunTripAdapter,
    DemoKidVenturesAdapter,
)

__all__ = [
    "DEMO_ADAPTER_CLASSES",
    "DEMO_NOTE",
    "DemoAdapter",
    "DemoAuroraAdapter",
    "DemoDriveAdapter",
    "DemoFunTripAdapter",
    "DemoHoteliaAdapter",
    "DemoKidVenturesAdapter",
    "DemoRentwayAdapter",
    "DemoSkylineAdapter",
    "DemoStayPlusAdapter",
]
