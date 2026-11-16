package ai.noa.bridge.app.platform

import ai.noa.bridge.core.DraftState
import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    fun postsPrivateNotificationOpeningWhatsAppAndWithdrawsIt() {
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        notifier.onDrafts(listOf(draft("d1", key('a'), DraftState.DEBOUNCING)))
        assertTrue(shadowOf(nm).allNotifications.isEmpty())

        notifier.onDrafts(listOf(draft("d1", key('a'), DraftState.AWAITING_APPROVAL, sender = "דנה")))
        val n = shadowOf(nm).allNotifications.single()
        assertEquals(DraftNotifier.CHANNEL_ID, n.channelId)
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, nm.getNotificationChannel(DraftNotifier.CHANNEL_ID).importance)
        assertEquals("טיוטה מוכנה לאישור", n.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        // S-L6: no sender name in either version (lock screen, watch, Link to Windows).
        assertEquals("לחץ כדי לפתוח ב-WhatsApp עם הטיוטה", n.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        assertEquals(Notification.VISIBILITY_PRIVATE, n.visibility)
        assertEquals("טיוטה מוכנה לאישור", n.publicVersion.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals("לחץ כדי לפתוח ב-WhatsApp עם הטיוטה", n.publicVersion.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        // D-020: tap → straight to WhatsApp via our no-UI activity; one action opens the app.
        assertTrue(n.contentIntent.isImmutable)
        assertEquals(
            "ai.noa.bridge.app.OpenInWhatsAppActivity",
            shadowOf(n.contentIntent).savedIntent.component!!.className,
        )
        assertEquals("פתח באפליקציה", n.actions.single().title.toString())
        assertEquals(
            "ai.noa.bridge.app.MainActivity",
            shadowOf(n.actions.single().actionIntent).savedIntent.component!!.className,
        )

        // Same draft again (e.g. edited) → not re-announced.
        notifier.onDrafts(listOf(draft("d1", key('a'), DraftState.AWAITING_APPROVAL)))
        assertEquals(1, shadowOf(nm).allNotifications.size)

        notifier.onDrafts(listOf(draft("d1", key('a'), DraftState.SEND_ATTEMPTED)))
        assertFalse(shadowOf(nm).allNotifications.isNotEmpty())
    }
}
