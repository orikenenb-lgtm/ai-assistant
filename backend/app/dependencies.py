"""
שכבת ההרשאות של ה-API (שכבת הגנה 2 — בנוסף ל-RLS ב-DB).
כל endpoint מוגן חייב להשתמש ב-get_current_user או require_admin.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.schemas.auth import UserOut
from app.services import auth_service

# auto_error=False כדי שנחזיר 401 אחיד גם כשאין header בכלל
_bearer = HTTPBearer(auto_error=False)


def get_access_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """ה-JWT הגולמי — ל-queries בזהות המשתמש (RLS). 401 אם אין."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="נדרשת התחברות",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials.credentials


def get_current_user(token: str = Depends(get_access_token)) -> UserOut:
    """מאמת JWT ומחזיר את המשתמש המחובר. 401 אם אין/פג טוקן."""
    user = auth_service.get_user_by_token(token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ה-session פג או שהטוקן אינו תקין — יש להתחבר מחדש",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user.status == "inactive":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="החשבון אינו פעיל")
    return user


def require_admin(user: UserOut = Depends(get_current_user)) -> UserOut:
    """מתיר גישה לאדמין בלבד — 403 לכל אחד אחר."""
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="פעולה זו מותרת למנהל מערכת בלבד",
        )
    return user
