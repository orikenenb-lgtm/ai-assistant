package ai.noa.bridge.app.qa

import ai.noa.bridge.app.platform.ApiCredentials
import ai.noa.bridge.app.platform.BridgeApiClient
import ai.noa.bridge.core.ConversationKey
import ai.noa.bridge.core.DraftRequest
import ai.noa.bridge.core.DraftResult
import ai.noa.bridge.core.IncomingMessage
import android.app.Application
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Ignore
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.UUID

/**
 * QA traceability: spec 13.3 "long messages", "emoji", "mixed Hebrew/English" on the Android
 * client side — what exactly leaves the phone in POST /v1/drafts (against a loopback MockWebServer).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class MessageContentQaTest {
    private val server = MockWebServer().apply { start() }
    private val key = ConversationKey("ab".repeat(32))

    @After fun tearDown() = server.shutdown()

    private fun client() = BridgeApiClient(
        credentials = { ApiCredentials(server.url("/").toString(), "qa-token") },
        allowDebugCleartext = true,
    )

    private fun request(vararg texts: String) = DraftRequest(
        requestId = UUID.randomUUID().toString(),
        conversationKey = key,
        senderDisplayName = "דנה 🌸",
        messages = texts.mapIndexed { i, t -> IncomingMessage("e$i", key, "דנה", t, 1_000L + i) },
    )

    /** Sends [r] and returns the JSON body the server received. */
    private suspend fun sentBody(r: DraftRequest): JSONObject {
        server.enqueue(MockResponse().setBody("""{"request_id":"${r.requestId}","draft_text":"ok"}"""))
        val result = client().requestDraft(r)
        assertTrue(result is DraftResult.Success)
        return JSONObject(server.takeRequest().body.readUtf8())
    }

    private fun JSONObject.texts(): List<String> {
        val arr = getJSONArray("messages")
        return (0 until arr.length()).map { arr.getJSONObject(it).getString("text") }
    }

    @Test fun content_emojiMixedLanguageAndHebrewMarksArriveByteExact() = runTest {
        val texts = arrayOf(
            "היי 😂😂 what's up?",
            "👨‍👩‍👧 משפחה 🇮🇱 1️⃣ 👍🏽",
            "שָׁלוֹם ״חברים״ — צ'יפס",
            "‏מה נשמע? OK‎",
        )
        val body = sentBody(request(*texts))
        assertEquals(texts.toList(), body.texts())
        assertEquals("דנה 🌸", body.getString("sender_display_name"))
        assertEquals("he", body.getString("locale"))
    }

    @Test fun content_longHebrewMessageIsCutTo2000_andTotalBudgetKeepsNewest() = runTest {
        val long = "א".repeat(5_000)
        val body = sentBody(request(long))
        assertEquals(2_000, body.texts().single().length)

        val many = (1..25).map { "הודעה $it " + "ב".repeat(600) }.toTypedArray()
        val b2 = sentBody(request(*many))
        val sent = b2.texts()
        assertTrue(sent.size <= 20)
        assertTrue(sent.sumOf { it.length } <= 8_000)
        assertTrue("newest kept", sent.last().startsWith("הודעה 25 "))
    }

    @Test fun content_blankOnlyMessagesAreNeverSent() = runTest {
        val result = client().requestDraft(request("   ", "\n\t"))
        assertTrue(result is DraftResult.Failure)
        assertEquals(0, server.requestCount)
    }

    @Ignore("BUG: QA-03 — BridgeApiClient.buildDraftBody cuts at 2000 UTF-16 units (take(MAX_TEXT)), splitting an emoji surrogate pair; the lone surrogate is sent as '?'")
    @Test fun content_cutAt2000NeverSplitsAnEmoji() = runTest {
        val text = "א".repeat(1_999) + "😀" + " סוף"
        val sent = sentBody(request(text)).texts().single()
        assertFalse("no replacement character at the cut: ${sent.takeLast(3)}", sent.endsWith("?") || sent.endsWith("�"))
        assertTrue(sent == "א".repeat(1_999) || sent == "א".repeat(1_999) + "😀")
    }
}
