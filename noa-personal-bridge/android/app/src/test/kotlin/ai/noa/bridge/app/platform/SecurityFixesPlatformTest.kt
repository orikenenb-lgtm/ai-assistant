package ai.noa.bridge.app.platform

import ai.noa.bridge.app.PairingResult
import ai.noa.bridge.app.ServerRevokeResult
import ai.noa.bridge.app.ui.pairing.PairingValidation
import ai.noa.bridge.core.BridgeCoordinator
import ai.noa.bridge.core.BridgeSettings
import ai.noa.bridge.core.Clock
import ai.noa.bridge.core.ConversationFilter
import ai.noa.bridge.core.ConversationKey
import ai.noa.bridge.core.ConversationKeys
import ai.noa.bridge.core.DraftEngineClient
import ai.noa.bridge.core.DraftRequest
import ai.noa.bridge.core.DraftResult
import ai.noa.bridge.core.DraftState
import ai.noa.bridge.core.FilterResult
import ai.noa.bridge.core.IncomingMessage
import ai.noa.bridge.core.NotificationSnapshot
import ai.noa.bridge.core.SafetyFlags
import ai.noa.bridge.core.SendOutcome
import ai.noa.bridge.core.SnapshotMessage
import android.app.Application
import android.app.RemoteInput
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/** Counts decrypts so tests can tell when keystore work happens (PERF-01). */
class CountingCipher(private val inner: SecretCipher = FakeCipher()) : SecretCipher by inner {
    @Volatile var decrypts = 0
    override fun decrypt(encoded: String): String? {
        decrypts++
        return inner.decrypt(encoded)
    }
}

