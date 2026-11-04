package com.disciplineos.core.domain.coach

/** Hebrew system notices persisted into the chat (role NOTICE). Calm, informative, never blaming the user. */
internal object CoachNotices {
    const val EMPTY_REPLY = "לא התקבלה תשובה מהמאמן. אפשר לנסות לנסח את השאלה מחדש."
    const val ACTIONS_ONLY = "הנה הצעה שאפשר לאשר או לדחות:"

    fun forError(kind: CoachErrorKind): String = when (kind) {
        CoachErrorKind.OFFLINE -> "אין חיבור לרשת כרגע. אפשר להמשיך עם מאמן ההדגמה המקומי או לנסות שוב מאוחר יותר."
        CoachErrorKind.RATE_LIMITED -> "נשלחו הרבה בקשות בזמן קצר. כדאי לנסות שוב בעוד רגע."
        CoachErrorKind.QUOTA_EXCEEDED -> "הגעת למכסת השימוש של שירות המאמן. המכסה תתחדש בהמשך."
        CoachErrorKind.BACKEND_UNAVAILABLE -> "שירות המאמן אינו זמין כרגע. כדאי לנסות שוב מאוחר יותר."
        CoachErrorKind.INVALID_RESPONSE -> "התקבלה תשובה לא תקינה מהמאמן, ולכן היא לא הוצגה."
        CoachErrorKind.NOT_CONFIGURED -> "המאמן המרוחק לא הוגדר. אפשר להשתמש במאמן ההדגמה המקומי."
    }

    fun droppedActions(count: Int): String =
        if (count == 1) {
            "הצעה אחת לפעולה הוסרה כי לא עברה את בדיקת התקינות והבטיחות."
        } else {
            "$count הצעות לפעולה הוסרו כי לא עברו את בדיקת התקינות והבטיחות או חרגו מהמגבלה."
        }
}
