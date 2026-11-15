package ai.noa.bridge.app.platform

import ai.noa.bridge.app.ExclusionEntry
import ai.noa.bridge.core.BridgeSettings
import ai.noa.bridge.core.ConversationFilter
import ai.noa.bridge.core.FilterResult
import ai.noa.bridge.core.RejectReason
import android.app.Application
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.security.KeyStoreException
import java.security.ProviderException

/** Cipher whose every operation fails the way AndroidKeyStore can (L-6). */
class ThrowingCipher(private val error: () -> Throwable) : SecretCipher {
    override fun encrypt(plaintext: String): String = throw error()
    override fun decrypt(encoded: String): String? = throw error()
    override fun destroyKey() = Unit
}

/** Regression tests for the platform findings of docs/noa-personal-bridge/CODE_REVIEW.md. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class ReviewFixesPlatformTest {
    private val context: Application = ApplicationProvider.getApplicationContext()
    private val settingsStore = SettingsStore(context)
    private val registry = ReplyActionRegistry()
    private val coordinator = FakeCoordinator()
    private var locked = false

    private fun TestScope.controller(secureStore: SecureStore = SecureStore(context, FakeCipher())) = DefaultAppController(
        context = context,
        scope = backgroundScope,
        secureStore = secureStore,
        settingsStore = settingsStore,
        registry = registry,
        notifier = null,
        replySender = { _, _ -> error("tests never send") },
        apiClientFactory = { creds, onUnauthorized ->
            BridgeApiClient(credentials = creds, allowDebugCleartext = true, onUnauthorized = onUnauthorized)
        },
        coordinatorFactory = { _, _, _ -> coordinator },
        replyPathCompiledIn = true,
        allowDebugCleartext = true,
        debounceMillis = 15_000L,
        ioDispatcher = UnconfinedTestDispatcher(testScheduler),
        isDeviceLocked = { locked },
        deviceName = "SM-S938B",
    )

    // ---------------------------------------------------------------- L-2: the controller's send gate

    @Test
    fun l2_sendGateIsClosedWhenStoppedPausedDisabledOrLocked() = runTest {
        val c = controller()
        assertFalse("sending toggle off", c.canSendNow())
        c.setSendingEnabled(true)
        assertTrue(c.canSendNow())

        locked = true
        assertFalse("device locked", c.canSendNow())
        locked = false

        c.setPaused(true)
        assertFalse("paused", c.canSendNow())
        c.setPaused(false)
        assertTrue(c.canSendNow())

        c.emergencyStop()
        assertFalse("emergency stop", c.canSendNow())
        c.resumeAfterEmergencyStop()
        assertFalse("emergency stop also turned the toggle off", c.canSendNow())
    }

    // ---------------------------------------------------------------- L-6: keystore failures

    @Test
    fun l6_keystoreFailuresOnReadCountAsAbsentAndNeverThrow() {
        listOf<() -> Throwable>(
            { ProviderException("keystore daemon") },
            { KeyStoreException("ks") },
            { IllegalStateException("x") },
            { IllegalArgumentException("x") },
            { RuntimeException("x") },
        ).forEach { error ->
            // A value exists on disk (written with a working cipher)...
            SecureStore(context, FakeCipher()).apply {
                deviceToken = "tok"
                baseUrl = "https://bridge.example.com/"
                setExclusions(listOf(ExclusionEntry("a".repeat(64), "דנה")))
            }
            // ...but the keystore now fails: absent, not a crash.
            val broken = SecureStore(context, ThrowingCipher(error))
            assertNull(broken.deviceToken)
            assertNull(broken.baseUrl)
            assertEquals(emptyList<ExclusionEntry>(), broken.exclusions())
        }
    }

    @Test
    fun l6_keystoreFailureOnWriteDoesNotThrowAndStoresNothing() {
        val broken = SecureStore(context, ThrowingCipher { ProviderException("x") })
        broken.deviceToken = "tok"
        broken.setExclusions(listOf(ExclusionEntry("a".repeat(64), "דנה")))
        assertNull(SecureStore(context, FakeCipher()).deviceToken)
        assertTrue(SecureStore(context, FakeCipher()).exclusions().isEmpty())
    }

    @Test
    fun l6_controllerBuiltOnABrokenKeystoreStartsUnpairedInsteadOfCrashing() = runTest {
        SecureStore(context, FakeCipher()).apply {
            deviceToken = "tok"
            baseUrl = "https://bridge.example.com/"
        }
        val c = controller(SecureStore(context, ThrowingCipher { ProviderException("invalidated key") }))
        assertFalse(c.status.value.paired)
        c.setSendingEnabled(true) // persists settings; no secure-store crash either
        assertTrue(c.settings.value.sendingEnabled)
    }

    @Test
    fun l6_keystoreCipherNeverThrowsFromDecrypt() {
        // AndroidKeyStore does not exist on Robolectric: every keystore call fails.
        val cipher = KeystoreCipher("test_alias")
        assertNull(cipher.decrypt("not base64 !!"))
        assertNull(cipher.decrypt("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"))
    }

    // ---------------------------------------------------------------- L-5: one detector for both layers

    @Test
    fun l5_mapperAndCoreFilterAgreeOnHiddenContent() {
        val me = Person.Builder().setName("אני").setKey("me").build()
        val dana = Person.Builder().setName("דנה").setKey("dana").build()
        val filter = ConversationFilter.create()
        val settings = BridgeSettings(cloudConsentGiven = true)
        listOf(
            "Content hidden" to true,
            "התוכן הוסתר" to true,
            "Sensitive notification content hidden" to true,
            "‏תוכן ההתראה הרגיש הוסתר" to true,
            "היי, מה נשמע?" to false,
        ).forEach { (text, hidden) ->
            val n = NotificationCompat.Builder(context, "test")
                .setSmallIcon(android.R.drawable.sym_action_chat)
                .setContentTitle("דנה")
                .setStyle(NotificationCompat.MessagingStyle(me).addMessage(text, 1_000L, dana))
                .setShortcutId("972501112222@s.whatsapp.net")
                .addAction(
                    NotificationCompat.Action.Builder(0, "Reply", mutablePendingIntent(context))
                        .addRemoteInput(RemoteInput.Builder("reply_text").build()).build(),
                )
                .build()
            val mapped = NotificationMapper.map(n, "com.whatsapp", "k", null, 1L)
            val rejectedHidden = (filter.evaluate(mapped.snapshot, settings) as? FilterResult.Rejected)?.reason ==
                RejectReason.HIDDEN_CONTENT
            assertEquals("mapper: $text", hidden, mapped.isLikelyRedacted)
            assertEquals("core: $text", hidden, rejectedHidden)

            // And the ingestor keeps no reply handle for it.
            val reg = ReplyActionRegistry()
            NotificationIngestor(reg, {}, {}).registerReplyAction(mapped)
            assertEquals("ingestor: $text", if (hidden) 0 else 1, reg.size)
        }
    }
}
