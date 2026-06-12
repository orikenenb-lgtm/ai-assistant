"""נתיבי אימות: הרשמה, התחברות, חידוש טוקן, פרטי משתמש, איפוס סיסמה."""
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.dependencies import get_current_user
from app.rate_limit import limiter
from app.schemas.auth import (
    LoginRequest,
    MessageResponse,
    RefreshRequest,
    ResetPasswordRequest,
    SignupRequest,
    TokenResponse,
    UserOut,
)
from app.services import auth_service
from app.services.auth_service import AuthError

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour")
def signup(request: Request, body: SignupRequest) -> TokenResponse:
    """הרשמת משתמש חדש. הפרופיל נוצר אוטומטית (role=customer)."""
    try:
        return auth_service.signup(body.email, body.password, body.full_name, body.phone)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")  # מניעת brute force על סיסמאות
def login(request: Request, body: LoginRequest) -> TokenResponse:
    """התחברות → JWT (תוקף שעה) + refresh token."""
    try:
        return auth_service.login(body.email, body.password)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.post("/refresh-token", response_model=TokenResponse)
def refresh_token(body: RefreshRequest) -> TokenResponse:
    """חידוש session — מחזיר access token חדש."""
    try:
        return auth_service.refresh(body.refresh_token)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.get("/me", response_model=UserOut)
def me(user: UserOut = Depends(get_current_user)) -> UserOut:
    """פרטי המשתמש המחובר (לפי ה-JWT)."""
    return user


@router.post("/reset-password", response_model=MessageResponse)
@limiter.limit("5/hour")
def reset_password(request: Request, body: ResetPasswordRequest) -> MessageResponse:
    """
    שליחת אימייל איפוס סיסמה.
    תמיד מחזיר את אותה הודעה — בלי לחשוף אם האימייל קיים במערכת.
    """
    auth_service.send_reset_password_email(body.email)
    return MessageResponse(message="אם האימייל רשום במערכת — נשלח אליו קישור לאיפוס סיסמה")
