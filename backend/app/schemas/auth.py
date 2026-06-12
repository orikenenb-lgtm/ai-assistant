"""סכמות אימות — קלט ופלט של /auth/*."""
from pydantic import BaseModel, EmailStr, Field


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, description="לפחות 8 תווים")
    full_name: str = Field(min_length=2, max_length=100)
    phone: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ResetPasswordRequest(BaseModel):
    email: EmailStr


class UserOut(BaseModel):
    """פרטי המשתמש המחובר — בלי שום שדה רגיש."""
    id: str
    email: str | None = None
    role: str
    full_name: str | None = None
    phone: str | None = None
    rivhit_customer_id: int | None = None
    status: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int | None = None
    user: UserOut


class MessageResponse(BaseModel):
    message: str
