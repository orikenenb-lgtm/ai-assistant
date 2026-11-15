package ai.noa.bridge.app.platform

import ai.noa.bridge.core.DraftEngineClient
import ai.noa.bridge.core.DraftRequest
import ai.noa.bridge.core.DraftResult
import ai.noa.bridge.core.SafetyFlags
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CertificatePinner
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Base URL + device token used for authenticated calls, plus the optional SPKI pin
 * (`sha256/<base64>`) the user entered when pairing. Null pin = system CAs only.
 */
data class ApiCredentials(val baseUrl: String, val deviceToken: String, val spkiPin: String? = null) {
    override fun toString(): String = "ApiCredentials(***)"
}

sealed interface PairOutcome {
    data class Success(val deviceId: String, val deviceToken: String) : PairOutcome {
        override fun toString(): String = "PairOutcome.Success(***)"
    }
    data class Failure(val messageHebrew: String, val httpStatus: Int?) : PairOutcome
}

data class HealthInfo(val ok: Boolean, val enabled: Boolean, val engine: String?, val version: String?)

/**
 * Client of the bridge backend, exactly per API_CONTRACT.md (v1).
 *
 * - Every authenticated call sends `Authorization: Bearer`, `X-Bridge-Timestamp` (epoch millis) and
 *   a fresh `X-Bridge-Nonce` (UUID v4). `/health` and `/v1/pair` are unauthenticated.
 * - HTTPS only. `http://` is accepted only for 10.0.2.2 / localhost / 127.0.0.1 when
 *   [allowDebugCleartext] (wired to BuildConfig.DEBUG). The network security config enforces the
 *   same rule at the OS level.
 * - Bodies are never logged (no logging interceptor); errors are logged as status codes only.
 * - OkHttp's silent connection retry is OFF: a re-sent request would reuse the nonce and be
 *   rejected as a replay (409). Redirects are OFF so the bearer token is never forwarded.
 * - Certificate pinning (optional, S-M5): when the user entered an SPKI pin at pairing time, every
 *   call to that host goes through a client with a [CertificatePinner] for exactly that host and pin
 *   ([clientFor]); without a pin only the system CAs are trusted (network security config). The
 *   [certificatePinner] constructor hook still exists for a build-time pin.
 * - `conversation_ref` is sent exactly as given in [DraftRequest.conversationKey]. The production
 *   controller passes an HMAC of the local key with a per-install secret ([ConversationRefs]), never
 *   the local key itself.
 */
