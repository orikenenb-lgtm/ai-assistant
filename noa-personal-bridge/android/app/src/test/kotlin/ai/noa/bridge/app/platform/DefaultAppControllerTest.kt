package ai.noa.bridge.app.platform

import ai.noa.bridge.app.ExclusionEntry
import ai.noa.bridge.app.PairingResult
import ai.noa.bridge.core.BridgeSettings
import ai.noa.bridge.core.ConversationKey
import ai.noa.bridge.core.DraftEngineClient
import ai.noa.bridge.core.DraftRequest
import ai.noa.bridge.core.DraftResult
import ai.noa.bridge.core.DraftState
import ai.noa.bridge.core.IncomingMessage
import android.app.Application
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class DefaultAppControllerTest {
    private val context: Application = ApplicationProvider.getApplicationContext()
    private val cipher = FakeCipher()
    private val secureStore = SecureStore(context, cipher)
    private val settingsStore = SettingsStore(context)
    private val registry = ReplyActionRegistry()
    private val coordinator = FakeCoordinator()
    private var engine: DraftEngineClient? = null
    private var locked = false
    private val server = MockWebServer()

    @After
    fun tearDown() = server.shutdown()

    private fun TestScope.controller(compiledIn: Boolean = true, scope: CoroutineScope = backgroundScope) = DefaultAppController(
        context = context,
        scope = scope,
        secureStore = secureStore,
        settingsStore = settingsStore,
        registry = registry,
        notifier = null,
        replySender = { _, _ -> error("tests never send") },
        apiClientFactory = { creds, onUnauthorized ->
            BridgeApiClient(credentials = creds, allowDebugCleartext = true, onUnauthorized = onUnauthorized)
        },
        coordinatorFactory = { e, _, _ -> engine = e; coordinator },
        replyPathCompiledIn = compiledIn,
        allowDebugCleartext = true,
        debounceMillis = 15_000L,
        ioDispatcher = UnconfinedTestDispatcher(testScheduler),
        isDeviceLocked = { locked },
        deviceName = "SM-S938B",
    )

    @Test
    fun sendRefusedWhileDeviceLocked() = runTest {
        val k = key('a')
        coordinator.draftsFlow.value = listOf(draft("d1", k, DraftState.APPROVED))
        val c = controller()
        c.setSendingEnabled(true)
        locked = true
        assertEquals(DraftState.APPROVED, c.sendApproved(approval("d1", k)))
        assertFalse(coordinator.calls.any { it.startsWith("sendApproved") })
        assertEquals(DefaultAppController.MSG_LOCKED, c.status.value.lastErrorHebrew)
        assertTrue(c.status.value.deviceLocked)
    }

    @Test
    fun sendRefusedWhenReplyPathNotCompiledIn() = runTest {
        val k = key('a')
        coordinator.draftsFlow.value = listOf(draft("d1", k, DraftState.APPROVED))
        val c = controller(compiledIn = false)
        c.setSendingEnabled(true)
        assertFalse(c.settings.value.sendingEnabled)
        assertEquals(DraftState.APPROVED, c.sendApproved(approval("d1", k)))
        assertFalse(coordinator.calls.any { it.startsWith("sendApproved") })
    }

    @Test
    fun sendRefusedWhenToggleOffAndDelegatesWhenAllowed() = runTest {
        val k = key('a')
        coordinator.draftsFlow.value = listOf(draft("d1", k, DraftState.APPROVED))
        val c = controller()
        assertEquals(DraftState.APPROVED, c.sendApproved(approval("d1", k)))
        assertFalse(coordinator.calls.any { it.startsWith("sendApproved") })

        c.setSendingEnabled(true)
        assertEquals(DraftState.SEND_ATTEMPTED, c.sendApproved(approval("d1", k)))
        assertEquals(1, coordinator.calls.count { it == "sendApproved:d1" })
    }

    @Test
    fun emergencyStopPersistsAndDisablesSending() = runTest {
        val c = controller()
        c.setSendingEnabled(true)
        registry.put(key('a'), ReplyHandle(mutablePendingIntent(context), emptyArray(), "n", 1))
        c.emergencyStop()
        assertTrue("emergencyStop" in coordinator.calls)
        assertTrue(c.settings.value.emergencyStopped)
        assertFalse(c.settings.value.sendingEnabled)
        assertEquals(0, registry.size)
        val persisted = settingsStore.load(emptySet(), 15_000L)
        assertTrue(persisted.emergencyStopped)
        assertFalse(persisted.sendingEnabled)
        assertTrue(coordinator.lastSettings!!.emergencyStopped)

        c.resumeAfterEmergencyStop()
        assertFalse(settingsStore.load(emptySet(), 15_000L).emergencyStopped)
        assertFalse(c.settings.value.sendingEnabled) // must be re-enabled explicitly
    }

    @Test
    fun settingsSurviveRestart() = runTest {
        controller().apply { setPaused(true); setCloudConsent(true) }
        val restarted = controller()
        assertTrue(restarted.settings.value.paused)
        assertTrue(restarted.settings.value.cloudConsentGiven)
        assertEquals(15_000L, restarted.settings.value.debounceMillis)
    }

    @Test
    fun excludeConversationStoresEncryptedEntryAndCancelsItsDrafts() = runTest {
        val k = key('a')
        coordinator.draftsFlow.value = listOf(
            draft("d1", k, DraftState.AWAITING_APPROVAL, sender = "דנה"),
            draft("d2", k, DraftState.DEBOUNCING, sender = "דנה"),
            draft("d3", key('b'), DraftState.AWAITING_APPROVAL, sender = "יוסי"),
            draft("d4", k, DraftState.CANCELLED, sender = "דנה"),
        )
        val c = controller()
        c.excludeConversationOf("d1")

        assertEquals(listOf(ExclusionEntry(k.value, "דנה")), c.exclusions.value)
        assertEquals(setOf(k), c.settings.value.excludedConversations)
        assertEquals(setOf(k), coordinator.lastSettings!!.excludedConversations)
        assertTrue("cancel:d1" in coordinator.calls && "cancel:d2" in coordinator.calls)
        assertFalse("cancel:d3" in coordinator.calls || "cancel:d4" in coordinator.calls)
        assertEquals(listOf(ExclusionEntry(k.value, "דנה")), secureStore.exclusions())

        // Survives restart, then can be removed.
        val restarted = controller()
        assertEquals(setOf(k), restarted.settings.value.excludedConversations)
        restarted.removeExclusion(k.value)
        assertTrue(restarted.exclusions.value.isEmpty())
        assertTrue(restarted.settings.value.excludedConversations.isEmpty())
    }

    @Test
    fun engineRefusesWithoutCloudConsent() = runTest {
        val c = controller()
        val request = DraftRequest(
            "11111111-2222-4333-8444-555555555555",
            ConversationKey("ab".repeat(32)),
            "דנה",
            listOf(IncomingMessage("e", ConversationKey("ab".repeat(32)), "דנה", "היי", 1L)),
        )
        val result = engine!!.requestDraft(request) as DraftResult.Failure
        assertEquals(DefaultAppController.MSG_NO_CONSENT, result.reason)
        assertFalse(c.settings.value.cloudConsentGiven)
    }

    @Test
    fun pairValidatesStoresTokenAndDisconnectForgetsIt() = runTest {
        val c = controller()
        assertTrue(c.pair("http://bridge.example.com", "ABCD2345") is PairingResult.Failure)
        assertTrue(c.pair("https://bridge.example.com", "short") is PairingResult.Failure)

        server.enqueue(MockResponse().setBody("""{"device_id":"dev_1","device_token":"tok-1"}"""))
        server.enqueue(MockResponse().setBody("""{"ok":true,"enabled":true,"engine":"stub","version":"0.1.0"}"""))
        server.start()
        val url = server.url("/").toString()
        assertEquals(PairingResult.Success, c.pair(url, "abcd 2345"))
        assertEquals("tok-1", secureStore.deviceToken)
        assertEquals(url, secureStore.baseUrl)
        assertTrue(c.status.value.paired)

        server.enqueue(MockResponse().setResponseCode(204))
        c.disconnect()
        assertNull(secureStore.deviceToken)
        assertFalse(c.status.value.paired)
    }

    @Test
    fun wipeLocalDataClearsEverything() = runTest {
        secureStore.deviceToken = "t"
        secureStore.baseUrl = "https://bridge.example.com/"
        val c = controller()
        assertTrue(c.status.value.paired)
        c.setPaused(true)
        registry.put(key('a'), ReplyHandle(mutablePendingIntent(context), emptyArray(), "n", 1))
        c.wipeLocalData()
        assertTrue("clearAll" in coordinator.calls)
        assertTrue(cipher.destroyed)
        assertNull(secureStore.deviceToken)
        assertEquals(0, registry.size)
        assertFalse(c.status.value.paired)
        assertEquals(BridgeSettings(debounceMillis = 15_000L), c.settings.value)
        assertFalse(settingsStore.load(emptySet(), 15_000L).paused)
    }

    @Test
    fun refreshPermissionsReportsMissingAccess() = runTest {
        val c = controller()
        c.refreshPermissions()
        assertFalse(c.status.value.notificationAccessGranted)
        assertFalse(c.status.value.paired)
    }
}
