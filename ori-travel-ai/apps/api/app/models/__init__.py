"""Import every model so that ``Base.metadata`` is complete (Alembic, tests)."""

from app.core.db import Base
from app.models.alerts import Alert, Notification
from app.models.auth import ROLE_ADULT, ROLE_OWNER, ROLE_VIEWER, ROLES, AuthSession, Invitation, User
from app.models.booking import BOOKING_STATES, Approval, BookingIntent, Reservation
from app.models.family import FamilyMember, TravelerProfile
from app.models.search import CATEGORIES, Offer, PriceSnapshot, ProviderSearch, SavedOffer, SearchRequest
from app.models.system import AppSetting, AuditEvent, ProviderConfiguration
from app.models.trips import Trip, TripItem, TripTraveler

__all__ = [
    "Base",
    "Alert",
    "AppSetting",
    "Approval",
    "AuditEvent",
    "AuthSession",
    "BOOKING_STATES",
    "BookingIntent",
    "CATEGORIES",
    "FamilyMember",
    "Invitation",
    "Notification",
    "Offer",
    "PriceSnapshot",
    "ProviderConfiguration",
    "ProviderSearch",
    "ROLES",
    "ROLE_ADULT",
    "ROLE_OWNER",
    "ROLE_VIEWER",
    "Reservation",
    "SavedOffer",
    "SearchRequest",
    "TravelerProfile",
    "Trip",
    "TripItem",
    "TripTraveler",
    "User",
]
