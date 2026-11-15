package ai.noa.bridge.app.qa

import ai.noa.bridge.app.BridgeApplication
import ai.noa.bridge.app.platform.ListenerState
import ai.noa.bridge.app.platform.NoaNotificationListenerService
import ai.noa.bridge.app.platform.RemoteInputReplySender
import ai.noa.bridge.core.ConversationKeys
import ai.noa.bridge.core.DraftState
import ai.noa.bridge.core.SendOutcome
import android.os.Process
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.annotation.Config
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowNotificationListenerService

/**
 * QA traceability: spec 13.1 "permission revoked (listener disconnected)" and "restart (reply
 * handles rebuilt from active notifications)", exercised on the REAL NoaNotificationListenerService
 * inside the REAL BridgeApplication / PlatformGraph (Robolectric). The draft engine is never
 * reached (no consent is given), so no network is used.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35]) // application = BridgeApplication from the manifest
class ListenerServiceQaTest {
    private val app: BridgeApplication = ApplicationProvider.getApplicationContext()
    private val wa = WhatsAppNotifications(app)

    @Before fun reset() = ShadowNotificationListenerService.reset()

    @After fun detach() = ListenerState.detach()

    private fun service(): Pair<NoaNotificationListenerService, ShadowNotificationListenerService> {
        val s = Robolectric.buildService(NoaNotificationListenerService::class.java).create().get()
        return s to Shadow.extract(s)
    }

    /**
     * Shows [n] as an active notification of [pkg] posted by [user] (default: this user, as on the
     * phone). Robolectric's addActiveNotification(pkg, id, n) posts as UserHandle.CURRENT (-2),
     * which the service correctly treats as "another user", so the SBN is built explicitly.
     */
    @Suppress("DEPRECATION")
    private fun ShadowNotificationListenerService.show(
        pkg: String,
        id: Int,
        n: android.app.Notification,
        user: android.os.UserHandle = Process.myUserHandle(),
    ) {
        addActiveNotification(StatusBarNotification(pkg, pkg, id, null, 10_123, 0, 0, n, user, 1_000L))
    }


    @Test fun service_onListenerConnected_rebuildsReplyHandlesFromActiveNotifications_withoutDrafts() {
        val (svc, shadow) = service()
        val n = wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "הודעה ישנה מלפני הריסטארט", 1_000)))
        shadow.show("com.whatsapp", 1, n)
        shadow.show("com.whatsapp.w4b", 2, n) // WhatsApp Business: never ours
        shadow.show("org.telegram.messenger", 3, n)
        val sbn = svc.activeNotifications.single { it.packageName == "com.whatsapp" }
        assertEquals(Process.myUserHandle(), sbn.user)

        svc.onListenerConnected()

        assertTrue(ListenerState.connected.value)
        val registry = app.platform.registry
        assertEquals("only personal WhatsApp gets a handle", 1, registry.size)
        val key = ConversationKeys.derive(ai.noa.bridge.app.platform.NotificationMapper.map(sbn).snapshot)!!
        assertNotNull(registry.get(key))
        assertTrue("old messages must not create drafts", app.platform.controller.drafts.value.isEmpty())
    }

    @Test fun service_rebuiltHandle_isUsableWhileConnected_andRefusedAfterAccessRevoked() {
        val (svc, shadow) = service()
        shadow.show("com.whatsapp", 1, wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))))
        val sbn = svc.activeNotifications.single()
        val key = ConversationKeys.derive(ai.noa.bridge.app.platform.NotificationMapper.map(sbn).snapshot)!!
        val registry = app.platform.registry
        // Production sender wiring (ListenerState decides what is "active"), main work inline.
        val sender = RemoteInputReplySender(app, registry, Dispatchers.Unconfined)

        svc.onListenerConnected()
        assertEquals(SendOutcome.ATTEMPTED, runBlocking { sender.send(key, "שלום מהבדיקה") })
        assertEquals(listOf("dana.v1" to "שלום מהבדיקה"), repliesSent(app))

        // Same handle again after reconnect, then the user revokes Notification Access.
        svc.onListenerConnected()
        assertNotNull(registry.get(key))
        val rebindsBefore = ShadowNotificationListenerService.getRebindRequestCount()
        svc.onListenerDisconnected()
        assertFalse(ListenerState.connected.value)
        assertEquals("asks the system to rebind", rebindsBefore + 1, ShadowNotificationListenerService.getRebindRequestCount())
        assertEquals(SendOutcome.FAILED_NO_ACTION, runBlocking { sender.send(key, "לא אמור לצאת") })
        assertEquals(1, repliesSent(app).size)
    }

    @Test fun service_postedPrivateMessage_reachesCoordinator_andUserOpeningChatExpiresIt() {
        val (svc, shadow) = service()
        svc.onListenerConnected()
        shadow.show("com.whatsapp", 7, wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))))
        val sbn = svc.activeNotifications.single()

        svc.onNotificationPosted(sbn, null)
        val drafts = app.platform.controller.drafts.value
        assertEquals(1, drafts.size)
        assertEquals(DraftState.DEBOUNCING, drafts.single().state)
        assertEquals(1, app.platform.registry.size)

        svc.onNotificationRemoved(sbn, null, NotificationListenerService.REASON_CLICK)
        assertEquals(DraftState.EXPIRED, app.platform.controller.drafts.value.single().state)
        assertEquals(0, app.platform.registry.size)
    }

    @Test fun service_ignoresOtherAppsOtherUsersAndGroupChats() {
        val (svc, shadow) = service()
        svc.onListenerConnected()
        shadow.show("com.whatsapp.w4b", 1, wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))))
        shadow.show("com.whatsapp", 2, wa.groupChat(listOf(Line(wa.dana, "מי מגיע?", 1_000))))
        // Samsung Dual Messenger / work-profile clone of WhatsApp runs as another user (e.g. 95).
        shadow.show("com.whatsapp", 3, wa.privateChat(wa.yossi, YOSSI_JID, listOf(Line(wa.yossi, "היי", 1_000))), android.os.UserHandle.getUserHandleForUid(95 * 100_000 + 10_123))
        svc.activeNotifications.forEach { svc.onNotificationPosted(it, null) }
        assertTrue(app.platform.controller.drafts.value.isEmpty())
        assertEquals(0, app.platform.registry.size)
    }
}
