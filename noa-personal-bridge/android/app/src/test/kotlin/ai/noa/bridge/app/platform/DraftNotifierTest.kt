package ai.noa.bridge.app.platform

import ai.noa.bridge.core.DraftState
import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class DraftNotifierTest {
    private val context: Application = ApplicationProvider.getApplicationContext()
    private val nm = context.getSystemService(NotificationManager::class.java)
    private val notifier = DraftNotifier(context)

    @Test
    fun skipsSilentlyWithoutPostNotificationsPermission() {
        shadowOf(context).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)
        notifier.onDrafts(listOf(draft("d1", key('a'), DraftState.AWAITING_APPROVAL)))
        assertTrue(shadowOf(nm).allNotifications.isEmpty())
    }

    @Test
    fun postsPrivateNotificationWithoutActionsAndWithdrawsIt() {
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        notifier.onDrafts(listOf(draft("d1", key('a'), DraftState.DEBOUNCING)))
        assertTrue(shadowOf(nm).allNotifications.isEmpty())

        notifier.onDrafts(listOf(draft("d1", key('a'), DraftState.AWAITING_APPROVAL, sender = "דנה")))
        val n = shadowOf(nm).allNotifications.single()
        assertEquals(DraftNotifier.CHANNEL_ID, n.channelId)
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, nm.getNotificationChannel(DraftNotifier.CHANNEL_ID).importance)
        assertEquals("טיוטה מוכנה לאישור", n.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals("תשובה עבור דנה", n.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        assertEquals(Notification.VISIBILITY_PRIVATE, n.visibility)
        assertEquals("טיוטה חדשה ממתינה", n.publicVersion.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertNull(n.publicVersion.extras.getCharSequence(Notification.EXTRA_TEXT))
        assertTrue(n.actions.isNullOrEmpty())
        assertTrue(n.contentIntent.isImmutable)
        assertEquals(
            "ai.noa.bridge.app.MainActivity",
            shadowOf(n.contentIntent).savedIntent.component!!.className,
        )

        // Same draft again (e.g. edited) → not re-announced.
        notifier.onDrafts(listOf(draft("d1", key('a'), DraftState.AWAITING_APPROVAL)))
        assertEquals(1, shadowOf(nm).allNotifications.size)

        notifier.onDrafts(listOf(draft("d1", key('a'), DraftState.SEND_ATTEMPTED)))
        assertFalse(shadowOf(nm).allNotifications.isNotEmpty())
    }
}
