"""Error envelope of API_CONTRACT.md: ``{"error": "<code>", "message": "<hebrew>"}``.

Messages are fixed strings: no error ever echoes request values back.
"""

from __future__ import annotations

from fastapi.responses import JSONResponse

MESSAGES: dict[str, str] = {
    "unauthorized": "המכשיר אינו מזוהה או שנותק. יש לבצע צימוד מחדש.",
    "replay": "הבקשה נדחתה: חותמת הזמן או המזהה החד־פעמי אינם תקינים. ודאו שהשעון בטלפון מכוון.",
    "too_large": "הבקשה גדולה מדי.",
    "invalid_request": "הבקשה אינה תקינה.",
    "rate_limited": "יותר מדי בקשות. נסו שוב מאוחר יותר.",
    "disabled": "השירות כבוי כרגע.",
    "engine_error": "לא הצלחנו להכין טיוטה כרגע. נסו שוב בעוד רגע.",
    "invalid_pairing_code": "קוד הצימוד שגוי, שפג תוקפו או שכבר נוצל.",
    "not_found": "הנתיב לא נמצא.",
    "method_not_allowed": "פעולה לא נתמכת בנתיב זה.",
    "internal_error": "אירעה שגיאה פנימית. נסו שוב מאוחר יותר.",
}

STATUS_CODES: dict[str, int] = {
    "unauthorized": 401,
    "replay": 409,
    "too_large": 413,
    "invalid_request": 422,
    "rate_limited": 429,
    "disabled": 503,
    "engine_error": 502,
    "invalid_pairing_code": 400,
    "not_found": 404,
    "method_not_allowed": 405,
    "internal_error": 500,
}


# Fixed alternative message for 422 `invalid_request` (security review L-4).
MESSAGE_REQUEST_ID_REUSED = "מזהה הבקשה כבר שימש לבקשה אחרת"


class ApiError(Exception):
    def __init__(
        self, code: str, *, headers: dict[str, str] | None = None, message: str | None = None
    ) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = STATUS_CODES[code]
        self.headers = headers or {}
        self.message = message  # a fixed string from this module, never request data


def error_body(code: str, message: str | None = None) -> dict[str, str]:
    return {"error": code, "message": message or MESSAGES[code]}


def error_response(
    code: str, headers: dict[str, str] | None = None, message: str | None = None
) -> JSONResponse:
    return JSONResponse(error_body(code, message), status_code=STATUS_CODES[code], headers=headers)
