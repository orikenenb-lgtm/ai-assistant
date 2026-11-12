"""Duffel (flights) — LIVE placeholder.

Docs: https://duffel.com/docs/api — auth header ``Authorization: Bearer <ORI_DUFFEL_ACCESS_TOKEN>``
plus ``Duffel-Version``. Search = create an offer request (slices + passengers),
then list offers. Test tokens (``duffel_test_...``) return sandbox data.
"""

from __future__ import annotations

from typing import ClassVar

from app.modules.providers.live.common import LiveAdapter
from app.schemas.common import Category


class DuffelAdapter(LiveAdapter):
    provider_id = "duffel"
    display_name = "Duffel (טיסות)"
    categories: ClassVar[tuple[Category, ...]] = ("flight",)
    credential_fields = ("duffel_access_token",)
    official_docs_url = "https://duffel.com/docs/api"
    deep_link_domains = ("duffel.com",)
    rate_limit_note = "מגבלות קצב לפי חשבון Duffel; מצב בדיקה עם אסימון duffel_test"
    description = "API רשמי להזמנת טיסות (NDC וספקים נוספים). כיסוי חלקי של השוק — לא כל חברות התעופה זמינות."