class BridgeApiClient(
    private val credentials: () -> ApiCredentials?,
    private val allowDebugCleartext: Boolean,
    httpClient: OkHttpClient? = null,
    certificatePinner: CertificatePinner? = null,
    private val clockMillis: () -> Long = System::currentTimeMillis,
    private val nonceGenerator: () -> String = { UUID.randomUUID().toString() },
    private val locale: String = "he",
    /** Called when the server answers 401 (token revoked/invalid) so the UI can ask to re-pair. */
    private val onUnauthorized: () -> Unit = {},
) : DraftEngineClient {

    private val client: OkHttpClient = httpClient ?: defaultClientBuilder().apply {
        if (certificatePinner != null) certificatePinner(certificatePinner)
    }.build()

    /** (host, pin) → pinned client. newBuilder() shares the connection pool and dispatcher. */
    @Volatile
    private var pinned: Triple<String, String, OkHttpClient>? = null

    /**
     * The client for a call to [url]: the base client, or — when [spkiPin] is set — a client whose
     * CertificatePinner pins exactly [url]'s host to that SPKI hash. An invalid pin never reaches
     * here (pairing rejects it); if one does, it fails closed (IllegalArgumentException → no call).
     */
    internal fun clientFor(url: HttpUrl, spkiPin: String?): OkHttpClient {
        val pin = spkiPin?.takeIf { it.isNotBlank() } ?: return client
        pinned?.let { (host, p, c) -> if (host == url.host && p == pin) return c }
        val built = client.newBuilder()
            .certificatePinner(CertificatePinner.Builder().add(url.host, pin).build())
            .build()
        pinned = Triple(url.host, pin, built)
        return built
    }

    override suspend fun requestDraft(request: DraftRequest): DraftResult {
        val creds = credentials() ?: return DraftResult.Failure(MSG_NOT_PAIRED, retryable = false)
        val base = validateBaseUrl(creds.baseUrl, allowDebugCleartext)
            ?: return DraftResult.Failure(MSG_BAD_URL, retryable = false).also { SafeLog.w(SafeLog.Event.API_REFUSED_URL) }
        val body = buildDraftBody(request, locale)
            ?: return DraftResult.Failure(MSG_INVALID_REQUEST, retryable = false)

        val httpRequest = authenticated(Request.Builder().url(base.resolvePath("v1/drafts")), creds)
            .post(json.encodeToString(DraftRequestBody.serializer(), body).toRequestBody(JSON))
            .build()

        return try {
            clientFor(base, creds.spkiPin).newCall(httpRequest).await().use { response ->
                if (!response.isSuccessful) {
                    SafeLog.w(SafeLog.Event.API_HTTP_ERROR, response.code)
                    if (response.code == 401) onUnauthorized()
                    return draftFailureFor(response.code)
                }
                val parsed = try {
                    json.decodeFromString(DraftResponseBody.serializer(), response.body?.string().orEmpty())
                } catch (e: SerializationException) {
                    SafeLog.e(SafeLog.Event.API_BAD_RESPONSE, e)
                    return DraftResult.Failure(MSG_BAD_RESPONSE, retryable = true)
                } catch (e: IllegalArgumentException) {
                    SafeLog.e(SafeLog.Event.API_BAD_RESPONSE, e)
                    return DraftResult.Failure(MSG_BAD_RESPONSE, retryable = true)
                }
                if (parsed.requestId != body.requestId || parsed.draftText.isBlank()) {
                    SafeLog.w(SafeLog.Event.API_BAD_RESPONSE)
                    return DraftResult.Failure(MSG_BAD_RESPONSE, retryable = true)
                }
                DraftResult.Success(
                    text = parsed.draftText,
                    safety = SafetyFlags(
                        injectionSuspected = parsed.safety.injectionSuspected,
                        sensitiveRequest = parsed.safety.sensitiveRequest,
                        notes = parsed.safety.notes,
                    ),
                    engine = parsed.engine,
                )
            }
        } catch (e: IOException) {
            SafeLog.e(SafeLog.Event.API_IO_ERROR, e)
            DraftResult.Failure(MSG_UNAVAILABLE, retryable = true)
        }
    }

    /** POST /v1/pair. With [spkiPin], the pairing call itself is already pinned (no trust-on-first-use gap). */
    suspend fun pair(baseUrl: String, pairingCode: String, deviceName: String, spkiPin: String? = null): PairOutcome {
        val base = validateBaseUrl(baseUrl, allowDebugCleartext)
            ?: return PairOutcome.Failure(MSG_BAD_URL, null).also { SafeLog.w(SafeLog.Event.API_REFUSED_URL) }
        val code = normalizePairingCode(pairingCode) ?: return PairOutcome.Failure(MSG_BAD_CODE_FORMAT, null)
        val pin = if (spkiPin.isNullOrBlank()) null else normalizeSpkiPin(spkiPin) ?: return PairOutcome.Failure(MSG_BAD_PIN, null)
        val body = PairRequestBody(pairingCode = code, deviceName = truncateText(deviceName.trim(), MAX_DEVICE_NAME).ifEmpty { "Android" })
        val request = Request.Builder().url(base.resolvePath("v1/pair"))
            .post(json.encodeToString(PairRequestBody.serializer(), body).toRequestBody(JSON))
            .build()
        return try {
            clientFor(base, pin).newCall(request).await().use { response ->
                if (!response.isSuccessful) {
                    SafeLog.w(SafeLog.Event.API_HTTP_ERROR, response.code)
                    return PairOutcome.Failure(pairFailureMessage(response.code), response.code)
                }
                val parsed = try {
                    json.decodeFromString(PairResponseBody.serializer(), response.body?.string().orEmpty())
                } catch (e: SerializationException) {
                    SafeLog.e(SafeLog.Event.API_BAD_RESPONSE, e)
                    return PairOutcome.Failure(MSG_BAD_RESPONSE, response.code)
                } catch (e: IllegalArgumentException) {
                    SafeLog.e(SafeLog.Event.API_BAD_RESPONSE, e)
                    return PairOutcome.Failure(MSG_BAD_RESPONSE, response.code)
                }
                if (parsed.deviceToken.isBlank()) return PairOutcome.Failure(MSG_BAD_RESPONSE, response.code)
                PairOutcome.Success(parsed.deviceId, parsed.deviceToken)
            }
        } catch (e: IOException) {
            SafeLog.e(SafeLog.Event.API_IO_ERROR, e)
            PairOutcome.Failure(MSG_UNAVAILABLE, null)
        }
    }

    /**
     * POST /v1/devices/revoke. Returns true on 204/2xx. Best effort: never throws. Bounded by an
     * OkHttp call timeout of [timeoutMillis] (a wall-clock bound, unlike a coroutine timeout).
     */
    suspend fun revoke(timeoutMillis: Long = REVOKE_TIMEOUT_MILLIS): Boolean {
        val creds = credentials() ?: return false
        val base = validateBaseUrl(creds.baseUrl, allowDebugCleartext) ?: return false
        val request = authenticated(Request.Builder().url(base.resolvePath("v1/devices/revoke")), creds)
            .post(EMPTY_BODY)
            .build()
        return try {
            val call = clientFor(base, creds.spkiPin).newCall(request)
            call.timeout().timeout(timeoutMillis, TimeUnit.MILLISECONDS)
            call.await().use { response ->
                if (!response.isSuccessful) SafeLog.w(SafeLog.Event.API_HTTP_ERROR, response.code)
                response.isSuccessful
            }
        } catch (e: IOException) {
            SafeLog.e(SafeLog.Event.API_IO_ERROR, e)
            false
        }
    }

    /** GET /health (no auth). Null when unreachable or malformed. */
    suspend fun health(baseUrl: String, spkiPin: String? = null): HealthInfo? {
        val base = validateBaseUrl(baseUrl, allowDebugCleartext) ?: return null
        val request = Request.Builder().url(base.resolvePath("health")).get().build()
        return try {
            clientFor(base, spkiPin).newCall(request).await().use { response ->
                if (!response.isSuccessful) {
                    SafeLog.w(SafeLog.Event.API_HTTP_ERROR, response.code)
                    return null
                }
                val parsed = json.decodeFromString(HealthBody.serializer(), response.body?.string().orEmpty())
                HealthInfo(parsed.ok, parsed.enabled, parsed.engine, parsed.version)
            }
        } catch (e: IOException) {
            SafeLog.e(SafeLog.Event.API_IO_ERROR, e)
            null
        } catch (e: SerializationException) {
            SafeLog.e(SafeLog.Event.API_BAD_RESPONSE, e)
            null
        } catch (e: IllegalArgumentException) {
            SafeLog.e(SafeLog.Event.API_BAD_RESPONSE, e)
            null
        }
    }

    private fun authenticated(builder: Request.Builder, creds: ApiCredentials): Request.Builder = builder
        .header("Authorization", "Bearer ${creds.deviceToken}")
        .header(HEADER_TIMESTAMP, clockMillis().toString())
        .header(HEADER_NONCE, nonceGenerator())

    companion object {
        const val HEADER_TIMESTAMP = "X-Bridge-Timestamp"
        const val HEADER_NONCE = "X-Bridge-Nonce"

        const val MAX_MESSAGES = 20
        const val MAX_TEXT = 2_000
        const val MAX_TOTAL = 8_000
        const val MAX_SENDER = 80
        const val MAX_DEVICE_NAME = 60
        const val REVOKE_TIMEOUT_MILLIS = 10_000L

        const val MSG_UNAUTHORIZED = "החיבור לשרת בוטל — יש לחבר מחדש"
        const val MSG_REPLAY = "שגיאת סנכרון זמן מול השרת — בדוק שהשעון בטלפון מדויק"
        const val MSG_TOO_LARGE = "ההודעות ארוכות מדי לעיבוד"
        const val MSG_INVALID_REQUEST = "הבקשה לשרת לא תקינה"
        const val MSG_RATE_LIMITED = "יותר מדי בקשות, נסה שוב בעוד דקה"
        const val MSG_DISABLED = "השרת כבוי כרגע"
        const val MSG_UNAVAILABLE = "השרת לא זמין"
        const val MSG_REJECTED = "השרת דחה את הבקשה"
        const val MSG_BAD_RESPONSE = "התקבלה תשובה לא תקינה מהשרת"
        const val MSG_NOT_PAIRED = "המכשיר אינו מחובר לשרת"
        /** The URL is an LTR isolate (U+2066…U+2069) so "://" is not reordered inside the Hebrew text. */
        const val MSG_BAD_URL = "כתובת השרת חייבת להתחיל ב־\u2066https://\u2069"
        const val MSG_BAD_PIN = "טביעת האצבע של המפתח הציבורי לא תקינה (צריך \u2066sha256/\u2069 ואחריו 44 תווי Base64)"
        const val MSG_BAD_CODE_FORMAT = "קוד החיבור צריך להכיל 8 תווים (אותיות לועזיות וספרות)"
        const val MSG_BAD_CODE = "קוד החיבור לא תקין או שפג תוקפו"
        const val MSG_WRONG_ENDPOINT = "כתובת השרת שגויה — בדוק את הכתובת"

        private val JSON = "application/json; charset=utf-8".toMediaType()
        private val EMPTY_BODY: RequestBody = ByteArray(0).toRequestBody(null)
        private val CONVERSATION_REF = Regex("^[0-9a-f]{64}$")
        private val UUID_V4 = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
        private const val PIN_PREFIX = "sha256/"
        private const val PAIRING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
        private val DEBUG_CLEARTEXT_HOSTS = setOf("10.0.2.2", "localhost", "127.0.0.1")

        internal val json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
            explicitNulls = false
        }

        fun defaultClientBuilder(): OkHttpClient.Builder = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .callTimeout(40, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .followRedirects(false)
            .followSslRedirects(false)

        /**
         * Accepts `https://host[:port][/path]`. `http://` only for the emulator/loopback hosts and only
         * when [allowDebugCleartext]. Rejects user-info, query and fragment.
         */
        fun validateBaseUrl(raw: String, allowDebugCleartext: Boolean): HttpUrl? {
            val url = raw.trim().toHttpUrlOrNull() ?: return null
            if (url.username.isNotEmpty() || url.password.isNotEmpty()) return null
            if (url.query != null || url.fragment != null) return null
            return when (url.scheme) {
                "https" -> url
                "http" -> url.takeIf { allowDebugCleartext && url.host in DEBUG_CLEARTEXT_HOSTS }
                else -> null
            }
        }

        /**
         * Normalizes an SPKI pin to OkHttp's `sha256/<base64>` form. Accepts the bare base64 or the
         * `sha256/` prefix (any case), surrounding whitespace ignored. The base64 must decode to
         * exactly 32 bytes (a SHA-256). Returns null for anything else (blank included).
         */
        fun normalizeSpkiPin(raw: String): String? {
            val trimmed = raw.trim()
            val b64 = if (trimmed.startsWith(PIN_PREFIX, ignoreCase = true)) trimmed.substring(PIN_PREFIX.length) else trimmed
            if (b64.isEmpty() || b64.any { it.isWhitespace() }) return null
            val bytes = try {
                java.util.Base64.getDecoder().decode(b64)
            } catch (e: IllegalArgumentException) {
                return null
            }
            if (bytes.size != 32) return null
            return PIN_PREFIX + java.util.Base64.getEncoder().encodeToString(bytes)
        }

        /**
         * Cuts [text] to at most [maxUtf16] UTF-16 units on a user-perceived character boundary
         * (BreakIterator character instance), so a surrogate pair or an emoji / ZWJ sequence is never
         * split into a lone surrogate (QA-03). The result is also at most [maxUtf16] code points.
         */
        internal fun truncateText(text: String, maxUtf16: Int): String {
            if (text.length <= maxUtf16) return text
            val it = java.text.BreakIterator.getCharacterInstance()
            it.setText(text)
            var cut = it.preceding(maxUtf16 + 1).coerceAtLeast(0) // DONE (-1) → 0
            // Runtimes without extended grapheme clusters break after a ZERO WIDTH JOINER: never end
            // on one (it would leave half of a ZWJ emoji sequence).
            while (cut > 0 && text[cut - 1] == '\u200D') cut = it.preceding(cut).coerceAtLeast(0)
            // Belt and braces for runtimes whose BreakIterator is not surrogate-aware.
            if (cut > 0 && Character.isHighSurrogate(text[cut - 1])) cut--
            return text.substring(0, cut)
        }

        fun normalizePairingCode(raw: String): String? {
            val code = raw.trim().uppercase().replace("-", "").replace(" ", "")
            return code.takeIf { it.length == 8 && it.all { c -> c in PAIRING_ALPHABET } }
        }

        /** Applies the contract limits; null when nothing valid remains (the call is then not made). */
        internal fun buildDraftBody(request: DraftRequest, locale: String): DraftRequestBody? {
            val ref = request.conversationKey.value
            if (!CONVERSATION_REF.matches(ref)) return null
            // v1.1: request_id must be a UUID v4 (the server answers 422 otherwise).
            if (!UUID_V4.matches(request.requestId)) return null
            val lines = request.messages
                .map { MessageBody(text = truncateText(it.text.trim(), MAX_TEXT), sentAt = it.timestampMillis) }
                .filter { it.text.isNotEmpty() }
                .takeLast(MAX_MESSAGES)
                .toMutableList()
            // Keep the newest lines when over the total budget.
            while (lines.isNotEmpty() && lines.sumOf { it.text.length } > MAX_TOTAL) lines.removeAt(0)
            if (lines.isEmpty()) return null
            return DraftRequestBody(
                requestId = request.requestId,
                conversationRef = ref,
                senderDisplayName = truncateText(request.senderDisplayName.trim(), MAX_SENDER),
                messages = lines,
                locale = locale,
            )
        }

        internal fun draftFailureFor(code: Int): DraftResult.Failure = when (code) {
            401 -> DraftResult.Failure(MSG_UNAUTHORIZED, retryable = false)
            409 -> DraftResult.Failure(MSG_REPLAY, retryable = true)
            413 -> DraftResult.Failure(MSG_TOO_LARGE, retryable = false)
            422 -> DraftResult.Failure(MSG_INVALID_REQUEST, retryable = false)
            429 -> DraftResult.Failure(MSG_RATE_LIMITED, retryable = true)
            503 -> DraftResult.Failure(MSG_DISABLED, retryable = false)
            404, 405 -> DraftResult.Failure(MSG_WRONG_ENDPOINT, retryable = false)
            in 500..599 -> DraftResult.Failure(MSG_UNAVAILABLE, retryable = true)
            else -> DraftResult.Failure(MSG_REJECTED, retryable = false)
        }

        internal fun pairFailureMessage(code: Int): String = when (code) {
            400 -> MSG_BAD_CODE
            429 -> MSG_RATE_LIMITED
            503 -> MSG_DISABLED
            404, 405 -> MSG_WRONG_ENDPOINT
            in 500..599 -> MSG_UNAVAILABLE
            else -> MSG_REJECTED
        }

        private fun HttpUrl.resolvePath(path: String): HttpUrl {
            val builder = newBuilder()
            // Drop a trailing empty segment ("https://host/" or "https://host/bridge/").
            if (pathSegments.lastOrNull() == "") builder.removePathSegment(pathSegments.size - 1)
            return builder.addPathSegments(path).build()
        }
    }
}

private suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) {
            continuation.resume(response) { _, value, _ -> value.close() }
        }

        override fun onFailure(call: Call, e: IOException) {
            if (continuation.isActive) continuation.resumeWithException(e)
        }
    })
}

@Serializable
internal data class DraftRequestBody(
    @SerialName("request_id") val requestId: String,
    @SerialName("conversation_ref") val conversationRef: String,
    @SerialName("sender_display_name") val senderDisplayName: String,
    @SerialName("messages") val messages: List<MessageBody>,
    @SerialName("locale") val locale: String,
) {
    override fun toString(): String = "DraftRequestBody(***)"
}

@Serializable
internal data class MessageBody(
    @SerialName("text") val text: String,
    @SerialName("sent_at") val sentAt: Long,
) {
    override fun toString(): String = "MessageBody(***)"
}

@Serializable
internal data class DraftResponseBody(
    @SerialName("request_id") val requestId: String,
    @SerialName("draft_text") val draftText: String,
    @SerialName("safety") val safety: SafetyBody = SafetyBody(),
    @SerialName("engine") val engine: String = "unknown",
)

@Serializable
internal data class SafetyBody(
    @SerialName("injection_suspected") val injectionSuspected: Boolean = false,
    @SerialName("sensitive_request") val sensitiveRequest: Boolean = false,
    @SerialName("notes") val notes: List<String> = emptyList(),
)

@Serializable
internal data class PairRequestBody(
    @SerialName("pairing_code") val pairingCode: String,
    @SerialName("device_name") val deviceName: String,
)

@Serializable
internal data class PairResponseBody(
    @SerialName("device_id") val deviceId: String,
    @SerialName("device_token") val deviceToken: String,
)

@Serializable
internal data class HealthBody(
    @SerialName("ok") val ok: Boolean = false,
    @SerialName("enabled") val enabled: Boolean = false,
    @SerialName("engine") val engine: String? = null,
    @SerialName("version") val version: String? = null,
)
