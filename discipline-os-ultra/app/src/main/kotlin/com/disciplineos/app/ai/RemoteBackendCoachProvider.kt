package com.disciplineos.app.ai

import com.disciplineos.core.domain.coach.AiCoachRepository
import com.disciplineos.core.domain.coach.CoachChunk
import com.disciplineos.core.domain.coach.CoachContext
import com.disciplineos.core.domain.coach.CoachErrorKind
import com.disciplineos.core.model.ChatMessage
import com.disciplineos.core.model.ChatRole
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton
import kotlin.coroutines.cancellation.CancellationException

/**
 * Streams coach replies from the project's own AI proxy (reference: `backend/supabase/functions/coach-stream`).
 * The APK never holds a model-provider key: it authenticates per install/user with a bearer token from
 * [BackendTokenProvider], and the backend holds the provider key, enforces quota and validates actions.
 *
 * Contract: `POST {AI_BACKEND_URL}/v1/coach/stream`, JSON body [CoachStreamRequest], response `text/event-stream`:
 *  - `event: delta`  `data: {"text":"..."}`
 *  - `event: action` `data: {"json": {...}}` (object or JSON-encoded string; validated downstream by CoachActionValidator)
 *  - `event: error`  `data: {"kind":"rate_limited"}` (CoachErrorKind name, any case)
 *  - `event: done`   `data: {}`
 *
 * Security properties:
 *  - HTTPS only (see [BackendUrlValidator]); redirects disabled on the injected client so the token never follows one.
 *  - No body/header logging anywhere (no HttpLoggingInterceptor); error messages never contain content.
 *  - Bounded output: total streamed text and action count are capped; anything over → INVALID_RESPONSE.
 *  - Cancellation: collector cancellation → awaitClose → EventSource.cancel() → socket closed.
 *  - Auth: HTTP 401 → [BackendTokenProvider.invalidate] + exactly one retry with a fresh token; a second 401
 *    (or 403) → NOT_CONFIGURED. A 401 always precedes any SSE event, so the retry never duplicates output.
 *  - Certificate pinning: roadmap, not hardcoded — see docs/AI_SECURITY.md (pins must match a backend we do
 *    not yet operate; a wrong/rotated pin would brick the feature for every installed APK).
 */
