package ai.noa.bridge.app.platform

import ai.noa.bridge.core.DraftRequest
import ai.noa.bridge.core.DraftResult
import ai.noa.bridge.core.IncomingMessage
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

/** Plain JVM test (no Robolectric): the client has no Android dependencies besides SafeLog. */
class BridgeApiClientTest {
    private lateinit var server: MockWebServer
    private var unauthorizedCalls = 0
    private val token = "tok_" + "x".repeat(40)

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun baseUrl() = server.url("/").toString()

    private fun client(debug: Boolean = true, base: String = baseUrl(), clock: Long = 1_763_236_800_000L) =
        BridgeApiClient(
            credentials = { ApiCredentials(base, token) },
            allowDebugCleartext = debug,
            clockMillis = { clock },
            onUnauthorized = { unauthorizedCalls++ },
        )

    private val ref = "ab".repeat(32)
    private fun request(
        requestId: String = "11111111-2222-4333-8444-555555555555",
        messages: List<Pair<String, Long>> = listOf("היי, מתי נפגשים?" to 1_763_236_800_000L),
        sender: String = "דנה",
        conversationRef: String = ref,
    ) = DraftRequest(
        requestId = requestId,
        conversationKey = ai.noa.bridge.core.ConversationKey(conversationRef),
        senderDisplayName = sender,
        messages = messages.mapIndexed { i, (text, ts) -> IncomingMessage("e$i", ai.noa.bridge.core.ConversationKey(conversationRef), sender, text, ts) },
    )

    private fun okDraft(requestId: String = "11111111-2222-4333-8444-555555555555") = MockResponse().setResponseCode(200)
        .setHeader("Content-Type", "application/json")
        .setBody(
            """{"request_id":"$requestId","draft_text":"נשמע מעולה, אני מאשר ב־20:00 😊",""" +
                """"safety":{"injection_suspected":true,"sensitive_request":true,"notes":["ההודעה מבקשת קוד אימות — לא לשלוח"]},"engine":"stub"}""",
        )

    private fun error(code: Int, err: String) = MockResponse().setResponseCode(code)
        .setBody("""{"error":"$err","message":"הודעה מהשרת"}""")