/**
 * Regression tests for the Android findings of docs/noa-personal-bridge/SECURITY.md and the
 * performance findings of UX_PERFORMANCE_REVIEW.md (see the "Fix status" tables there).
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SecurityFixesPlatformTest {
    private val context: Application = ApplicationProvider.getApplicationContext()
    private val settingsStore = SettingsStore(context)
    private val registry = ReplyActionRegistry()
    private val server = MockWebServer()
    private var engine: DraftEngineClient? = null
    private val pin = "sha256/" + java.util.Base64.getEncoder().encodeToString(ByteArray(32) { it.toByte() })

    /** Status the fake server answers to POST /v1/devices/revoke. */
    private var revokeCode = 204

    @After
    fun tearDown() {
        runCatching { server.shutdown() }
    }

    /** Routes by path, so the startup health check can never take another call's response. */
    private fun startServer() {
        server.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
            override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest): MockResponse = when (request.path) {
                "/health" -> MockResponse().setBody("""{"ok":true,"enabled":true}""")
                "/v1/pair" -> MockResponse().setBody("""{"device_id":"dev_1","device_token":"tok-1"}""")
                "/v1/drafts" -> okDraft()
                "/v1/devices/revoke" -> MockResponse().setResponseCode(revokeCode)
                else -> MockResponse().setResponseCode(404)
            }
        }
        server.start()
    }

    private fun recorded(path: String): okhttp3.mockwebserver.RecordedRequest =
        generateSequence { server.takeRequest(5, TimeUnit.SECONDS) }.first { it.path == path }

    private fun TestScope.controller(
        secureStore: SecureStore = SecureStore(context, FakeCipher()),
        coordinator: FakeCoordinator = FakeCoordinator(),
        io: CoroutineDispatcher = UnconfinedTestDispatcher(testScheduler),
    ) = DefaultAppController(
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
        coordinatorFactory = { e, _, _ -> engine = e; coordinator },
        replyPathCompiledIn = true,
        allowDebugCleartext = true,
        debounceMillis = 15_000L,
        ioDispatcher = io,
        isDeviceLocked = { false },
        deviceName = "SM-S938B",
    )

    private fun request(key: ConversationKey) = DraftRequest(
        requestId = "11111111-2222-4333-8444-555555555555",
        conversationKey = key,
        senderDisplayName = "דנה",
        messages = listOf(IncomingMessage("e1", key, "דנה", "היי", 1_000L)),
    )

    private fun okDraft() = MockResponse().setBody(
        """{"request_id":"11111111-2222-4333-8444-555555555555","draft_text":"בסדר","engine":"stub"}""",
    )

    private fun pairedStore(url: String, cipher: SecretCipher = FakeCipher()) = SecureStore(context, cipher).apply {
        baseUrl = url
        deviceId = "dev_1"
        deviceToken = "tok-1"
    }

    // ================================================================== S-M4 conversation_ref

    /** Independent HMAC-SHA256 (RFC 2104 over SHA-256), not using javax.crypto.Mac. */
    private fun referenceHmac(secret: ByteArray, message: String): String {
        val block = ByteArray(64).also { secret.copyInto(it) }
        val inner = MessageDigest.getInstance("SHA-256").run {
            update(ByteArray(64) { (block[it].toInt() xor 0x36).toByte() })
            digest(message.toByteArray(Charsets.UTF_8))
        }
        val outer = MessageDigest.getInstance("SHA-256").run {
            update(ByteArray(64) { (block[it].toInt() xor 0x5c).toByte() })
            digest(inner)
        }
        return outer.joinToString("") { "%02x".format(it) }
    }

    @Test
    fun sM4_refIsTheHmacOfTheLocalKey_64Hex_neverTheKey_stable_andDiffersPerSecret() {
        val key = key('a')
        val secret1 = ByteArray(32) { 1 }
        val secret2 = ByteArray(32) { 2 }
        val ref = ConversationRefs.of(secret1, key)
        assertEquals(referenceHmac(secret1, key.value), ref)
        assertTrue(ref.matches(Regex("^[0-9a-f]{64}$")))
        assertNotEquals(key.value, ref)
        assertEquals("stable for the same conversation", ref, ConversationRefs.of(secret1, key))
        assertNotEquals("another install cannot link it", ref, ConversationRefs.of(secret2, key))
        assertNotEquals("another conversation", ref, ConversationRefs.of(secret1, key('b')))
    }

    @Test
    fun sM4_theWireRefIsTheHmacWithThePerInstallSecret_neverTheRawCoreKey() = runTest {
        startServer()
        val store = pairedStore(server.url("/").toString())
        val c = controller(secureStore = store)
        c.setCloudConsent(true)
        val coreKey = ConversationKeys.derive(waSnapshot("972501234567@s.whatsapp.net"))!!

        assertTrue(engine!!.requestDraft(request(coreKey)) is DraftResult.Success)
        val draftCall = recorded("/v1/drafts")
        val ref = Json.parseToJsonElement(draftCall.body.readUtf8()).jsonObject["conversation_ref"]!!.jsonPrimitive.content

        assertNotEquals(coreKey.value, ref)
        assertEquals(ConversationRefs.of(store.conversationRefSecret(), coreKey), ref)
        assertEquals(ref, c.conversationRefOf(coreKey))
    }

    @Test
    fun sM4_secretIsStoredEncryptedSurvivesARestartAndIsRegeneratedOnWipe() = runTest {
        val cipher = FakeCipher()
        val store = SecureStore(context, cipher)
        val first = store.conversationRefSecret()
        assertEquals(32, first.size)
        assertArrayEquals("stable across reads / processes", first, SecureStore(context, cipher).conversationRefSecret())
        val raw = context.getSharedPreferences(SecureStore.PREFS_NAME, Context.MODE_PRIVATE).all.values.joinToString()
        assertFalse(raw.contains(java.util.Base64.getEncoder().encodeToString(first)))

        val c = controller(secureStore = store)
        val before = c.conversationRefOf(key('a'))
        c.wipeLocalData()
        val after = c.conversationRefOf(key('a'))
        assertNotEquals("a wipe makes earlier refs unlinkable", before, after)
    }

    // ================================================================== S-M5 pinning

    @Test
    fun sM5_pinFormatValidation() {
        val b64 = pin.removePrefix("sha256/")
        assertEquals(pin, BridgeApiClient.normalizeSpkiPin(pin))
        assertEquals(pin, BridgeApiClient.normalizeSpkiPin("  SHA256/$b64 "))
        assertEquals(pin, BridgeApiClient.normalizeSpkiPin(b64))
        assertNull(BridgeApiClient.normalizeSpkiPin(""))
        assertNull(BridgeApiClient.normalizeSpkiPin("sha256/"))
        assertNull(BridgeApiClient.normalizeSpkiPin("sha256/not base64!"))
        assertNull("SHA-1 sized", BridgeApiClient.normalizeSpkiPin("sha256/" + java.util.Base64.getEncoder().encodeToString(ByteArray(20))))
        assertNull(BridgeApiClient.normalizeSpkiPin("sha1/$b64"))

        assertTrue("empty = no pinning", PairingValidation.isValidPin(""))
        assertTrue(PairingValidation.isValidPin(pin))
        assertFalse(PairingValidation.isValidPin("sha256/abc"))
        assertNull(PairingValidation.pinOrNull("  "))
    }

    @Test
    fun sM5_pinnerIsConfiguredForExactlyThatHostFromTheStoredPin() {
        val client = BridgeApiClient(credentials = { null }, allowDebugCleartext = false)
        val url = "https://bridge.example.com/".toHttpUrl()
        val pinned = client.clientFor(url, pin).certificatePinner.pins.single()
        assertEquals("bridge.example.com", pinned.pattern)
        assertEquals("sha256", pinned.hashAlgorithm)
        assertEquals(pin.removePrefix("sha256/"), pinned.hash.base64())
        assertTrue("no pin = system CAs only", client.clientFor(url, null).certificatePinner.pins.isEmpty())
        assertTrue(client.clientFor(url, "").certificatePinner.pins.isEmpty())
    }

    @Test
    fun sM5_pairStoresThePinEncryptedAndLaterCallsCarryIt() = runTest {
        startServer()
        val cipher = FakeCipher()
        val store = SecureStore(context, cipher)
        val c = controller(secureStore = store)
        assertEquals(PairingResult.Success, c.pair(server.url("/").toString(), "ABCD2345", pin.removePrefix("sha256/")))
        assertEquals(pin, store.certificatePin)
        val raw = context.getSharedPreferences(SecureStore.PREFS_NAME, Context.MODE_PRIVATE).all.values.joinToString()
        assertFalse("stored encrypted", raw.contains(pin))

        // A new process loads it with the credentials (so every call is pinned).
        var seen: ApiCredentials? = null
        DefaultAppController(
            context = context, scope = backgroundScope, secureStore = SecureStore(context, cipher), settingsStore = settingsStore,
            registry = registry, notifier = null, replySender = { _, _ -> SendOutcome.FAILED_NO_ACTION },
            apiClientFactory = { creds, _ -> BridgeApiClient(credentials = { creds().also { seen = it } }, allowDebugCleartext = true) },
            coordinatorFactory = { e, _, _ -> engine = e; FakeCoordinator() },
            replyPathCompiledIn = true, allowDebugCleartext = true, debounceMillis = 15_000L,
            ioDispatcher = UnconfinedTestDispatcher(testScheduler), isDeviceLocked = { false }, deviceName = "x",
        ).apply { setCloudConsent(true) }
        engine!!.requestDraft(request(key('a')))
        assertEquals(pin, seen?.spkiPin)

        // Disconnect forgets the pin too.
        c.disconnect()
        assertNull(store.certificatePin)
    }

    @Test
    fun sM5_invalidPinIsRejectedBeforeAnyNetworkCall() = runTest {
        server.start()
        val c = controller()
        val result = c.pair(server.url("/").toString(), "ABCD2345", "sha256/too-short")
        assertEquals(PairingResult.Failure(BridgeApiClient.MSG_BAD_PIN), result)
        assertEquals(0, server.requestCount)
    }

    // ================================================================== S-L5 honest disconnect / wipe

    @Test
    fun sL5_disconnectReportsConfirmedOnlyWhenTheServerAnswered2xx() = runTest {
        startServer()
        val store = pairedStore(server.url("/").toString())
        val c = controller(secureStore = store)
        assertEquals(ServerRevokeResult.CONFIRMED, c.disconnect())
        assertNull(c.status.value.lastErrorHebrew)
        assertNull(store.deviceToken)
        assertEquals(ServerRevokeResult.NOT_PAIRED, c.disconnect())
    }

    @Test
    fun sL5_failedRevokeStillDisconnectsLocallyButSaysSoHonestly() = runTest {
        revokeCode = 500
        startServer()
        val store = pairedStore(server.url("/").toString())
        val c = controller(secureStore = store)
        assertEquals(ServerRevokeResult.NOT_CONFIRMED, c.disconnect())
        assertEquals(DefaultAppController.MSG_REVOKE_NOT_CONFIRMED, c.status.value.lastErrorHebrew)
        assertTrue(c.status.value.lastErrorHebrew!!.startsWith("הניתוק המקומי בוצע, אבל השרת לא אישר את הביטול"))
        assertTrue(c.status.value.lastErrorHebrew!!.contains("revoke-device"))
        assertNull("forgotten locally anyway", store.deviceToken)
        assertFalse(c.status.value.paired)
    }

    @Test
    fun sL5_unreachableServerOnDisconnectIsNotConfirmed() = runTest {
        val port = MockWebServer().run { start(); val p = port; shutdown(); p }
        val c = controller(secureStore = pairedStore("http://127.0.0.1:$port/"))
        assertEquals(ServerRevokeResult.NOT_CONFIRMED, c.disconnect())
        assertEquals(DefaultAppController.MSG_REVOKE_NOT_CONFIRMED, c.status.value.lastErrorHebrew)
    }

    @Test
    fun sL5_wipeRevokesOnTheServerFirstThenWipes() = runTest {
        startServer()
        val cipher = FakeCipher()
        val coordinator = FakeCoordinator()
        val c = controller(secureStore = pairedStore(server.url("/").toString(), cipher), coordinator = coordinator)
        assertEquals(ServerRevokeResult.CONFIRMED, c.wipeLocalData())
        val revoke = recorded("/v1/devices/revoke")
        assertEquals("Bearer tok-1", revoke.getHeader("Authorization"))
        assertTrue(cipher.destroyed)
        assertTrue("clearAll" in coordinator.calls)
        assertNull(c.status.value.lastErrorHebrew)
    }

    @Test
    fun sL5_wipeWithAFailedRevokeStillWipesAndSaysSo() = runTest {
        revokeCode = 503
        startServer()
        val cipher = FakeCipher()
        val c = controller(secureStore = pairedStore(server.url("/").toString(), cipher))
        assertEquals(ServerRevokeResult.NOT_CONFIRMED, c.wipeLocalData())
        assertTrue(cipher.destroyed)
        assertEquals(DefaultAppController.MSG_REVOKE_NOT_CONFIRMED, c.status.value.lastErrorHebrew)
    }

    @Test
    fun sL5_wipeWhenNotPairedMakesNoServerCall() = runTest {
        server.start()
        val c = controller()
        assertEquals(ServerRevokeResult.NOT_PAIRED, c.wipeLocalData())
        assertEquals(0, server.requestCount)
    }

    // ================================================================== S-M1 hidden update (app side)

    private fun replyAction() = ReplyAction(
        mutablePendingIntent(context),
        arrayOf(RemoteInput.Builder("reply_text").build()),
        isSemanticReply = true,
    )

    private fun waSnapshot(
        jid: String,
        vararg lines: Pair<String, Long>,
        title: String = "דנה",
        sender: String = "דנה",
    ) = NotificationSnapshot(
        packageName = "com.whatsapp",
        notificationKey = "0|com.whatsapp|1|$jid|10",
        tag = jid,
        postTimeMillis = lines.maxOfOrNull { it.second } ?: 1L,
        isGroupSummary = false,
        isGroupConversationFlag = false,
        conversationTitle = null,
        shortcutId = jid,
        title = title,
        messages = lines.map { (t, ts) -> SnapshotMessage(sender, t, ts, false) },
        hasReplyAction = true,
        isOngoing = false,
        category = "msg",
    )

    private class RecordingEngine : DraftEngineClient {
        val requests = mutableListOf<DraftRequest>()
        override suspend fun requestDraft(request: DraftRequest): DraftResult {
            requests += request
            return DraftResult.Success("בשמונה מתאים לי", SafetyFlags(), "fake")
        }
    }

    /** Production wiring (as in PlatformGraph) with a real coordinator on virtual time. */
    private class Pipeline(test: TestScope, registry: ReplyActionRegistry) {
        val engine = RecordingEngine()
        private val settings = BridgeSettings(cloudConsentGiven = true, sendingEnabled = true)
        private val filter = ConversationFilter.create()
        val coordinator = BridgeCoordinator.create(
            test.backgroundScope, Clock { test.testScheduler.currentTime }, engine, { _, _ -> SendOutcome.ATTEMPTED }, settings,
        )
        val ingestor = NotificationIngestor(
            registry = registry,
            onNotification = coordinator::onNotification,
            onConversationRemoved = coordinator::onNotificationRemoved,
            wouldAccept = { filter.evaluate(it, settings) is FilterResult.Accepted },
            onSeed = coordinator::seedSeen,
        )
    }

    @Test
    fun sM1_redactedUpdateRemovesTheOlderHandleAndExpiresTheDraft() = runTest {
        val p = Pipeline(this, registry)
        val jid = "972501234567@s.whatsapp.net"
        val readable = waSnapshot(jid, "מתי נפגשים?" to 1_000L)
        p.ingestor.onPosted(MappedNotification(readable, replyAction()))
        advanceTimeBy(15_001); runCurrent()
        val key = ConversationKeys.derive(readable)!!
        assertNotNull(registry.get(key))
        assertEquals(DraftState.AWAITING_APPROVAL, p.coordinator.drafts.value.single().state)

        // Same slot, now redacted by Android 15 (the Reply action is still there).
        val redacted = waSnapshot(jid, "Sensitive notification content hidden" to 2_000L, title = "WhatsApp", sender = "WhatsApp")
        p.ingestor.onPosted(MappedNotification(redacted, replyAction(), isLikelyRedacted = true))

        assertNull("the older handle is removed, not kept", registry.get(key))
        val d = p.coordinator.drafts.value.single()
        assertEquals(DraftState.EXPIRED, d.state)
        assertEquals("התקבלה הודעה שלא ניתן לקרוא — הטיוטה בוטלה", d.statusDetail)
    }

    @Test
    fun sM1_placeholderUpdateRemovesTheHandleEvenWithoutTheMapperFlag() = runTest {
        val p = Pipeline(this, registry)
        val jid = "972501234567@s.whatsapp.net"
        p.ingestor.onPosted(MappedNotification(waSnapshot(jid, "היי" to 1_000L), replyAction()))
        advanceTimeBy(15_001); runCurrent()
        val key = ConversationKeys.derive(waSnapshot(jid))!!
        assertNotNull(registry.get(key))

        p.ingestor.onPosted(MappedNotification(waSnapshot(jid, "2 הודעות חדשות" to 2_000L), replyAction()))
        assertNull(registry.get(key))
        assertEquals(DraftState.EXPIRED, p.coordinator.drafts.value.single().state)
    }

    @Test
    fun sM1_hiddenUpdateOfAnotherChatKeepsThisChatsHandle() = runTest {
        val p = Pipeline(this, registry)
        val dana = "972501234567@s.whatsapp.net"
        val yossi = "972509999999@s.whatsapp.net"
        p.ingestor.onPosted(MappedNotification(waSnapshot(dana, "היי" to 1_000L), replyAction()))
        p.ingestor.onPosted(MappedNotification(waSnapshot(yossi, "2 new messages" to 2_000L), replyAction()))
        assertNotNull(registry.get(ConversationKeys.derive(waSnapshot(dana))!!))
    }

    // ================================================================== S-L7 dedup seeding on (re)connect

    @Test
    fun sL7_rebuildSeedsTheDedupSoOldUnreadLinesAreNotSentAgainAfterARestart() = runTest {
        val p = Pipeline(this, registry) // a fresh process
        val jid = "972501234567@s.whatsapp.net"
        val showing = waSnapshot(jid, "שורה ישנה שלא נקראה" to 1_000L)
        p.ingestor.rebuildFrom(listOf(MappedNotification(showing, replyAction())))
        assertTrue(p.coordinator.drafts.value.isEmpty())

        // The next real message re-posts the whole MessagingStyle history.
        p.ingestor.onPosted(MappedNotification(waSnapshot(jid, "שורה ישנה שלא נקראה" to 1_000L, "חדש" to 5_000L), replyAction()))
        advanceTimeBy(15_001); runCurrent()
        assertEquals(listOf("חדש"), p.engine.requests.single().messages.map { it.text })
    }

    @Test
    fun sL7_rebuildHandsEverySnapshotToTheSeedCallback() {
        val seeded = mutableListOf<NotificationSnapshot>()
        val ingestor = NotificationIngestor(registry, {}, {}, onSeed = { seeded += it })
        val a = snapshot(notificationKey = "n1", tag = "a")
        val b = snapshot(notificationKey = "n2", tag = "b")
        ingestor.rebuildFrom(listOf(MappedNotification(a, replyAction()), MappedNotification(b, null, isLikelyRedacted = true)))
        assertEquals(listOf(a, b), seeded)
    }

    // ================================================================== PERF-01 / PERF-02

    @Test
    fun perf01_keystoreReadsHappenOnTheIoDispatcherNotInTheConstructor_andTheCoordinatorIsPausedUntilLoaded() = runTest {
        val cipher = CountingCipher()
        val store = SecureStore(context, cipher).apply {
            baseUrl = "http://127.0.0.1:1/" // the startup health check fails fast, never leaves the host
            deviceToken = "t"
            setExclusions(listOf(ai.noa.bridge.app.ExclusionEntry(key('x').value, "אמא")))
        }
        cipher.decrypts = 0
        val io = StandardTestDispatcher(testScheduler)
        val coordinator = FakeCoordinator()
        var initial: BridgeSettings? = null
        val c = DefaultAppController(
            context = context, scope = backgroundScope, secureStore = store, settingsStore = settingsStore,
            registry = registry, notifier = null, replySender = { _, _ -> SendOutcome.FAILED_NO_ACTION },
            apiClientFactory = { creds, _ -> BridgeApiClient(credentials = creds, allowDebugCleartext = true) },
            coordinatorFactory = { _, _, s -> initial = s; coordinator },
            replyPathCompiledIn = true, allowDebugCleartext = true, debounceMillis = 15_000L,
            ioDispatcher = io, isDeviceLocked = { false }, deviceName = "x",
        )
        assertEquals("no keystore work on the constructing (main) thread", 0, cipher.decrypts)
        assertTrue("fail closed until exclusions are known", initial!!.paused)
        assertFalse(c.status.value.paired)

        runCurrent() // the IO work runs
        assertTrue(cipher.decrypts > 0)
        assertTrue(c.status.value.paired)
        assertEquals(setOf(key('x')), c.settings.value.excludedConversations)
        val last = coordinator.lastSettings!!
        assertFalse("unpaused once loaded", last.paused)
        assertEquals(setOf(key('x')), last.excludedConversations)
    }

    @Test
    fun perf02_settingsAndExclusionWritesRunOnTheIoDispatcherAndKeepTheNewestValue() = runTest {
        val io = StandardTestDispatcher(testScheduler)
        val cipher = CountingCipher()
        val store = SecureStore(context, cipher)
        val c = controller(secureStore = store, io = io)
        runCurrent()
        c.setPaused(true)
        c.setPaused(false)
        c.setCloudConsent(true)
        assertTrue("in memory at once", c.settings.value.cloudConsentGiven)
        assertFalse("not yet written on the caller's thread", settingsStore.load(emptySet(), 15_000L).cloudConsentGiven)
        runCurrent()
        val stored = settingsStore.load(emptySet(), 15_000L)
        assertTrue(stored.cloudConsentGiven)
        assertFalse("newest value wins", stored.paused)

        c.removeExclusion("nothing") // persists an (empty) list through the keystore
        assertNull("encryption + commit not on the caller's thread", context.getSharedPreferences(SecureStore.PREFS_NAME, 0).getString("exclusions", null))
        runCurrent()
        assertNotNull(context.getSharedPreferences(SecureStore.PREFS_NAME, 0).getString("exclusions", null))
    }

    // ================================================================== S-L6

    @Test
    fun sL6_ourNotificationNeverContainsTheSenderName() {
        org.robolectric.Shadows.shadowOf(context).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
        val nm = context.getSystemService(android.app.NotificationManager::class.java)
        DraftNotifier(context).onDrafts(listOf(draft("d1", key('a'), DraftState.AWAITING_APPROVAL, sender = "יוסי לוי")))
        val n = org.robolectric.Shadows.shadowOf(nm).allNotifications.single()
        val all = listOf(n.extras, n.publicVersion.extras).flatMap { e -> e.keySet().map { e.get(it)?.toString().orEmpty() } }
        assertTrue(all.none { "יוסי" in it })
        assertEquals("טיוטה מוכנה לאישור", n.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString())
        assertEquals("יש טיוטה חדשה שממתינה לאישורך", n.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString())
        assertEquals("טיוטה מוכנה לאישור", n.publicVersion.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString())
        assertEquals("יש טיוטה חדשה שממתינה לאישורך", n.publicVersion.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString())
    }

    // ================================================================== QA-03

    @Test
    fun qa03_truncationNeverSplitsSurrogatesOrZwjSequences() {
        val family = "\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67" // 3 people joined by ZWJ: 8 UTF-16 units, one grapheme
        val cut = BridgeApiClient.truncateText("ab$family", 6)
        assertEquals("ab", cut)
        assertEquals("a😀", BridgeApiClient.truncateText("a😀b", 3))
        assertEquals("a", BridgeApiClient.truncateText("a😀b", 2))
        assertEquals("short", BridgeApiClient.truncateText("short", 80))
        val name = "א".repeat(79) + "😀"
        assertEquals("א".repeat(79), BridgeApiClient.truncateText(name, 80))
    }
}
