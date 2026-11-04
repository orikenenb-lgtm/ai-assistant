package com.disciplineos.app.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import com.disciplineos.app.R
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Creates all notification channels (idempotent; re-creating updates names/descriptions for a locale change
 * but never overrides importance the user changed). minSdk 26, so channels always exist.
 */
@Singleton
class NotificationChannelsInitializer @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    fun createAll() {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channels = listOf(
            channel(
                NotificationChannels.REMINDERS,
                R.string.notif_channel_reminders_name,
                R.string.notif_channel_reminders_desc,
                NotificationManager.IMPORTANCE_HIGH,
            ),
            channel(
                NotificationChannels.FOCUS,
                R.string.notif_channel_focus_name,
                R.string.notif_channel_focus_desc,
                NotificationManager.IMPORTANCE_LOW,
            ).apply { setShowBadge(false) },
            channel(
                NotificationChannels.ENFORCEMENT,
                R.string.notif_channel_enforcement_name,
                R.string.notif_channel_enforcement_desc,
                NotificationManager.IMPORTANCE_LOW,
            ).apply { setShowBadge(false) },
            channel(
                NotificationChannels.COACH,
                R.string.notif_channel_coach_name,
                R.string.notif_channel_coach_desc,
                NotificationManager.IMPORTANCE_DEFAULT,
            ),
        )
        manager.createNotificationChannels(channels)
    }

    private fun channel(id: String, nameRes: Int, descRes: Int, importance: Int) =
        NotificationChannel(id, context.getString(nameRes), importance).apply {
            description = context.getString(descRes)
        }
}