@Singleton
class RemoteBackendCoachProvider @Inject constructor(
    @Named(AI_HTTP_CLIENT) private val client: OkHttpClient,
    private val config: AiBackendConfig,
    private val tokenProvider: BackendTokenProvider,
) : AiCoachRepository {

    override val providerName: String = PROVIDER_NAME

    private val eventSourceFactory: EventSource.Factory by lazy { EventSources.createFactory(client) }

    override fun streamReply(
        history: List<ChatMessage>,
        userMessage: String,
        context: CoachContext,
    ): Flow<CoachChunk> = callbackFlow<CoachChunk> {
        val terminated = AtomicBoolean(false)

        fun finish(chunk: CoachChunk) {
            if (terminated.compareAndSet(false, true)) {
                trySend(chunk)
                channel.close()
            }
        }

        val endpoint = config.streamEndpoint()
        if (endpoint == null) {
            finish(CoachChunk.Error(CoachErrorKind.NOT_CONFIGURED, "backend url missing or rejected"))
            awaitClose { }
            return@callbackFlow
        }

        val body = json.encodeToString(CoachStreamRequest.serializer(), buildRequest(history, userMessage, context))
        val textChars = AtomicInteger(0)
        val actionCount = AtomicInteger(0)
        val current = AtomicReference<EventSource?>(null)
        // Assigned below; declared first so the listener's 401 path can re-enter it.
        lateinit var start: suspend (attempt: Int) -> Unit

        fun listener(attempt: Int, token: String) = object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (terminated.get()) return
                when (type) {
                    "delta" -> {
                        val text = parseObject(data)?.stringField("text")
                        if (text == null) {
                            finish(CoachChunk.Error(CoachErrorKind.INVALID_RESPONSE, "malformed delta event"))
                        } else if (textChars.addAndGet(text.length) > MAX_TOTAL_TEXT_CHARS) {
                            finish(CoachChunk.Error(CoachErrorKind.INVALID_RESPONSE, "reply too long"))
                        } else if (text.isNotEmpty()) {
                            trySend(CoachChunk.TextDelta(text))
                        }
                    }
                    "action" -> {
                        val raw = parseObject(data)?.get("json")
                        val actionJson = when {
                            raw is JsonObject -> raw.toString()
                            raw is JsonPrimitive && raw.isString -> raw.content
                            else -> null
                        }
                        if (actionJson == null || actionJson.length > MAX_ACTION_JSON_CHARS) {
                            finish(CoachChunk.Error(CoachErrorKind.INVALID_RESPONSE, "malformed action event"))
                        } else if (actionCount.incrementAndGet() > MAX_ACTIONS) {
                            finish(CoachChunk.Error(CoachErrorKind.INVALID_RESPONSE, "too many actions"))
                        } else {
                            trySend(CoachChunk.ActionJson(actionJson))
                        }
                    }
                    "error" -> {
                        val kind = parseObject(data)?.stringField("kind")
                        finish(CoachChunk.Error(errorKindFromWire(kind), "backend error event"))
                    }
                    "done" -> finish(CoachChunk.Done)
                    // Unknown event types (e.g. "ping") are ignored for forward compatibility.
                    else -> Unit
                }
            }

            override fun onClosed(eventSource: EventSource) {
                // Server closed the stream without `done`: treat as a truncated reply.
                finish(CoachChunk.Error(CoachErrorKind.BACKEND_UNAVAILABLE, "stream ended without done"))
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                // A 401 arrives before any event (HTTP status of the stream request), so nothing was emitted yet and
                // one transparent retry with a fresh token is safe. The quota was not consumed (auth precedes quota).
                if (response?.code == 401 && attempt < MAX_AUTH_RETRIES && !terminated.get()) {
                    launch {
                        try {
                            tokenProvider.invalidate(token)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            // Invalidation is best effort; the retry below then fails with NOT_CONFIGURED as before.
                        }
                        start(attempt + 1)
                    }
                    return
                }
                finish(CoachChunk.Error(mapFailure(t, response), failureMessage(t, response)))
            }
        }

        start = { attempt ->
            val token = try {
                tokenProvider.token()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                null
            }
            if (token.isNullOrBlank()) {
                finish(CoachChunk.Error(CoachErrorKind.NOT_CONFIGURED, "no backend token"))
            } else if (isActive && !terminated.get()) {
                val request = Request.Builder()
                    .url(endpoint)
                    .header("Authorization", "Bearer $token")
                    .header("Accept", "text/event-stream")
                    .header("Cache-Control", "no-store")
                    .post(body.toRequestBody(JSON_MEDIA_TYPE))
                    .build()
                val es = eventSourceFactory.newEventSource(request, listener(attempt, token))
                current.set(es)
                // Collector cancelled while we were creating the call: don't leak it.
                if (!isActive) es.cancel()
            }
        }

        start(0)
        awaitClose { current.get()?.cancel() }
    }.buffer(Channel.UNLIMITED) // bounded in practice by MAX_TOTAL_TEXT_CHARS / MAX_ACTIONS

    companion object {
        const val PROVIDER_NAME = "remote-backend"
        const val LOCALE = "he"
        const val MAX_MESSAGES = 12
        const val MAX_MESSAGE_CHARS = 2_000
        const val MAX_TITLE_CHARS = 120
        const val MAX_TITLES_PER_LIST = 30
        const val MAX_APP_USAGE_CHARS = 500
        const val MAX_TOTAL_TEXT_CHARS = 16_000
        const val MAX_ACTIONS = 5
        const val MAX_ACTION_JSON_CHARS = 4_000
        /** One transparent retry after HTTP 401 with a freshly obtained token (expired/revoked JWT). */
        const val MAX_AUTH_RETRIES = 1

        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        internal val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            encodeDefaults = true
        }

        /** Builds the minimal request body. NOTICE messages are local UI notes and are never sent. */
        internal fun buildRequest(history: List<ChatMessage>, userMessage: String, context: CoachContext): CoachStreamRequest {
            val wire = history.mapNotNull { msg ->
                when (msg.role) {
                    ChatRole.USER -> WireMessage("user", msg.text)
                    ChatRole.ASSISTANT -> WireMessage("assistant", msg.text)
                    ChatRole.NOTICE -> null
                }
            }.toMutableList()
            // The use case may already have persisted the user message into history; don't send it twice.
            val last = wire.lastOrNull()
            if (!(last != null && last.role == "user" && last.text == userMessage)) {
                wire += WireMessage("user", userMessage)
            }
            val messages = wire
                .takeLast(MAX_MESSAGES)
                .map { it.copy(text = cleanText(it.text, MAX_MESSAGE_CHARS)) }
                .filter { it.text.isNotBlank() }
            return CoachStreamRequest(
                messages = messages,
                context = WireContext(
                    localDate = context.localDateIso.take(10),
                    pendingMandatoryTitles = context.pendingMandatoryTitles.take(MAX_TITLES_PER_LIST)
                        .map { cleanText(it, MAX_TITLE_CHARS) },
                    pendingOptionalTitles = context.pendingOptionalTitles.take(MAX_TITLES_PER_LIST)
                        .map { cleanText(it, MAX_TITLE_CHARS) },
                    completedTodayCount = context.completedTodayCount.coerceAtLeast(0),
                    streakDays = context.streakDays.coerceAtLeast(0),
                    focusMinutesToday = context.focusMinutesToday.coerceAtLeast(0),
                    appUsageSummary = context.appUsageSummary?.let { cleanText(it, MAX_APP_USAGE_CHARS) },
                    pendingTasks = context.pendingTasks
                        .filter { it.id > 0 }
                        .distinctBy { it.id }
                        .take(MAX_TITLES_PER_LIST)
                        .map {
                            WireTaskRef(
                                id = it.id,
                                title = cleanText(it.title, MAX_TITLE_CHARS),
                                mandatory = it.mandatory,
                                date = it.date.take(10),
                            )
                        },
                ),
                locale = LOCALE,
            )
        }

        /**
         * Strips C0/C1 control characters (except \n and \t) and bidi override/isolate characters
         * (U+202A–U+202E, U+2066–U+2069) that can visually hide injected text; caps length without
         * splitting a surrogate pair. LRM/RLM (U+200E/U+200F) are kept: legitimate in Hebrew text.
         * The backend applies the same filter; this is defence in depth, not the primary control.
         */
        internal fun cleanText(raw: String, maxChars: Int): String {
            val sb = StringBuilder(minOf(raw.length, maxChars))
            for (c in raw) {
                if (sb.length >= maxChars) break
                val code = c.code
                val isControl = (code < 0x20 && c != '\n' && c != '\t') || code in 0x7F..0x9F
                val isBidiOverride = code in 0x202A..0x202E || code in 0x2066..0x2069
                if (!isControl && !isBidiOverride) sb.append(c)
            }
            if (sb.isNotEmpty() && Character.isHighSurrogate(sb[sb.length - 1])) sb.setLength(sb.length - 1)
            return sb.toString().trim()
        }

        internal fun errorKindFromWire(kind: String?): CoachErrorKind =
            CoachErrorKind.entries.firstOrNull { it.name.equals(kind?.trim(), ignoreCase = true) }
                ?: CoachErrorKind.BACKEND_UNAVAILABLE

        internal fun mapHttpStatus(code: Int): CoachErrorKind = when (code) {
            401, 403 -> CoachErrorKind.NOT_CONFIGURED
            402 -> CoachErrorKind.QUOTA_EXCEEDED
            429 -> CoachErrorKind.RATE_LIMITED
            in 200..299 -> CoachErrorKind.INVALID_RESPONSE
            else -> CoachErrorKind.BACKEND_UNAVAILABLE
        }

        internal fun mapFailure(t: Throwable?, response: Response?): CoachErrorKind = when {
            response != null && !response.isSuccessful -> mapHttpStatus(response.code)
            // Connection never established, or dropped mid-stream (incl. timeouts).
            t is IOException -> CoachErrorKind.OFFLINE
            // 2xx but wrong content-type, or an unexpected parser failure.
            response != null -> CoachErrorKind.INVALID_RESPONSE
            else -> CoachErrorKind.BACKEND_UNAVAILABLE
        }

        /** Never includes request/response bodies or headers — only status code / exception class. */
        private fun failureMessage(t: Throwable?, response: Response?): String = when {
            response != null && !response.isSuccessful -> "http ${response.code}"
            t != null -> t.javaClass.simpleName
            response != null -> "unexpected response"
            else -> "unknown failure"
        }

        private fun parseObject(data: String): JsonObject? =
            try {
                json.parseToJsonElement(data).jsonObject
            } catch (e: Exception) {
                null
            }

        private fun JsonObject.stringField(name: String): String? =
            (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content
    }
}

@Serializable
internal data class WireMessage(val role: String, val text: String)

@Serializable
internal data class WireContext(
    val localDate: String,
    val pendingMandatoryTitles: List<String>,
    val pendingOptionalTitles: List<String>,
    val completedTodayCount: Int,
    val streakDays: Int,
    val focusMinutesToday: Int,
    val appUsageSummary: String? = null,
    /** Pending tasks the model may propose to reschedule (ids are local integers; titles follow shareTaskTitles). */
    val pendingTasks: List<WireTaskRef> = emptyList(),
)

@Serializable
internal data class WireTaskRef(
    val id: Long,
    val title: String,
    val mandatory: Boolean,
    val date: String,
)

@Serializable
internal data class CoachStreamRequest(
    val messages: List<WireMessage>,
    val context: WireContext,
    val locale: String,
)
