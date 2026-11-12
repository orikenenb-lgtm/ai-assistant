from __future__ import annotations

from datetime import datetime

from pydantic import Field

from app.schemas.common import ApiModel, EmailAddress


class LoginRequest(ApiModel):
    email: EmailAddress
    password: str = Field(..., min_length=1, max_length=256)


class UserOut(ApiModel):
    id: str
    email: str
    display_name: str
    role: str
    is_active: bool
    legal_adult_attested: bool
    can_book: bool
    last_login_at: datetime | None = None
    created_at: datetime


class SessionOut(ApiModel):
    user: UserOut
    csrf_token: str


class ChangePasswordRequest(ApiModel):
    current_password: str = Field(..., min_length=1, max_length=256)
    new_password: str = Field(..., min_length=1, max_length=256)


class ReauthRequest(ApiModel):
    password: str = Field(..., min_length=1, max_length=256)


class InvitationPreview(ApiModel):
    email: str
    display_name: str
    role: str
    expires_at: datetime


class InvitationTokenBody(ApiModel):
    token: str = Field(..., min_length=10, max_length=200)


class AcceptInvitationRequest(ApiModel):
    token: str = Field(..., min_length=10, max_length=200)
    password: str = Field(..., min_length=1, max_length=256)
