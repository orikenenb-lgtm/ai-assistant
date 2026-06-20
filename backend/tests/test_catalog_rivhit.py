"""
בדיקות בטיחות לקטלוג: רווחית = קריאה בלבד.
מוכיח שכל פקודת כתיבה נחסמת *לפני* כל פנייה לרשת.
"""
import pytest

from app.catalog import rivhit_readonly as ro

# פקודות כתיבה אסורות — אסור שאחת מהן תגיע אי-פעם לרווחית
FORBIDDEN = [
    "Item.New", "Item.Update", "Item.Delete",
    "Customer.New", "Customer.Update", "Customer.Delete",
    "Document.New", "Document.Cancel", "Document.Close",
    "Receipt.New", "Receipt.Cancel",
    "Accounting.AddJournal", "Company.Update",
]


@pytest.mark.parametrize("method", FORBIDDEN)
def test_write_methods_blocked(method):
    """כל פקודת כתיבה זורקת RivhitWriteAttemptError."""
    with pytest.raises(ro.RivhitWriteAttemptError):
        ro._assert_read_only(method)


def test_no_forbidden_method_in_whitelist():
    """אף פקודת כתיבה אינה ברשימה הלבנה."""
    assert ro.READ_ONLY_METHODS.isdisjoint(set(FORBIDDEN))


def test_whitelist_is_only_reads():
    """הרשימה הלבנה מכילה אך ורק פקודות שמסתיימות ב-List/Details/Quantity/Get."""
    for m in ro.READ_ONLY_METHODS:
        assert m.split(".")[1] in {"List", "Details", "Quantity", "Get"}


def test_blocked_method_never_hits_network(monkeypatch):
    """קריאה לפקודת כתיבה לא נוגעת ב-requests.post בכלל — נחסמת בשער."""
    def _boom(*a, **k):
        raise AssertionError("requests.post נקרא עבור פקודה חסומה — אסור!")
    monkeypatch.setattr(ro.requests, "post", _boom)
    with pytest.raises(ro.RivhitWriteAttemptError):
        ro.call("Document.New", {"x": 1})


def test_read_method_passes_gate_then_needs_token(monkeypatch):
    """פקודת קריאה עוברת את השער; נעצרת רק בהיעדר טוקן (לא חסומה כ-write)."""
    monkeypatch.setattr(ro.requests, "post", lambda *a, **k: (_ for _ in ()).throw(AssertionError("לא אמור להגיע לרשת בלי טוקן")))
    # אין טוקן דמו בבדיקות → RivhitReadOnlyError (לא WriteAttempt)
    with pytest.raises(ro.RivhitReadOnlyError):
        ro.call("Item.List")


def test_map_item_provisional():
    """מיפוי פריט גולמי לשורת catalog_products."""
    out = ro.map_item({"item_id": 7, "item_name": "דובי", "sale_nis": 25.5, "quantity": 12})
    assert out["rivhit_item_id"] == 7 and out["name"] == "דובי"
    assert out["price"] == 25.5 and out["quantity"] == 12
