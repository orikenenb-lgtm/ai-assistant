"""Trips, trip items, budget and exports (contract 3.4)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import AuthContext, current_user, require_editor
from app.modules.itineraries import service
from app.modules.itineraries.budget import compute_budget
from app.modules.itineraries.ics import build_ics
from app.modules.itineraries.pdf import build_trip_pdf
from app.modules.itineraries.schemas import (
    BudgetOut,
    FromOfferIn,
    FromOfferOut,
    ReorderIn,
    TripCreate,
    TripDetail,
    TripItemCreate,
    TripItemOut,
    TripItemUpdate,
    TripSummary,
    TripUpdate,
)
from app.schemas.common import OkResponse

router = APIRouter(prefix="/api/trips", tags=["itineraries"])


@router.get("", response_model=list[TripSummary])
def list_trips(ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    return service.list_trips(db)


@router.post("", response_model=TripDetail, status_code=201)
def create_trip(body: TripCreate, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)):
    trip = service.create_trip(db, ctx.user, body, request)
    return service.trip_detail(db, trip)


@router.get("/{trip_id}", response_model=TripDetail)
def get_trip(trip_id: str, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    return service.trip_detail(db, service.get_trip(db, trip_id))


@router.patch("/{trip_id}", response_model=TripDetail)
def update_trip(
    trip_id: str, body: TripUpdate, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)
):
    trip = service.update_trip(db, ctx.user, service.get_trip(db, trip_id), body, request)
    return service.trip_detail(db, trip)


@router.delete("/{trip_id}", response_model=OkResponse)
def delete_trip(trip_id: str, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)):
    service.delete_trip(db, ctx.user, service.get_trip(db, trip_id), request)
    return OkResponse()


# ---------------- items ----------------


@router.post("/{trip_id}/items", response_model=TripItemOut, status_code=201)
def create_item(
    trip_id: str, body: TripItemCreate, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)
):
    trip = service.get_trip(db, trip_id)
    item = service.create_item(db, ctx.user, trip, body, request)
    return service.item_out(item, trip)


@router.post("/{trip_id}/items/from-offer", response_model=FromOfferOut, status_code=201)
def item_from_offer(
    trip_id: str, body: FromOfferIn, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)
):
    trip = service.get_trip(db, trip_id)
    items = service.add_items_from_offer(db, ctx.user, trip, body.offer_id, request)
    outs = [service.item_out(i, trip) for i in items]
    return FromOfferOut(item=outs[0], items=outs)


@router.post("/{trip_id}/items/reorder", response_model=TripDetail)
def reorder_items(trip_id: str, body: ReorderIn, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)):
    trip = service.get_trip(db, trip_id)
    service.reorder_items(db, trip, body.item_ids)
    return service.trip_detail(db, service.get_trip(db, trip_id))


@router.patch("/{trip_id}/items/{item_id}", response_model=TripItemOut)
def update_item(
    trip_id: str,
    item_id: str,
    body: TripItemUpdate,
    request: Request,
    ctx: AuthContext = Depends(require_editor),
    db: Session = Depends(get_db),
):
    trip = service.get_trip(db, trip_id)
    item = service.update_item(db, ctx.user, trip, service.get_item(db, trip, item_id), body, request)
    return service.item_out(item, trip)


@router.delete("/{trip_id}/items/{item_id}", response_model=OkResponse)
def delete_item(
    trip_id: str, item_id: str, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)
):
    trip = service.get_trip(db, trip_id)
    service.delete_item(db, ctx.user, trip, service.get_item(db, trip, item_id), request)
    return OkResponse()


# ---------------- budget & exports ----------------


@router.get("/{trip_id}/budget", response_model=BudgetOut)
def trip_budget(trip_id: str, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    return compute_budget(service.get_trip(db, trip_id))


@router.get("/{trip_id}/export.ics")
def export_ics(trip_id: str, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    trip = service.get_trip(db, trip_id)
    return Response(
        content=build_ics(trip),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="trip-{trip.id}.ics"'},
    )


@router.get("/{trip_id}/export.pdf")
def export_pdf(trip_id: str, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    trip = service.get_trip(db, trip_id)
    data = build_trip_pdf(service.trip_detail(db, trip), compute_budget(trip))
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="trip-{trip.id}.pdf"'},
    )
