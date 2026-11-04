package com.disciplineos.app.notifications

/** Channel ids (contract). Channels are created in DisciplineApp.onCreate by NotificationChannelsInitializer. */
object NotificationChannels {
    const val REMINDERS = "reminders"
    const val FOCUS = "focus"
    const val ENFORCEMENT = "enforcement"
    const val COACH = "coach"

    // Notification ids (stable, non-overlapping ranges)
    const val ID_ENFORCEMENT = 1001
    const val ID_FOCUS = 1002
    const val ID_DAILY_SUMMARY = 1003
    /** Task reminders use ID_REMINDER_BASE + occurrenceId.mod(100_000). */
    const val ID_REMINDER_BASE = 200_000
}