    @Test
    fun draftRequestHasHeadersAndExactJsonShape() = runTest {
        server.enqueue(okDraft())
        val result = client().requestDraft(request())

        val recorded = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", recorded.method)
        assertEquals("/v1/drafts", recorded.path)
        assertEquals("Bearer $token", recorded.getHeader("Authorization"))
        assertEquals("1763236800000", recorded.getHeader("X-Bridge-Timestamp"))
        val nonce = recorded.getHeader("X-Bridge-Nonce")!!
        assertTrue(nonce.matches(Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")))
        assertTrue(recorded.getHeader("Content-Type")!!.startsWith("application/json"))

        val body = Json.parseToJsonElement(recorded.body.readUtf8()).jsonObject
        assertEquals(setOf("request_id", "conversation_ref", "sender_display_name", "messages", "locale"), body.keys)
        assertEquals("11111111-2222-4333-8444-555555555555", body["request_id"]!!.jsonPrimitive.content)
        assertEquals(ref, body["conversation_ref"]!!.jsonPrimitive.content)
        assertEquals("דנה", body["sender_display_name"]!!.jsonPrimitive.content)
        assertEquals("he", body["locale"]!!.jsonPrimitive.content)
        val msg = body["messages"]!!.jsonArray.single().jsonObject
        assertEquals(setOf("text", "sent_at"), msg.keys)
        assertEquals("היי, מתי נפגשים?", msg["text"]!!.jsonPrimitive.content)
        assertEquals(1_763_236_800_000L, msg["sent_at"]!!.jsonPrimitive.long)

        val success = result as DraftResult.Success
        assertEquals("נשמע מעולה, אני מאשר ב־20:00 😊", success.text)
        assertEquals("stub", success.engine)
        assertTrue(success.safety.injectionSuspected)
        assertTrue(success.safety.sensitiveRequest)
        assertEquals(listOf("ההודעה מבקשת קוד אימות — לא לשלוח"), success.safety.notes)
    }

    @Test
    fun missingSafetyDefaultsToClean() = runTest {
        server.enqueue(MockResponse().setBody("""{"request_id":"22222222-3333-4444-9555-666666666666","draft_text":"שלום","engine":"stub","extra":1}"""))
        val result = client().requestDraft(request(requestId = "22222222-3333-4444-9555-666666666666")) as DraftResult.Success
        assertFalse(result.safety.injectionSuspected)
        assertTrue(result.safety.notes.isEmpty())
    }

    @Test
    fun nonceIsUniquePerCall() = runTest {
        repeat(3) { server.enqueue(okDraft()) }
        val c = client()
        repeat(3) { c.requestDraft(request()) }
        val nonces = (1..3).map { server.takeRequest(5, TimeUnit.SECONDS)!!.getHeader("X-Bridge-Nonce") }
        assertEquals(3, nonces.toSet().size)
    }

    @Test
    fun errorMapping() = runTest {
        val cases = listOf(
            Triple(401, "unauthorized", BridgeApiClient.MSG_UNAUTHORIZED to false),
            Triple(409, "replay", BridgeApiClient.MSG_REPLAY to true),
            Triple(413, "too_large", BridgeApiClient.MSG_TOO_LARGE to false),
            Triple(422, "invalid_request", BridgeApiClient.MSG_INVALID_REQUEST to false),
            Triple(429, "rate_limited", BridgeApiClient.MSG_RATE_LIMITED to true),
            Triple(503, "disabled", BridgeApiClient.MSG_DISABLED to false),
            Triple(502, "engine_error", BridgeApiClient.MSG_UNAVAILABLE to true),
            Triple(500, "x", BridgeApiClient.MSG_UNAVAILABLE to true),
            Triple(404, "not_found", BridgeApiClient.MSG_WRONG_ENDPOINT to false),
            Triple(405, "method_not_allowed", BridgeApiClient.MSG_WRONG_ENDPOINT to false),
            Triple(400, "x", BridgeApiClient.MSG_REJECTED to false),
        )
        val c = client()
        cases.forEach { (code, err, expected) ->
            server.enqueue(error(code, err))
            val failure = c.requestDraft(request()) as DraftResult.Failure
            assertEquals("status $code", expected.first, failure.reason)
            assertEquals("status $code", expected.second, failure.retryable)
        }
        assertEquals(1, unauthorizedCalls)
        assertEquals("השרת כבוי כרגע", BridgeApiClient.MSG_DISABLED)
        assertEquals("יותר מדי בקשות, נסה שוב בעוד דקה", BridgeApiClient.MSG_RATE_LIMITED)
        assertEquals("החיבור לשרת בוטל — יש לחבר מחדש", BridgeApiClient.MSG_UNAUTHORIZED)
        assertEquals("השרת לא זמין", BridgeApiClient.MSG_UNAVAILABLE)
    }

    @Test
    fun ioErrorIsRetryableUnavailable() = runTest {
        val base = baseUrl()
        server.shutdown()
        val failure = client(base = base).requestDraft(request()) as DraftResult.Failure
        assertEquals(BridgeApiClient.MSG_UNAVAILABLE, failure.reason)
        assertTrue(failure.retryable)
    }

    @Test
    fun mismatchedRequestIdOrMalformedBodyIsFailure() = runTest {
        server.enqueue(okDraft(requestId = "other"))
        server.enqueue(MockResponse().setBody("not json"))
        val c = client()
        assertEquals(BridgeApiClient.MSG_BAD_RESPONSE, (c.requestDraft(request()) as DraftResult.Failure).reason)
        assertEquals(BridgeApiClient.MSG_BAD_RESPONSE, (c.requestDraft(request()) as DraftResult.Failure).reason)
    }

    @Test
    fun cleartextRefusedOutsideDebugAndNoRequestIsMade() = runTest {
        val failure = client(debug = false).requestDraft(request()) as DraftResult.Failure
        assertEquals(BridgeApiClient.MSG_BAD_URL, failure.reason)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun baseUrlValidation() {
        assertNotNull(BridgeApiClient.validateBaseUrl("https://bridge.example.com", false))
        assertNotNull(BridgeApiClient.validateBaseUrl("https://bridge.example.com:8443/noa/", false))
        assertNull(BridgeApiClient.validateBaseUrl("http://bridge.example.com", false))
        assertNull(BridgeApiClient.validateBaseUrl("http://bridge.example.com", true))
        assertNull(BridgeApiClient.validateBaseUrl("http://192.168.1.10:8000", true))
        assertNull(BridgeApiClient.validateBaseUrl("http://10.0.2.2:8000", false))
        assertNotNull(BridgeApiClient.validateBaseUrl("http://10.0.2.2:8000", true))
        assertNotNull(BridgeApiClient.validateBaseUrl("http://localhost:8000", true))
        assertNotNull(BridgeApiClient.validateBaseUrl("http://127.0.0.1:8000", true))
        assertNull(BridgeApiClient.validateBaseUrl("ftp://bridge.example.com", true))
        assertNull(BridgeApiClient.validateBaseUrl("https://user:pw@bridge.example.com", false))
        assertNull(BridgeApiClient.validateBaseUrl("https://bridge.example.com/?x=1", false))
        assertNull(BridgeApiClient.validateBaseUrl("bridge.example.com", false))
    }

    @Test
    fun basePathIsPreserved() = runTest {
        server.enqueue(okDraft())
        client(base = server.url("/noa/").toString()).requestDraft(request())
        assertEquals("/noa/v1/drafts", server.takeRequest(5, TimeUnit.SECONDS)!!.path)
    }

    @Test
    fun contractLimitsAreEnforcedBeforeSending() = runTest {
        server.enqueue(okDraft())
        val many = (1..25).map { "הודעה $it " + "א".repeat(500) to it.toLong() } // 25 lines, ~509 chars each
        val long = listOf("ב".repeat(2_500) to 100L)
        client().requestDraft(request(messages = many + long, sender = "ש".repeat(100)))
        val body = Json.parseToJsonElement(server.takeRequest(5, TimeUnit.SECONDS)!!.body.readUtf8()).jsonObject
        val msgs = body["messages"] as JsonArray
        val texts = msgs.map { it.jsonObject["text"]!!.jsonPrimitive.content }
        assertTrue(msgs.size <= 20)
        assertTrue(texts.all { it.length <= 2_000 })
        assertTrue(texts.sumOf { it.length } <= 8_000)
        assertEquals("ב".repeat(2_000), texts.last()) // newest kept, truncated
        assertEquals(80, body["sender_display_name"]!!.jsonPrimitive.content.length)
    }

    @Test
    fun nonUuidV4RequestIdIsNotSent() = runTest {
        val failure = client().requestDraft(request(requestId = "not-a-uuid")) as DraftResult.Failure
        assertFalse(failure.retryable)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun invalidConversationRefIsNotSent() = runTest {
        val failure = client().requestDraft(request(conversationRef = "not-hex")) as DraftResult.Failure
        assertFalse(failure.retryable)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun pairSendsCodeAndDeviceNameWithoutAuth() = runTest {
        server.enqueue(MockResponse().setBody("""{"device_id":"dev_1","device_token":"secret-token"}"""))
        val outcome = client().pair(baseUrl(), "abcd-2345", "Galaxy S25 Ultra")
        val recorded = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/v1/pair", recorded.path)
        assertNull(recorded.getHeader("Authorization"))
        val body = Json.parseToJsonElement(recorded.body.readUtf8()) as JsonObject
        assertEquals(setOf("pairing_code", "device_name"), body.keys)
        assertEquals("ABCD2345", body["pairing_code"]!!.jsonPrimitive.content)
        assertEquals("Galaxy S25 Ultra", body["device_name"]!!.jsonPrimitive.content)
        assertEquals(PairOutcome.Success("dev_1", "secret-token"), outcome)
        assertFalse(outcome.toString().contains("secret-token"))
    }

    @Test
    fun pairErrorsAndBadCodes() = runTest {
        server.enqueue(error(400, "invalid_pairing_code"))
        server.enqueue(error(429, "rate_limited"))
        val c = client()
        assertEquals(BridgeApiClient.MSG_BAD_CODE, (c.pair(baseUrl(), "ABCD2345", "x") as PairOutcome.Failure).messageHebrew)
        assertEquals(BridgeApiClient.MSG_RATE_LIMITED, (c.pair(baseUrl(), "ABCD2345", "x") as PairOutcome.Failure).messageHebrew)
        // 0/1/O/I are not in the server alphabet; wrong length — no request made.
        assertEquals(BridgeApiClient.MSG_BAD_CODE_FORMAT, (c.pair(baseUrl(), "ABCD0123", "x") as PairOutcome.Failure).messageHebrew)
        assertEquals(BridgeApiClient.MSG_BAD_CODE_FORMAT, (c.pair(baseUrl(), "ABC", "x") as PairOutcome.Failure).messageHebrew)
        assertEquals(2, server.requestCount)
        assertEquals("קוד החיבור לא תקין או שפג תוקפו", BridgeApiClient.MSG_BAD_CODE)
    }

    @Test
    fun revokeIsAuthenticatedPost() = runTest {
        server.enqueue(MockResponse().setResponseCode(204))
        assertTrue(client().revoke())
        val recorded = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", recorded.method)
        assertEquals("/v1/devices/revoke", recorded.path)
        assertEquals("Bearer $token", recorded.getHeader("Authorization"))
        assertNotNull(recorded.getHeader("X-Bridge-Nonce"))
        assertNotNull(recorded.getHeader("X-Bridge-Timestamp"))
    }

    @Test
    fun healthIsUnauthenticatedGet() = runTest {
        server.enqueue(MockResponse().setBody("""{"ok":true,"enabled":false,"engine":"stub","version":"0.1.0"}"""))
        val health = client().health(baseUrl())
        val recorded = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("GET", recorded.method)
        assertEquals("/health", recorded.path)
        assertNull(recorded.getHeader("Authorization"))
        assertEquals(HealthInfo(ok = true, enabled = false, engine = "stub", version = "0.1.0"), health)
    }

    @Test
    fun timeoutsMatchSpec() {
        val c = BridgeApiClient.defaultClientBuilder().build()
        assertEquals(10_000, c.connectTimeoutMillis)
        assertEquals(30_000, c.readTimeoutMillis)
        assertEquals(40_000, c.callTimeoutMillis)
        assertFalse(c.retryOnConnectionFailure)
        assertFalse(c.followRedirects)
    }

    @Test
    fun credentialsNeverPrintToken() {
        assertNotEquals(true, ApiCredentials("https://x", "secret").toString().contains("secret"))
    }
}
