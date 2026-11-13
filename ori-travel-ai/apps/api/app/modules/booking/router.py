"""Booking preparation API (contract §3.5). Real booking execution is OFF.

Every mutation requires an authorized adult (owner / attested adult) and is
CSRF-checked by ``current_user``. Rejected attempts are written to the audit
trail. There is deliberately no endpoint that accepts a ``state`` value: state
only moves through ``state_machine.transition``.
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.core.audit import record_audit
from app.core.db import get_db
from app.core.deps import AuthContext, current_user, require_booking_adult
from app.core.errors import AppError, ConflictError, ForbiddenError
from app.modules.booking import service
from app.modules.booking.schemas import (
    ApproveRequest,
    BookingCreate,
    BookingOut,
    BookingSummary,
    CancelRequest,
    CheckoutLinkOut,
    DemoCheckoutCompleteRequest,
    DemoCheckoutOut,
    RecordConfirmationRequest,
    SubmitRequest,
    TravelersUpdate,
)
from app.schemas.common import Page

router = APIRouter(tags=["booking"])

def booking_adult(request: Request, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)) -> AuthContext:
    """``require_booking_adult`` plus an audit record for refused attempts."""
    try:
        return require_booking_adult(ctx)
    except ForbiddenError as exc:
        record_audit(db, "booking.access_denied", actor_user_id=ctx.user_id, outcome="denied",
                     details={"code": exc.code, "method": request.method, "path": request.url.path[:200]},
                     request=request, commit=True)
        raise


def _guarded[T](db: Session, ctx: AuthContext, request: Request, action: str, booking_id: str | None,
             fn: Callable[[], T]) -> T:
    """Run a mutation; audit refusals and turn optimistic-lock failures into 409."""
    actor = ctx.user_id
    try:
        return fn()
    except StaleDataError:
        db.rollback()
        record_audit(db, f"booking.{action}", actor_user_id=actor, entity_type=service.ENTITY, entity_id=booking_id,
                     outcome="denied", details={"code": "CONCURRENT_UPDATE"}, request=request, commit=True)
        raise ConflictError("ההזמנה עודכנה במקביל על ידי פעולה אחרת. רעננו את הדף ונסו שוב.",
                            code="CONCURRENT_UPDATE") from None
    except AppError as exc:
        db.rollback()
        record_audit(db, f"booking.{action}", actor_user_id=actor, entity_type=service.ENTITY, entity_id=booking_id,
                     outcome="denied", details={"code": exc.code}, request=request, commit=True)
        raise


@router.post("/api/bookings", response_model=BookingOut, status_code=201)
def create_booking(body: BookingCreate, request: Request, ctx: AuthContext = Depends(booking_adult),
                   db: Session = Depends(get_db)):
    return _guarded(db, ctx, request, "create", None, lambda: service.create_intent(db, ctx, body, request))


@router.get("/api/bookings", response_model=Page[BookingSummary])
def list_bookings(
    state: str | None = Query(None, max_length=24),
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(20, ge=1, le=100),
    ctx: AuthContext = Depends(current_user),
    db: Session = Depends(get_db),
):
    return service.list_intents(db, state=state, page=page, page_size=page_size)


@router.get("/api/bookings/{booking_id}", response_model=BookingOut)
def get_booking(booking_id: str, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    return service.to_out(db, service.get_intent(db, booking_id), ctx)


@router.patch("/api/bookings/{booking_id}/travelers", response_model=BookingOut)
def change_travelers(booking_id: str, body: TravelersUpdate, request: Request,
                     ctx: AuthContext = Depends(booking_adult), db: Session = Depends(get_db)):
    return _guarded(db, ctx, request, "travelers_changed", booking_id,
                    lambda: service.update_travelers(db, ctx, booking_id, body.traveler_member_ids, request))


@router.post("/api/bookings/{booking_id}/revalidate", response_model=BookingOut)
def revalidate_booking(booking_id: str, request: Request, ctx: AuthContext = Depends(booking_adult),
                       db: Session = Depends(get_db)):
    return _guarded(db, ctx, request, "revalidate", booking_id, lambda: service.revalidate(db, ctx, booking_id, request))


@router.post("/api/bookings/{booking_id}/approve", response_model=BookingOut)
def approve_booking(booking_id: str, body: ApproveRequest, request: Request,
                    ctx: AuthContext = Depends(booking_adult), db: Session = Depends(get_db)):
    return _guarded(db, ctx, request, "approve", booking_id,
                    lambda: service.approve(db, ctx, booking_id, body.terms_hash, body.password, request))


@router.post("/api/bookings/{booking_id}/submit", response_model=BookingOut)
def submit_booking(booking_id: str, body: SubmitRequest, request: Request,
                   ctx: AuthContext = Depends(booking_adult), db: Session = Depends(get_db)):
    return _guarded(db, ctx, request, "submit", booking_id,
                    lambda: service.submit(db, ctx, booking_id, body.idempotency_key, request))


@router.post("/api/bookings/{booking_id}/reconcile", response_model=BookingOut)
def reconcile_booking(booking_id: str, request: Request, ctx: AuthContext = Depends(booking_adult),
                      db: Session = Depends(get_db)):
    return _guarded(db, ctx, request, "reconcile", booking_id, lambda: service.reconcile(db, ctx, booking_id, request))


@router.post("/api/bookings/{booking_id}/cancel", response_model=BookingOut)
def cancel_booking(booking_id: str, request: Request, body: CancelRequest | None = None,
                   ctx: AuthContext = Depends(booking_adult), db: Session = Depends(get_db)):
    reason = body.reason if body else None
    return _guarded(db, ctx, request, "cancel", booking_id, lambda: service.cancel(db, ctx, booking_id, reason, request))


@router.post("/api/bookings/{booking_id}/record-confirmation", response_model=BookingOut)
def record_confirmation(booking_id: str, body: RecordConfirmationRequest, request: Request,
                        ctx: AuthContext = Depends(booking_adult), db: Session = Depends(get_db)):
    return _guarded(db, ctx, request, "record_confirmation", booking_id,
                    lambda: service.record_confirmation(db, ctx, booking_id, body.supplier_reference, body.notes, request))


@router.post("/api/bookings/{booking_id}/checkout-link", response_model=CheckoutLinkOut)
def checkout_link(booking_id: str, request: Request, ctx: AuthContext = Depends(booking_adult),
                  db: Session = Depends(get_db)):
    return _guarded(db, ctx, request, "checkout_link", booking_id,
                    lambda: service.checkout_link(db, ctx, booking_id, request))


# ---- DEMO supplier page (in-app stand-in for a supplier's own site; docs/security/booking-safety.md §5) ----


@router.get("/api/demo-supplier/checkout", response_model=DemoCheckoutOut)
def demo_supplier_checkout(ref: str = Query(..., pattern=r"^[A-Za-z0-9_-]{16,64}$"),
                           ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    """Read-only. Signed-in family members only; changes nothing."""
    return service.demo_checkout_view(db, ctx, ref)


@router.post("/api/demo-supplier/checkout/complete", response_model=DemoCheckoutOut)
def demo_supplier_complete(body: DemoCheckoutCompleteRequest, request: Request,
                           ctx: AuthContext = Depends(booking_adult), db: Session = Depends(get_db)):
    """The DEMO supplier issues a reference. The booking itself is NOT confirmed by this call."""
    return _guarded(db, ctx, request, "demo_supplier_completed", None,
                    lambda: service.demo_checkout_complete(db, ctx, body.ref, request))
