package ai.noa.bridge.app.qa

import ai.noa.bridge.app.platform.BridgeApiClient
import ai.noa.bridge.app.platform.DefaultAppController
import ai.noa.bridge.app.platform.ListenerState
import ai.noa.bridge.app.platform.ReplyActionRegistry
import ai.noa.bridge.app.platform.SecureStore
import ai.noa.bridge.app.platform.SettingsStore
import ai.noa.bridge.core.BridgeCoordinator
import ai.noa.bridge.core.Clock
import ai.noa.bridge.core.ConversationKeys
import ai.noa.bridge.core.Draft
import ai.noa.bridge.core.DraftState
import ai.noa.bridge.core.NotificationSnapshot
import ai.noa.bridge.core.SendOutcome
import ai.noa.bridge.core.SnapshotMessage
import android.app.Application
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
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.atomic.AtomicInteger

/**
 * QA traceability: spec 13.1 "no internet" (and "app crash" on the server side) through the REAL
 * engine path: DefaultAppController's consent-gated engine → BridgeApiClient (OkHttp) → loopback.
 * Only 127.0.0.1 is used (a closed port or a local MockWebServer); nothing leaves the machine.
 *
 * Expected: one attempt, the draft becomes FAILED with a Hebrew reason, no automatic retry
 * (OkHttp's silent retry is off, the coordinator never retries), status shows the backend as
 * unreachable, and the next message after connectivity returns is drafted normally.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class NoInternetQaTest {
    private val context: Application = ApplicationProvider.getApplicationContext()
    private val server = MockWebServer()
    private val draftCalls = AtomicInteger(0)

    @After fun tearDown() {
        runCatching { server.shutdown() }
        ListenerState.detach()
    }

    private fun TestScope.controller(baseUrl: String): DefaultAppController {
        val secure = SecureStore(context, QaCipher()).apply {
            this.baseUrl = baseUrl
            deviceId = "dev_qa"
            deviceToken = "qa-token-not-real"
        }
        return DefaultAppController(
            context = context,
            scope = backgroundScope,
            secureStore = secure,
            settingsStore = SettingsStore(context),
            registry = ReplyActionRegistry(),
            notifier = null,
            replySender = { _, _ -> SendOutcome.FAILED_NO_ACTION }, // these tests never send
            apiClientFactory = { creds, onUnauthorized ->
                BridgeApiClient(
                    credentials = creds,
                    allowDebugCleartext = true,
                    httpClient = BridgeApiClient.defaultClientBuilder()
                        .addInterceptor { chain ->
                            if (chain.request().url.encodedPath.endsWith("/v1/drafts")) draftCalls.incrementAndGet()
                            chain.proceed(chain.request())
                        }
                        .build(),
                    onUnauthorized = onUnauthorized,
                )
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
    }

    private fun snapshot(vararg lines: Pair<String, Long>) = NotificationSnapshot(
        packageName = "com.whatsapp",
        notificationKey = "0|com.whatsapp|1|dana|10",
        tag = null,
        postTimeMillis = lines.last().second,
        isGroupSummary = false,
        isGroupConversationFlag = false,
        conversationTitle = null,
        shortcutId = DANA_JID,
        title = "דנה",
        messages = lines.map { (t, ts) -> SnapshotMessage("דנה", t, ts, false) },
        hasReplyAction = true,
        isOngoing = false,
        category = "msg",
    )

    /** Runs the scheduler while real OkHttp threads finish (bounded by [realMillis]). */
    private fun TestScope.waitFor(realMillis: Long = 10_000, done: () -> Boolean) {
        val until = System.nanoTime() + realMillis * 1_000_000
        while (!done() && System.nanoTime() < until) {
            Thread.sleep(10)
            runCurrent()
        }
    }

    private fun DefaultAppController.only(): Draft = drafts.value.single()

    private fun closedPort(): Int = MockWebServer().run { start(); val p = port; shutdown(); p }

    @Test fun noInternet_connectionRefused_failedOnce_noRetry_statusUnreachable() = runTest {
        val c = controller("http://127.0.0.1:${closedPort()}")
        waitFor { c.status.value.backendReachable != null } // startup health check
        assertEquals(false, c.status.value.backendReachable)

        c.coordinator.onNotification(snapshot("היי, מתי נפגשים?" to 1_000L))
        advanceTimeBy(DEBOUNCE_MS); runCurrent()
        waitFor { c.only().state != DraftState.PROCESSING }

        assertEquals(DraftState.FAILED, c.only().state)
        assertEquals("נועה לא הצליחה להכין טיוטה — אין ניסיון חוזר אוטומטי", c.only().statusDetail)
        assertEquals(BridgeApiClient.MSG_UNAVAILABLE, c.status.value.lastErrorHebrew)
        assertEquals(false, c.status.value.backendReachable)
        assertEquals(1, draftCalls.get())

        advanceTimeBy(60 * 60 * 1000L); runCurrent()
        Thread.sleep(200); runCurrent()
        assertEquals("never retried automatically", 1, draftCalls.get())
    }

    @Test fun noInternet_connectionDropsMidRequest_noSilentOkHttpRetry() = runTest {
        val draftPosts = AtomicInteger(0)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                if (request.path == "/health") {
                    MockResponse().setBody("""{"ok":true,"enabled":true}""")
                } else {
                    if (request.path == "/v1/drafts") draftPosts.incrementAndGet()
                    MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST) // network dies mid-call
                }
        }
        server.start()
        val c = controller(server.url("/").toString().trimEnd('/'))
        c.coordinator.onNotification(snapshot("היי" to 1_000L))
        advanceTimeBy(DEBOUNCE_MS); runCurrent()
        waitFor { c.drafts.value.singleOrNull()?.state == DraftState.FAILED }

        assertEquals(DraftState.FAILED, c.only().state)
        assertEquals(BridgeApiClient.MSG_UNAVAILABLE, c.status.value.lastErrorHebrew)
        Thread.sleep(200); runCurrent()
        assertEquals("exactly one POST /v1/drafts reached the server (a resend would replay the nonce)", 1, draftPosts.get())
        assertEquals(1, draftCalls.get())
    }

    @Test fun serverCrash_502AndGarbageBody_failedWithoutRetry_thenRecoversOnNextMessage() = runTest {
        val bodies = java.util.concurrent.LinkedBlockingQueue<String>()
        val mode = AtomicInteger(0)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.path == "/health") return MockResponse().setBody("""{"ok":true,"enabled":true}""")
                val body = request.body.readUtf8()
                bodies += body
                val id = Regex("\"request_id\":\"([^\"]+)\"").find(body)!!.groupValues[1]
                return when (mode.getAndIncrement()) {
                    0 -> MockResponse().setResponseCode(502).setBody("""{"error":"engine_error","message":"x"}""")
                    1 -> MockResponse().setBody("<html>proxy error</html>")
                    else -> MockResponse().setBody(
                        """{"request_id":"$id","draft_text":"חזרנו לאוויר 🙂","safety":{"injection_suspected":false,"sensitive_request":false,"notes":[]},"engine":"stub"}""",
                    )
                }
            }
        }
        server.start()
        val c = controller(server.url("/").toString().trimEnd('/'))

        c.coordinator.onNotification(snapshot("היי" to 1_000L))
        advanceTimeBy(DEBOUNCE_MS); runCurrent()
        waitFor { c.drafts.value.lastOrNull()?.state == DraftState.FAILED }
        assertEquals(DraftState.FAILED, c.only().state)
        assertEquals(BridgeApiClient.MSG_UNAVAILABLE, c.status.value.lastErrorHebrew)

        c.coordinator.onNotification(snapshot("היי" to 1_000L, "?" to 30_000L))
        advanceTimeBy(DEBOUNCE_MS); runCurrent()
        waitFor { c.drafts.value.count { it.state == DraftState.FAILED } == 2 }
        assertEquals(BridgeApiClient.MSG_BAD_RESPONSE, c.status.value.lastErrorHebrew)

        c.coordinator.onNotification(snapshot("היי" to 1_000L, "?" to 30_000L, "את שם?" to 60_000L))
        advanceTimeBy(DEBOUNCE_MS); runCurrent()
        waitFor { c.drafts.value.any { it.state == DraftState.AWAITING_APPROVAL } }
        val ok = c.drafts.value.single { it.state == DraftState.AWAITING_APPROVAL }
        assertEquals("חזרנו לאוויר 🙂", ok.proposedText)
        assertEquals(true, c.status.value.backendReachable)
        assertEquals(3, draftCalls.get())
        assertEquals(3, bodies.size)
        // Every attempt is its own request id (a new draft) — never a silent resend of the same one.
        assertEquals(3, bodies.map { Regex("\"request_id\":\"([^\"]+)\"").find(it)!!.groupValues[1] }.toSet().size)
        // S-M4: the wire conversation_ref is the per-install HMAC of the local key, never the key itself.
        assertTrue(bodies.all { c.conversationRefOf(ConversationKeys.derive(snapshot("x" to 1L))!!) in it })
        assertFalse("the device token is a header, never in the body", bodies.any { "qa-token-not-real" in it })
    }
}
