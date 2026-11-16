package ai.noa.bridge.app.platform

import ai.noa.bridge.app.MainActivity
import ai.noa.bridge.app.OpenInWhatsAppActivity
import ai.noa.bridge.app.OpenInWhatsAppResult
import ai.noa.bridge.app.ui.preview.FakeAppController
import ai.noa.bridge.core.DraftState
import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog

/**
 * D-020 "פתח ב-WhatsApp עם הטיוטה": phone extraction, the click-to-chat intent, the controller's
 * rules and fallbacks, our notification's tap target and the no-UI activity.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class OpenInWhatsAppTest {
    private val context: Application = ApplicationProvider.getApplicationContext()
    private val registry = ReplyActionRegistry()
    private val coordinator = FakeCoordinator()
    private val clipboard = context.getSystemService(ClipboardManager::class.java)

    private val phone = "972501112222"
    private val jid = "$phone@s.whatsapp.net"
    private val lid = "123456789012345@lid"
    private val group = "120363025555555555@g.us"

    @After
    fun tearDown() {
        OpenInWhatsAppActivity.controllerForTests = null
    }

    private fun TestScope.controller() = DefaultAppController(
        context = context,
        scope = backgroundScope,
        secureStore = SecureStore(context, FakeCipher()),
        settingsStore = SettingsStore(context),
        registry = registry,
        notifier = null,
        replySender = { _, _ -> error("opening in WhatsApp never sends") },
        apiClientFactory = { creds, onUnauthorized ->
            BridgeApiClient(credentials = creds, allowDebugCleartext = true, onUnauthorized = onUnauthorized)
        },
        coordinatorFactory = { _, _, _ -> coordinator },
        replyPathCompiledIn = true,
        allowDebugCleartext = true,
        debounceMillis = 15_000L,
        ioDispatcher = UnconfinedTestDispatcher(testScheduler),
        isDeviceLocked = { false },
        deviceName = "SM-S938B",
    )

    /** A PendingIntent like WhatsApp's contentIntent: opens "the chat" (an activity intent). */
    private fun chatContentIntent(): PendingIntent = PendingIntent.getActivity(
        context,
        7,
        Intent(OPEN_CHAT_ACTION).setPackage(context.packageName),
        PendingIntent.FLAG_IMMUTABLE,
    )

    private fun target(phoneDigits: String?, contentIntent: PendingIntent?, notificationKey: String = "n1") =
        ChatTarget(phoneDigits, contentIntent, notificationKey, postTimeMillis = 1_000L)

    private fun nextStarted(): Intent? = shadowOf(context).nextStartedActivity

    private fun clipText(): String? = clipboard.primaryClip?.getItemAt(0)?.text?.toString()

    // ---------------------------------------------------------------- phone extraction

    @Test
    fun phoneDigitsOnlyFromAPhoneJidInShortcutIdOrTag() {
        assertEquals(phone, WhatsAppChatIds.phoneDigits(jid, null))
        assertEquals(phone, WhatsAppChatIds.phoneDigits(null, jid))
        assertEquals("shortcutId wins", phone, WhatsAppChatIds.phoneDigits(jid, "972509999999@s.whatsapp.net"))
        assertEquals("falls back to the tag", phone, WhatsAppChatIds.phoneDigits(lid, jid))
        assertEquals(phone, WhatsAppChatIds.phoneDigits(" $jid ", null))
    }

    @Test
    fun noPhoneForLidGroupsBroadcastsOrMalformedIds() {
        assertNull("@lid ids are never converted to a phone number", WhatsAppChatIds.phoneDigits(lid, null))
        assertNull(WhatsAppChatIds.phoneDigits(null, lid))
        assertNull(WhatsAppChatIds.phoneDigits(group, group))
        assertNull(WhatsAppChatIds.phoneDigits("status@broadcast", null))
        assertNull(WhatsAppChatIds.phoneDigits("120363000000000000@newsletter", null))
        assertNull(WhatsAppChatIds.phoneDigits("+972501112222@s.whatsapp.net", null))
        assertNull(WhatsAppChatIds.phoneDigits("abc972501112222@s.whatsapp.net", null))
        assertNull(WhatsAppChatIds.phoneDigits("972501112222@s.whatsapp.net.evil", null))
        assertNull("longer than E.164", WhatsAppChatIds.phoneDigits("1234567890123456@s.whatsapp.net", null))
        assertNull(WhatsAppChatIds.phoneDigits("123@s.whatsapp.net", null))
        assertNull(WhatsAppChatIds.phoneDigits("dana", "דנה"))
        assertNull(WhatsAppChatIds.phoneDigits(null, null))
    }

    @Test
    fun mapperKeepsContentIntentAndPhoneButNeverPrintsThem() {
        val me = Person.Builder().setName("אני").setKey("me").build()
        val dana = Person.Builder().setName("דנה").setKey("dana").build()
        val contentIntent = chatContentIntent()
        fun build(shortcutId: String) = NotificationCompat.Builder(context, "test")
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setStyle(NotificationCompat.MessagingStyle(me).addMessage("היי", 1_000L, dana))
            .setShortcutId(shortcutId)
            .setContentIntent(contentIntent)
            .build()

        val mapped = NotificationMapper.map(build(jid), "com.whatsapp", "k", jid, 5_000L)
        assertEquals(phone, mapped.chatPhoneDigits)
        assertEquals(contentIntent, mapped.contentIntent)
        assertFalse(mapped.toString().contains(phone))

        val lidMapped = NotificationMapper.map(build(lid), "com.whatsapp", "k", null, 5_000L)
        assertNull(lidMapped.chatPhoneDigits)
        assertEquals(contentIntent, lidMapped.contentIntent)
        assertFalse(target(phone, contentIntent).toString().contains(phone))
    }

    // ---------------------------------------------------------------- registry / ingestor (memory only)

    @Test
    fun ingestorStoresChatTargetWithTheReplyHandleAndRemovesItWithTheNotification() {
        val ingestor = NotificationIngestor(registry, {}, {}, { s -> s.tag?.let { key(it.first()) } })
        val contentIntent = chatContentIntent()
        val reply = ReplyAction(mutablePendingIntent(context), arrayOf(RemoteInput.Builder("r").build()), true)
        val mapped = MappedNotification(snapshot(notificationKey = "n1", tag = "a"), reply, contentIntent = contentIntent, chatPhoneDigits = phone)

        ingestor.onPosted(mapped)
        val stored = registry.chatTarget(key('a'))!!
        assertEquals(phone, stored.phoneDigits)
        assertEquals(contentIntent, stored.contentIntent)

        assertNotNull(registry.take(key('a')))
        assertNotNull("a send attempt does not drop the chat target", registry.chatTarget(key('a')))

        ingestor.onRemoved(mapped, android.service.notification.NotificationListenerService.REASON_CLICK)
        assertNull(registry.chatTarget(key('a')))
        assertEquals(0, registry.chatTargetCount)
    }

    @Test
    fun noChatTargetForGroupsHiddenContentOrRejectedChats_andClearDropsAll() {
        val ingestor = NotificationIngestor(registry, {}, {}, { s -> s.tag?.let { key(it.first()) } }, { it.tag != "r" })
        val ci = chatContentIntent()
        ingestor.onPosted(MappedNotification(snapshot(tag = "g", isGroupFlag = true), null, contentIntent = ci))
        ingestor.onPosted(MappedNotification(snapshot(tag = "s", isGroupSummary = true), null, contentIntent = ci))
        ingestor.onPosted(MappedNotification(snapshot(tag = "r"), null, contentIntent = ci, chatPhoneDigits = phone))
        assertEquals(0, registry.chatTargetCount)

        ingestor.onPosted(MappedNotification(snapshot(notificationKey = "h", tag = "h"), null, contentIntent = ci, chatPhoneDigits = phone))
        assertNotNull(registry.chatTarget(key('h')))
        // The same chat now shows a redacted / hidden notification: the target goes too (same rule as reply handles).
        ingestor.onPosted(MappedNotification(snapshot(notificationKey = "h", tag = "h"), null, isLikelyRedacted = true, contentIntent = ci))
        assertNull(registry.chatTarget(key('h')))

        registry.putChatTarget(key('x'), target(phone, ci))
        registry.clear()
        assertEquals(0, registry.chatTargetCount)
    }

    @Test
    fun chatTargetsAreBoundedLikeReplyHandles() {
        val small = ReplyActionRegistry(maxEntries = 2)
        small.putChatTarget(key('a'), ChatTarget(phone, null, "a", 1))
        small.putChatTarget(key('b'), ChatTarget(phone, null, "b", 2))
        small.putChatTarget(key('c'), ChatTarget(phone, null, "c", 3))
        assertEquals(2, small.chatTargetCount)
        assertNull(small.chatTarget(key('a')))
    }

    // ---------------------------------------------------------------- the click-to-chat intent

    @Test
    fun intentIsWhatsAppOnlyClickToChatWithEncodedText() {
        val text = "שלום דנה! 😀\nנתראה ב-19:30 & תביאי \"עוגה\"? 100%+ #טוב"
        val intent = WhatsAppOpener.buildOpenIntent(phone, text)!!
        assertEquals(Intent.ACTION_VIEW, intent.action)
        assertEquals("com.whatsapp", intent.`package`)
        assertTrue(intent.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        val uri: Uri = intent.data!!
        assertEquals("https", uri.scheme)
        assertEquals("api.whatsapp.com", uri.host)
        assertEquals("/send", uri.path)
        assertEquals(phone, uri.getQueryParameter("phone"))
        assertEquals("round-trips exactly (Hebrew, emoji, newline, symbols)", text, uri.getQueryParameter("text"))
        val query = uri.encodedQuery!!
        assertTrue(query.startsWith("phone=$phone&text="))
        assertFalse("no raw space", query.contains(' '))
        assertFalse("no raw newline", query.contains('\n'))
        assertFalse("no raw Hebrew", query.any { it.code > 127 })
        assertTrue(query.contains("%0A"))
        assertTrue("emoji as UTF-8 bytes", query.contains("%F0%9F%98%80"))
        assertTrue("'&' cannot start a new parameter", query.contains("%26"))
        assertTrue("'+' is not read as a space", query.contains("%2B"))
        assertTrue(query.contains("%23"))
    }

    @Test
    fun noIntentWithoutAKnownPhone() {
        val opener = WhatsAppOpener(context, registry)
        assertNull(opener.buildOpenIntent(key('a'), "היי"))
        registry.putChatTarget(key('a'), target(null, chatContentIntent()))
        assertNull(opener.buildOpenIntent(key('a'), "היי"))
        registry.putChatTarget(key('a'), target(phone, null))
        assertEquals(phone, opener.buildOpenIntent(key('a'), "היי")!!.data!!.getQueryParameter("phone"))
        assertNull(WhatsAppOpener.buildOpenIntent("+972", "x"))
        assertNull(WhatsAppOpener.buildOpenIntent("", "x"))
    }

    // ---------------------------------------------------------------- controller rules

    @Test
    fun opensWhatsAppWithTheStoredTextEvenWithSendingOff_andNeverChangesTheDraft() = runTest {
        val k = key('a')
        coordinator.draftsFlow.value = listOf(draft("d1", k, DraftState.AWAITING_APPROVAL).copy(editedText = "הטקסט הערוך 😀"))
        registry.putChatTarget(k, target(phone, chatContentIntent()))
        val c = controller()
        assertFalse(c.settings.value.sendingEnabled)

        assertEquals(OpenInWhatsAppResult.OPENED_WITH_TEXT, c.openInWhatsApp("d1"))
        val started = nextStarted()!!
        assertEquals("com.whatsapp", started.`package`)
        assertEquals("הטקסט הערוך 😀", started.data!!.getQueryParameter("text"))
        assertEquals(phone, started.data!!.getQueryParameter("phone"))
        assertNull("the contentIntent is not used as well", nextStarted())
        assertTrue(
            "no edit / approve / cancel / send",
            coordinator.calls.none { it.startsWith("edit") || it.startsWith("approve") || it.startsWith("cancel") || it.startsWith("send") },
        )
        assertEquals(DraftState.AWAITING_APPROVAL, c.drafts.value.single().state)
        assertNotNull("not a send: the chat target stays", registry.chatTarget(k))
    }

    @Test
    fun approvedDraftCanBeOpenedToo() = runTest {
        coordinator.draftsFlow.value = listOf(draft("d1", key('a'), DraftState.APPROVED))
        registry.putChatTarget(key('a'), target(phone, null))
        assertEquals(OpenInWhatsAppResult.OPENED_WITH_TEXT, controller().openInWhatsApp("d1"))
    }

    @Test
    fun withoutPhone_copiesSensitiveTextAndSendsWhatsAppsContentIntent() = runTest {
        val k = key('a')
        coordinator.draftsFlow.value = listOf(draft("d1", k, DraftState.AWAITING_APPROVAL))
        registry.putChatTarget(k, target(null, chatContentIntent()))

        assertEquals(OpenInWhatsAppResult.OPENED_CHAT_TEXT_COPIED, controller().openInWhatsApp("d1"))
        assertEquals("טיוטה", clipText())
        assertTrue(clipboard.primaryClip!!.description.extras!!.getBoolean(ClipDescription.EXTRA_IS_SENSITIVE))
        assertEquals("WhatsApp's own intent opened the chat", OPEN_CHAT_ACTION, nextStarted()!!.action)
    }

    @Test
    fun whatsAppMissing_fallsBackToCopyAndContentIntent() = runTest {
        val k = key('a')
        coordinator.draftsFlow.value = listOf(draft("d1", k, DraftState.AWAITING_APPROVAL))
        registry.putChatTarget(k, target(phone, chatContentIntent()))
        shadowOf(context).checkActivities(true) // unresolvable intents now throw ActivityNotFoundException
        shadowOf(context.packageManager).addActivityIfNotPresent(android.content.ComponentName(context, "test.ChatActivity"))
        shadowOf(context.packageManager).addIntentFilterForActivity(
            android.content.ComponentName(context, "test.ChatActivity"),
            android.content.IntentFilter(OPEN_CHAT_ACTION).apply { addCategory(Intent.CATEGORY_DEFAULT) },
        )

        assertEquals(OpenInWhatsAppResult.OPENED_CHAT_TEXT_COPIED, controller().openInWhatsApp("d1"))
        assertEquals("טיוטה", clipText())
    }

    @Test
    fun neitherPhoneNorContentIntent_copiesAndReportsChatNotFound() = runTest {
        coordinator.draftsFlow.value = listOf(draft("d1", key('a'), DraftState.AWAITING_APPROVAL))
        assertEquals(OpenInWhatsAppResult.CHAT_NOT_FOUND_TEXT_COPIED, controller().openInWhatsApp("d1"))
        assertEquals("טיוטה", clipText())
        assertNull(nextStarted())
    }

    @Test
    fun refusedInNonApprovableStatesAndForUnknownDrafts() = runTest {
        val refused = listOf(
            DraftState.RECEIVED, DraftState.DEBOUNCING, DraftState.PROCESSING, DraftState.DRAFT_READY,
            DraftState.SENDING, DraftState.SEND_ATTEMPTED, DraftState.UNKNOWN_RESULT, DraftState.FAILED,
            DraftState.EXPIRED, DraftState.CANCELLED, DraftState.FILTERED,
        )
        coordinator.draftsFlow.value = refused.mapIndexed { i, s -> draft("d$i", key('a' + i), s) }
        refused.indices.forEach { registry.putChatTarget(key('a' + it), target(phone, chatContentIntent())) }
        val c = controller()
        refused.indices.forEach { i ->
            assertEquals(refused[i].name, OpenInWhatsAppResult.NOT_AVAILABLE, c.openInWhatsApp("d$i"))
        }
        assertEquals(OpenInWhatsAppResult.NOT_AVAILABLE, c.openInWhatsApp("missing"))
        assertNull("nothing opened", nextStarted())
        assertNull("nothing copied", clipText())
    }

    @Test
    fun refusedWhenTheStoredTextIsBlank() = runTest {
        coordinator.draftsFlow.value = listOf(draft("d1", key('a'), DraftState.AWAITING_APPROVAL).copy(proposedText = null))
        registry.putChatTarget(key('a'), target(phone, null))
        assertEquals(OpenInWhatsAppResult.NOT_AVAILABLE, controller().openInWhatsApp("d1"))
        assertNull(nextStarted())
    }

    @Test
    fun refusedWhenEmergencyStopped() = runTest {
        val k = key('a')
        coordinator.draftsFlow.value = listOf(draft("d1", k, DraftState.AWAITING_APPROVAL))
        val c = controller()
        c.emergencyStop()
        registry.putChatTarget(k, target(phone, chatContentIntent())) // even if a new target arrived
        assertEquals(OpenInWhatsAppResult.EMERGENCY_STOPPED, c.openInWhatsApp("d1"))
        assertNull(nextStarted())
        assertNull(clipText())
    }

    @Test
    fun emergencyStopDropsChatTargets() = runTest {
        registry.putChatTarget(key('a'), target(phone, chatContentIntent()))
        controller().emergencyStop()
        assertEquals(0, registry.chatTargetCount)
    }

    @Test
    fun phoneNeverReachesTheLog() = runTest {
        ShadowLog.clear()
        val ingestor = NotificationIngestor(registry, {}, {}, { s -> s.tag?.let { key(it.first()) } })
        ingestor.onPosted(MappedNotification(snapshot(tag = "a"), null, contentIntent = chatContentIntent(), chatPhoneDigits = phone))
        coordinator.draftsFlow.value = listOf(draft("d1", key('a'), DraftState.AWAITING_APPROVAL))
        val c = controller()
        c.openInWhatsApp("d1") // direct intent
        registry.putChatTarget(key('a'), target(null, null))
        c.openInWhatsApp("d1") // copy fallback, chat not found
        val logs = ShadowLog.getLogs()
        assertTrue(logs.any { it.msg.contains("CHAT_TARGET_STORED") })
        assertTrue(logs.none { it.msg.contains(phone) || it.msg.contains("טיוטה") })
    }

    // ---------------------------------------------------------------- our notification + the no-UI activity

    @Test
    fun notificationTapGoesToOpenInWhatsAppActivity_andHasAnOpenInAppAction() {
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val nm = context.getSystemService(NotificationManager::class.java)
        DraftNotifier(context).onDrafts(listOf(draft("d1", key('a'), DraftState.AWAITING_APPROVAL, sender = "דנה")))
        val n = shadowOf(nm).allNotifications.single()

        assertTrue(n.contentIntent.isImmutable)
        assertTrue("an activity, not a broadcast/service trampoline", shadowOf(n.contentIntent).isActivityIntent)
        val tap = shadowOf(n.contentIntent).savedIntent
        assertEquals(OpenInWhatsAppActivity::class.java.name, tap.component!!.className)
        assertEquals("d1", tap.getStringExtra(DraftNotifier.EXTRA_DRAFT_ID))
        assertNull("the text is read at tap time, never carried in the intent", tap.extras!!.keySet().firstOrNull { it != DraftNotifier.EXTRA_DRAFT_ID })

        val action = n.actions.single()
        assertEquals("פתח באפליקציה", action.title.toString())
        assertTrue(action.actionIntent.isImmutable)
        val open = shadowOf(action.actionIntent).savedIntent
        assertEquals(MainActivity::class.java.name, open.component!!.className)
        assertEquals("d1", open.getStringExtra(DraftNotifier.EXTRA_DRAFT_ID))
        assertTrue("no RemoteInput: nothing can be sent from our notification", action.remoteInputs.isNullOrEmpty())

        // S-L6 unchanged: no names / message text, private on the lock screen.
        assertEquals(Notification.VISIBILITY_PRIVATE, n.visibility)
        assertEquals(DraftNotifier.TITLE, n.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals(DraftNotifier.TEXT, n.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        assertFalse(n.extras.keySet().any { n.extras.get(it)?.toString()?.contains("דנה") == true })
    }

    @Test
    fun activityOpensTheCurrentStoredTextAtTapTime() = runTest {
        val k = key('a')
        coordinator.draftsFlow.value = listOf(draft("d1", k, DraftState.AWAITING_APPROVAL))
        registry.putChatTarget(k, target(phone, null))
        val c = controller()
        OpenInWhatsAppActivity.controllerForTests = c
        // The notification was posted for revision 1; the user edits afterwards (revision 2).
        coordinator.draftsFlow.value = listOf(draft("d1", k, DraftState.AWAITING_APPROVAL).copy(editedText = "נוסח חדש", revision = 2))

        val activity = Robolectric.buildActivity(OpenInWhatsAppActivity::class.java, tapIntent("d1")).create().get()
        val started = nextStarted()!!
        assertEquals("נוסח חדש", started.data!!.getQueryParameter("text"))
        assertEquals("com.whatsapp", started.`package`)
        assertTrue(activity.isFinishing)
        assertNull("MainActivity is not opened on success", nextStarted())
    }

    @Test
    fun activityOpensTheAppAtTheDraftWhenItCannotOpenWhatsApp() {
        val fake = FakeAppController(initialDrafts = listOf(draft("d1", key('a'), DraftState.EXPIRED)))
        OpenInWhatsAppActivity.controllerForTests = fake
        val activity = Robolectric.buildActivity(OpenInWhatsAppActivity::class.java, tapIntent("d1")).create().get()
        assertEquals(listOf("d1" to "טיוטה"), fake.openInWhatsAppCalls)
        val started = nextStarted()!!
        assertEquals(MainActivity::class.java.name, started.component!!.className)
        assertEquals("d1", started.getStringExtra(DraftNotifier.EXTRA_DRAFT_ID))
        assertTrue(activity.isFinishing)
    }

    @Test
    fun activityWithoutDraftIdJustOpensTheApp() {
        val fake = FakeAppController()
        OpenInWhatsAppActivity.controllerForTests = fake
        Robolectric.buildActivity(OpenInWhatsAppActivity::class.java, Intent(context, OpenInWhatsAppActivity::class.java)).create()
        assertTrue(fake.openInWhatsAppCalls.isEmpty())
        assertEquals(MainActivity::class.java.name, nextStarted()!!.component!!.className)
    }

    private fun tapIntent(draftId: String) =
        Intent(context, OpenInWhatsAppActivity::class.java).putExtra(DraftNotifier.EXTRA_DRAFT_ID, draftId)

    private companion object {
        const val OPEN_CHAT_ACTION = "ai.noa.bridge.test.OPEN_CHAT"
    }
}
