package com.disciplineos.app.ai

import com.disciplineos.core.domain.coach.CoachChunk
import com.disciplineos.core.domain.coach.CoachContext
import com.disciplineos.core.domain.coach.CoachErrorKind
import com.disciplineos.core.domain.coach.CoachTaskRef
import com.disciplineos.core.model.ChatMessage
import com.disciplineos.core.model.ChatRole
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Instant
import java.util.concurrent.TimeUnit

class RemoteBackendCoachProviderTest {

    private lateinit var server: MockWebServer
    private lateinit var client: OkHttpClient

    private val context = CoachContext(
        localDateIso = "2026-11-04",
        pendingMandatoryTitles = listOf("לימוד למבחן"),
        pendingOptionalTitles = listOf("ריצה"),
        completedTodayCount = 2,
        streakDays = 5,
        focusMinutesToday = 50,
        appUsageSummary = null,
    )

    private class FakeTokens(private val value: String?) : BackendTokenProvider {
        var calls = 0
        override suspend fun token(): String? { calls++; return value }
    }

    /** Hands out tok-1, tok-2, … (null after [maxTokens]); records invalidations. */
    private class RotatingTokens(private val maxTokens: Int = Int.MAX_VALUE) : BackendTokenProvider {
        var calls = 0
        val invalidated = mutableListOf<String>()
        override suspend fun token(): String? { calls++; return if (calls <= maxTokens) "tok-$calls" else null }
        override suspend fun invalidate(rejectedToken: String) { invalidated += rejectedToken }
    }

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = OkHttpClient.Builder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS)
            .followRedirects(false)
            .retryOnConnectionFailure(false)
            .build()
    }

    @After
    fun tearDown() {
        client.dispatcher.cancelAll()
        server.shutdown()
    }

    private fun provider(tokens: BackendTokenProvider = FakeTokens("tok-123"), base: String = server.url("/functions/v1/coach-stream").toString()) =
        RemoteBackendCoachProvider(
            client = client,
            config = AiBackendConfig(baseUrl = base, cleartextHostsAllowed = setOf(server.hostName)),
            tokenProvider = tokens,
        )

    private fun sse(vararg events: Pair<String, String>): MockResponse {
        val body = events.joinToString("") { (type, data) -> "event: $type\ndata: $data\n\n" }
        return MockResponse().setHeader("Content-Type", "text/event-stream").setBody(body)
    }

    private fun collect(flow: Flow<CoachChunk>): List<CoachChunk> = runBlocking { withTimeout(10_000) { flow.toList() } }

    @Test
    fun streamsDeltasActionAndDone() {
        server.enqueue(
            sse(
                "delta" to """{"text":"שלום, "}""",
                "ping" to "{}",
                "delta" to """{"text":"בוא נתכנן."}""",
                "action" to """{"json":{"type":"create_task","title":"ריצה","kind":"OPTIONAL","priority":"MEDIUM"}}""",
                "action" to """{"json":"{\"type\":\"reschedule_task\",\"taskId\":7,\"newDate\":\"2026-11-05\"}"}""",
                "done" to "{}",
            ),
        )
        val tokens = FakeTokens("tok-123")
        val chunks = collect(provider(tokens).streamReply(emptyList(), "תעזור לי", context))

        assertEquals(
            listOf(
                CoachChunk.TextDelta("שלום, "),
                CoachChunk.TextDelta("בוא נתכנן."),
            ),
            chunks.filterIsInstance<CoachChunk.TextDelta>(),
        )
        val actions = chunks.filterIsInstance<CoachChunk.ActionJson>()
        assertEquals(2, actions.size)
        val first = Json.parseToJsonElement(actions[0].json).jsonObject
        assertEquals("create_task", first["type"]!!.jsonPrimitive.content)
        val second = Json.parseToJsonElement(actions[1].json).jsonObject
        assertEquals("reschedule_task", second["type"]!!.jsonPrimitive.content)
        assertEquals(CoachChunk.Done, chunks.last())

        val recorded = server.takeRequest(2, TimeUnit.SECONDS)!!
        assertEquals("POST", recorded.method)
        assertEquals("/functions/v1/coach-stream/v1/coach/stream", recorded.path)
        assertEquals("Bearer tok-123", recorded.getHeader("Authorization"))
        assertTrue(recorded.getHeader("Content-Type")!!.startsWith("application/json"))
        val body = Json.parseToJsonElement(recorded.body.readUtf8()).jsonObject
        assertEquals("he", body["locale"]!!.jsonPrimitive.content)
        val messages = body["messages"]!!.jsonArray
        assertEquals(1, messages.size)
        assertEquals("user", messages[0].jsonObject["role"]!!.jsonPrimitive.content)
        assertEquals("תעזור לי", messages[0].jsonObject["text"]!!.jsonPrimitive.content)
        val ctx = body["context"]!!.jsonObject
        assertEquals("2026-11-04", ctx["localDate"]!!.jsonPrimitive.content)
        assertEquals(5, ctx["streakDays"]!!.jsonPrimitive.content.toInt())
        assertNull("appUsageSummary must be omitted when null", ctx["appUsageSummary"])
        assertEquals(1, tokens.calls)
    }

    @Test
    fun http429MapsToRateLimited() {
        server.enqueue(MockResponse().setResponseCode(429).setBody("""{"error":"slow down"}"""))
        val chunks = collect(provider().streamReply(emptyList(), "hi", context))
        assertEquals(listOf(CoachErrorKind.RATE_LIMITED), chunks.errors())
    }

    @Test
    fun http401And403MapToNotConfigured() {
        // 401 is retried exactly once (with a fresh token); a second 401 → NOT_CONFIGURED. 403 is never retried.
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(403))
        val tokens = RotatingTokens()
        assertEquals(listOf(CoachErrorKind.NOT_CONFIGURED), collect(provider(tokens).streamReply(emptyList(), "hi", context)).errors())
        assertEquals(2, server.requestCount)
        assertEquals(listOf("tok-1"), tokens.invalidated)
        assertEquals(listOf(CoachErrorKind.NOT_CONFIGURED), collect(provider(tokens).streamReply(emptyList(), "hi", context)).errors())
        assertEquals(3, server.requestCount)
        assertEquals("403 must not invalidate", listOf("tok-1"), tokens.invalidated)
    }

    @Test
    fun http401InvalidatesTokenAndRetriesOnceWithFreshToken() {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(sse("delta" to """{"text":"שלום"}""", "done" to "{}"))
        val tokens = RotatingTokens()
        val chunks = collect(provider(tokens).streamReply(emptyList(), "hi", context))
        assertEquals(listOf(CoachChunk.TextDelta("שלום"), CoachChunk.Done), chunks)
        assertEquals("Bearer tok-1", server.takeRequest(2, TimeUnit.SECONDS)!!.getHeader("Authorization"))
        val retry = server.takeRequest(2, TimeUnit.SECONDS)!!
        assertEquals("Bearer tok-2", retry.getHeader("Authorization"))
        assertTrue("same body is re-sent", retry.body.readUtf8().contains("\"messages\""))
        assertEquals(listOf("tok-1"), tokens.invalidated)
        assertEquals(2, tokens.calls)
    }

    @Test
    fun http401RetryWithoutTokenMapsToNotConfigured() {
        server.enqueue(MockResponse().setResponseCode(401))
        val tokens = RotatingTokens(maxTokens = 1)
        assertEquals(listOf(CoachErrorKind.NOT_CONFIGURED), collect(provider(tokens).streamReply(emptyList(), "hi", context)).errors())
        assertEquals(1, server.requestCount)
    }

    @Test
    fun requestCarriesPendingTaskRefs() {
        val refs = listOf(
            CoachTaskRef(7, "דוח\u202E <b>", mandatory = true, date = "2026-11-02"),
            CoachTaskRef(7, "כפול", mandatory = true, date = "2026-11-04"),
            CoachTaskRef(0, "מזהה לא חוקי", mandatory = false, date = "2026-11-04"),
            CoachTaskRef(9, "קריאה", mandatory = false, date = "2026-11-04"),
        )
        val req = RemoteBackendCoachProvider.buildRequest(emptyList(), "דחה", context.copy(pendingTasks = refs))
        assertEquals(listOf(7L, 9L), req.context.pendingTasks.map { it.id })
        assertEquals("דוח <b>", req.context.pendingTasks[0].title) // control/bidi stripped (titles already sanitised upstream)
        assertEquals("2026-11-02", req.context.pendingTasks[0].date)
        val wire = Json.parseToJsonElement(RemoteBackendCoachProvider.json.encodeToString(CoachStreamRequest.serializer(), req)).jsonObject
        val first = wire["context"]!!.jsonObject["pendingTasks"]!!.jsonArray[0].jsonObject
        assertEquals(7, first["id"]!!.jsonPrimitive.content.toInt())
        assertEquals("true", first["mandatory"]!!.jsonPrimitive.content)
        // Default: empty list, still serialised (encodeDefaults) so the backend sees a stable shape.
        val empty = RemoteBackendCoachProvider.buildRequest(emptyList(), "hi", context)
        assertTrue(empty.context.pendingTasks.isEmpty())
    }

    @Test
    fun pendingTaskRefsAreCapped() {
        val many = (1L..100L).map { CoachTaskRef(it, "t$it", mandatory = true, date = "2026-11-04") }
        val req = RemoteBackendCoachProvider.buildRequest(emptyList(), "hi", context.copy(pendingTasks = many))
        assertEquals(RemoteBackendCoachProvider.MAX_TITLES_PER_LIST, req.context.pendingTasks.size)
    }

    @Test
    fun http402MapsToQuotaExceededAnd5xxToBackendUnavailable() {
        server.enqueue(MockResponse().setResponseCode(402))
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(listOf(CoachErrorKind.QUOTA_EXCEEDED), collect(provider().streamReply(emptyList(), "hi", context)).errors())
        assertEquals(listOf(CoachErrorKind.BACKEND_UNAVAILABLE), collect(provider().streamReply(emptyList(), "hi", context)).errors())
    }

    @Test
    fun malformedEventMapsToInvalidResponseAndStopsStream() {
        server.enqueue(
            sse(
                "delta" to """{"text":"ok"}""",
                "delta" to "not-json",
                "delta" to """{"text":"never delivered"}""",
                "done" to "{}",
            ),
        )
        val chunks = collect(provider().streamReply(emptyList(), "hi", context))
        assertEquals(listOf(CoachChunk.TextDelta("ok")), chunks.filterIsInstance<CoachChunk.TextDelta>())
        assertEquals(CoachErrorKind.INVALID_RESPONSE, (chunks.last() as CoachChunk.Error).kind)
    }

    @Test
    fun malformedActionMapsToInvalidResponse() {
        server.enqueue(sse("action" to """{"json":42}""", "done" to "{}"))
        val chunks = collect(provider().streamReply(emptyList(), "hi", context))
        assertEquals(listOf(CoachErrorKind.INVALID_RESPONSE), chunks.errors())
        assertTrue(chunks.none { it is CoachChunk.ActionJson })
    }

    @Test
    fun nonEventStreamContentTypeMapsToInvalidResponse() {
        server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody("<html>captive portal</html>"))
        val chunks = collect(provider().streamReply(emptyList(), "hi", context))
        assertEquals(listOf(CoachErrorKind.INVALID_RESPONSE), chunks.errors())
    }

    @Test
    fun serverErrorEventIsForwarded() {
        server.enqueue(sse("delta" to """{"text":"a"}""", "error" to """{"kind":"quota_exceeded"}"""))
        val chunks = collect(provider().streamReply(emptyList(), "hi", context))
        assertEquals(listOf(CoachErrorKind.QUOTA_EXCEEDED), chunks.errors())
    }

    @Test
    fun streamEndingWithoutDoneIsAnError() {
        server.enqueue(sse("delta" to """{"text":"a"}"""))
        val chunks = collect(provider().streamReply(emptyList(), "hi", context))
        assertEquals(listOf(CoachErrorKind.BACKEND_UNAVAILABLE), chunks.errors())
    }

    @Test
    fun connectionFailureMapsToOffline() {
        val deadUrl = server.url("/").toString()
        server.shutdown()
        val chunks = collect(provider(base = deadUrl).streamReply(emptyList(), "hi", context))
        assertEquals(listOf(CoachErrorKind.OFFLINE), chunks.errors())
    }

    @Test
    fun missingTokenMapsToNotConfiguredWithoutNetwork() {
        val chunks = collect(provider(tokens = FakeTokens(null)).streamReply(emptyList(), "hi", context))
        assertEquals(listOf(CoachErrorKind.NOT_CONFIGURED), chunks.errors())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun cleartextBaseUrlIsRejectedWithoutNetwork() {
        val p = RemoteBackendCoachProvider(
            client = client,
            config = AiBackendConfig(baseUrl = server.url("/").toString(), cleartextHostsAllowed = emptySet()),
            tokenProvider = FakeTokens("tok"),
        )
        val chunks = collect(p.streamReply(emptyList(), "hi", context))
        assertEquals(listOf(CoachErrorKind.NOT_CONFIGURED), chunks.errors())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun cancellationClosesTheEventSource() {
        // MockWebServer also applies the throttle while reading the *request* body, so the first period must be
        // larger than the request (~300 bytes): pad it with an SSE comment line.
        val first = "event: delta\ndata: {\"text\":\"first\"}\n\n: " + "p".repeat(4_096) + "\n"
        // After the first chunk the server stalls for 3s (throttled body). The call must be gone well before that,
        // so only cancellation (not a natural end of stream) can satisfy the assertion below.
        val body = first + ": " + "x".repeat(4_096) + "\n\nevent: done\ndata: {}\n\n"
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody(body)
                .throttleBody(first.toByteArray().size.toLong(), 3, TimeUnit.SECONDS),
        )
        val chunk = runBlocking {
            withTimeout(5_000) { provider().streamReply(emptyList(), "hi", context).first() }
        }
        assertEquals(CoachChunk.TextDelta("first"), chunk)

        // first() cancels the collector → awaitClose → EventSource.cancel() → the call is gone.
        val deadline = System.currentTimeMillis() + 1_500
        while (client.dispatcher.runningCallsCount() > 0 && System.currentTimeMillis() < deadline) Thread.sleep(20)
        assertEquals(0, client.dispatcher.runningCallsCount())
    }

    @Test
    fun requestKeepsLast12MessagesCapsTextAndDropsNotices() {
        val now = Instant.parse("2026-11-04T10:00:00Z")
        val history = (1..20).map { i ->
            ChatMessage(role = if (i % 2 == 0) ChatRole.ASSISTANT else ChatRole.USER, text = "m$i", createdAt = now)
        } + ChatMessage(role = ChatRole.NOTICE, text = "notice", createdAt = now)
        val huge = "א".repeat(5_000)
        val req = RemoteBackendCoachProvider.buildRequest(history, huge, context)
        assertEquals(RemoteBackendCoachProvider.MAX_MESSAGES, req.messages.size)
        assertTrue(req.messages.none { it.text == "notice" })
        assertEquals("user", req.messages.last().role)
        assertEquals(RemoteBackendCoachProvider.MAX_MESSAGE_CHARS, req.messages.last().text.length)
        assertEquals("he", req.locale)
    }

    @Test
    fun requestDoesNotDuplicateAlreadyPersistedUserMessage() {
        val now = Instant.parse("2026-11-04T10:00:00Z")
        val history = listOf(ChatMessage(role = ChatRole.USER, text = "שאלה", createdAt = now))
        val req = RemoteBackendCoachProvider.buildRequest(history, "שאלה", context)
        assertEquals(1, req.messages.size)
    }

    @Test
    fun cleanTextStripsControlAndBidiOverrides() {
        val raw = "a\u0000b\u202Ec\u2066d\u200Fe\nf\u0085g"
        assertEquals("abcd\u200Fe\nfg", RemoteBackendCoachProvider.cleanText(raw, 100))
        // Never splits a surrogate pair.
        val emoji = "ab😀"
        assertEquals("ab", RemoteBackendCoachProvider.cleanText(emoji, 3))
    }

    @Test
    fun wireErrorKindsMapCaseInsensitively() {
        assertEquals(CoachErrorKind.RATE_LIMITED, RemoteBackendCoachProvider.errorKindFromWire("rate_limited"))
        assertEquals(CoachErrorKind.QUOTA_EXCEEDED, RemoteBackendCoachProvider.errorKindFromWire("QUOTA_EXCEEDED"))
        assertEquals(CoachErrorKind.BACKEND_UNAVAILABLE, RemoteBackendCoachProvider.errorKindFromWire("weird"))
        assertEquals(CoachErrorKind.BACKEND_UNAVAILABLE, RemoteBackendCoachProvider.errorKindFromWire(null))
    }

    private fun List<CoachChunk>.errors(): List<CoachErrorKind> = filterIsInstance<CoachChunk.Error>().map { it.kind }
}
