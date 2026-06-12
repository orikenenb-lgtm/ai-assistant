"""הגבלת קצב (rate limiting) — מניעת brute force על נתיבי אימות."""
from slowapi import Limiter
from slowapi.util import get_remote_address

# מפתח לפי כתובת IP; מאוחסן בזיכרון — מספיק לעומס של העסק
limiter = Limiter(key_func=get_remote_address)
