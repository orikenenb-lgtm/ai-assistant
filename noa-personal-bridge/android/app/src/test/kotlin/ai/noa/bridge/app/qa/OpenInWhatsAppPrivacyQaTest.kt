package ai.noa.bridge.app.qa

import ai.noa.bridge.app.OpenInWhatsAppResult
import ai.noa.bridge.app.platform.BridgeApiClient
import ai.noa.bridge.app.platform.DefaultAppController
import ai.noa.bridge.app.platform.ListenerState
import ai.noa.bridge.app.platform.NotificationIngestor
import ai.noa.bridge.app.platform.NotificationMapper
import ai.noa.bridge.app.platform.ReplyActionRegistry
import ai.noa.bridge.app.platform.SecureStore
import ai.noa.bridge.app.platform.SettingsStore
import ai.noa.bridge.core.BridgeCoordinator
import ai.noa.bridge.core.Clock
import ai.noa.bridge.core.ConversationFilter
import ai.noa.bridge.core.DraftState
import ai.noa.bridge.core.FilterResult
import ai.noa.bridge.core.SendOutcome
import android.app.Application
import android.app.PendingIntent
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog
import java.util.Collections

/**
 * D-020 privacy: the chat's phone number (read from WhatsApp's JID for "open in WhatsApp") stays in
 * memory on the device. Through the REAL path — NotificationMapper → NotificationIngestor →
 * DefaultAppController → BridgeCoordinator → BridgeApiClient (OkHttp) → a loopback MockWebServer —
 * the number never appears in a request (path, headers or body), in the log, or in any file the
 * app writes (settings, encrypted store).
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class OpenInWhatsAppPrivacyQaTest {
    private val context: Application = ApplicationProvider.getApplicationContext()
    private val server = MockWebServer()
    private val requests: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private val wa = WhatsAppNotifications(context)
    private val phone = DANA_JID.substringBefore('@')

    @After fun tearDown() {
        runCatching { server.shutdown() }
        ListenerState.detach()
    }

    private fun TestScope.waitFor(realMillis: Long = 10_000, done: () -> Boolean) {
        val until = System.nanoTime() + realMillis * 1_000_000
        while (!done() && System.nanoTime() < until) {
            Thread.sleep(10)
            runCurrent()
        }
    }

    @Test fun phoneStaysOnTheDevice_neverInServerRequestsLogsOrFiles() = runTest {
        ShadowLog.clear()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = request.body.readUtf8()
                requests += "${request.requestLine}\n${request.headers}\n$body"
                return if (request.path == "/health") {
                    MockResponse().setBody("""{"ok":true,"enabled":true}""")
                } else {
                    val requestId = Regex("\"request_id\"\\s*:\\s*\"([^\"]+)\"").find(body)?.groupValues?.get(1)
                    MockResponse().setBody("""{"request_id":"$requestId","draft_text":"נתראה מחר","engine":"stub"}""")
                }
            }
        }
        server.start()
        val registry = ReplyActionRegistry()
        val secure = SecureStore(context, QaCipher()).apply {
            baseUrl = server.url("/").toString().trimEnd('/')
            deviceId = "dev_qa"
            deviceToken = "qa-token-not-real"
        }
        val c = DefaultAppController(
            context = context,
            scope = backgroundScope,
            secureStore = secure,
            settingsStore = SettingsStore(context),
            registry = registry,
            notifier = null,
            replySender = { _, _ -> SendOutcome.FAILED_NO_ACTION },
            apiClientFactory = { creds, onUnauthorized ->
                BridgeApiClient(credentials = creds, allowDebugCleartext = true, onUnauthorized = onUnauthorized)
            },
            coordinatorFactory = { engine, sender, settings ->
                BridgeCoordinator.create(backgroundScope, Clock { testScheduler.currentTime }, engine, sender, settings)
            },
            replyPathCompiledIn = true,
            allowDebugCleartext = true,
            debounceMillis = DEBOUNCE_MS,
            ioDispatcher = UnconfinedTestDispatcher(testScheduler),
            isDeviceLocked = { false },
            deviceName = "SM-S938B",
        ).apply { setCloudConsent(true) }
        val filter = ConversationFilter.create()
        val ingestor = NotificationIngestor(
            registry = registry,
            onNotification = { c.coordinator.onNotification(it) },
            onConversationRemoved = { c.coordinator.onNotificationRemoved(it) },
            wouldAccept = { s -> filter.evaluate(s, c.settings.value) is FilterResult.Accepted },
        )

        val notification = wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "מתי נפגשים?", 1_000)))
        notification.contentIntent = PendingIntent.getActivity(
            context, 3, Intent("ai.noa.bridge.qa.OPEN_CHAT").setPackage(context.packageName), PendingIntent.FLAG_IMMUTABLE,
        )
        ingestor.onPosted(NotificationMapper.map(notification, "com.whatsapp", "0|com.whatsapp|7|null|10", DANA_JID, 1_000L))
        advanceTimeBy(DEBOUNCE_MS); runCurrent()
        waitFor { c.drafts.value.singleOrNull()?.state == DraftState.AWAITING_APPROVAL }
        val draft = c.drafts.value.single()
        assertEquals(DraftState.AWAITING_APPROVAL, draft.state)

        // The number is known on the device: "open in WhatsApp" pre-types the reply for this chat.
        assertEquals(OpenInWhatsAppResult.OPENED_WITH_TEXT, c.openInWhatsApp(draft.id))
        val opened = shadowOf(context).nextStartedActivity
        assertEquals(phone, opened.data!!.getQueryParameter("phone"))
        assertEquals("נתראה מחר", opened.data!!.getQueryParameter("text"))
        assertEquals(DraftState.AWAITING_APPROVAL, c.drafts.value.single().state)

        // ...but it never left the device.
        val drafts = requests.filter { it.startsWith("POST /v1/drafts") }
        assertEquals(1, drafts.size)
        assertTrue("the message itself was sent (consent given)", drafts.single().contains("מתי נפגשים?"))
        requests.forEach { r ->
            assertFalse("phone in a server request", r.contains(phone))
            assertFalse("JID in a server request", r.contains("whatsapp.net"))
        }
        assertTrue(ShadowLog.getLogs().none { it.msg.contains(phone) })
        context.dataDir.walkTopDown().filter { it.isFile }.forEach { f ->
            assertFalse("phone persisted in ${f.name}", f.readBytes().toString(Charsets.ISO_8859_1).contains(phone))
        }
    }
}
