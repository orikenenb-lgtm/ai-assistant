package com.disciplineos.app.ai

import com.disciplineos.app.data.security.SecureStore
import com.disciplineos.core.domain.time.TimeProvider
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Build-time Supabase Auth configuration (from `BuildConfig.SUPABASE_URL` / `BuildConfig.SUPABASE_ANON_KEY`,
 * gradle properties `discipline.supabaseUrl` / `discipline.supabaseAnonKey`).
 *
 * [anonKey] is the project's **publishable ("anon") key**: it is public by design, meant to ship inside client apps,
 * and grants nothing beyond what Row Level Security allows. It is NOT a secret. The `service_role` key must never be
 * used here (it bypasses RLS) — it lives only in the server's environment.
 */
data class SupabaseAuthConfig(
    val supabaseUrl: String,
    val anonKey: String,
    val cleartextHostsAllowed: Set<String> = emptySet(),
) {
    /** Both values present → the Supabase token exchange is used; otherwise the install-id provider. */
    val isConfigured: Boolean get() = supabaseUrl.isNotBlank() && anonKey.isNotBlank()

    /** Validated project base URL (same rules as the AI backend: https only, no user-info/query/fragment). */
    fun baseUrl(): HttpUrl? = BackendUrlValidator.validateBase(supabaseUrl, cleartextHostsAllowed)

    // Never print the key (data class toString would): it is public, but keeping it out of logs is cheap hygiene.
    override fun toString(): String = "SupabaseAuthConfig(supabaseUrl=$supabaseUrl, anonKey=<${anonKey.length} chars>)"
}

/** Minimal key/value seam over [SecureStore] so the provider is testable on the JVM (SecureStore needs the Keystore). */
interface SecretStorage {
    suspend fun get(name: String): String?
    suspend fun put(name: String, value: String?)
}

class SecureStoreSecretStorage(private val secureStore: SecureStore) : SecretStorage {
    override suspend fun get(name: String): String? = secureStore.get(name)
    override suspend fun put(name: String, value: String?) = secureStore.put(name, value)
}

/**
 * Exchanges nothing-but-the-app for a short-lived Supabase Auth JWT via **anonymous sign-in**, so the AI backend
 * (`coach-stream`, which verifies Supabase JWTs) can identify a quota bucket without any account, e-mail or PII.
 *
 *  - Sign-up: `POST {SUPABASE_URL}/auth/v1/signup`, header `apikey: <anon key>`, body `{}` → anonymous user + session.
 *  - Refresh: `POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, body `{"refresh_token": "..."}`, when the
 *    access token expires within [REFRESH_MARGIN_SECONDS]. Refresh rejected with 400/401 (revoked / already used /
 *    user deleted) → a fresh anonymous sign-up. Transient failures (offline, 5xx, 429) → the still-valid access token
 *    if any, else null (the remote coach then reports NOT_CONFIGURED/OFFLINE and the local coach keeps working).
 *  - Session (access token, refresh token, expiry, project URL) is one JSON blob in [SecureStore]
 *    (AES-GCM, Keystore key) under [SESSION_KEY]; wiped by "delete all my data" (SecureStore.clearAll()).
 *  - A [Mutex] makes every check/refresh/sign-up single-flight: N concurrent callers → at most one network call.
 *  - HTTPS only (same validator as the AI backend); the dedicated AI OkHttpClient follows no redirects, so the
 *    anon key and refresh token never follow one. Tokens and keys are never logged or put in exception messages.
 */
@Singleton
class SupabaseAnonymousTokenProvider internal constructor(
    private val client: OkHttpClient,
    private val config: SupabaseAuthConfig,
    private val storage: SecretStorage,
    private val time: TimeProvider,
) : BackendTokenProvider {

    @Inject
    constructor(
        @Named(AI_HTTP_CLIENT) client: OkHttpClient,
        config: SupabaseAuthConfig,
        secureStore: SecureStore,
        time: TimeProvider,
    ) : this(client, config, SecureStoreSecretStorage(secureStore), time)

    private val mutex = Mutex()

    /** In-memory copy of the stored session; null until first loaded (or after it was found unusable). */
    private var cached: StoredSession? = null
    private var loadedFromStorage = false

    override suspend fun token(): String? = mutex.withLock {
        try {
            val base = config.baseUrl() ?: return@withLock null
            if (!config.isConfigured) return@withLock null
            val now = time.now().epochSecond
            val session = currentSession(base)
            if (session != null && session.expiresAt - now > REFRESH_MARGIN_SECONDS) return@withLock session.accessToken

            if (session != null) {
                when (val r = refresh(base, session.refreshToken)) {
                    is Outcome.Ok -> return@withLock save(r.session).accessToken
                    Outcome.Rejected -> clear() // refresh token unusable → fall through to a new anonymous user
                    Outcome.Transient -> return@withLock session.accessToken.takeIf { session.expiresAt > now }
                }
            }
            when (val r = signUp(base)) {
                is Outcome.Ok -> save(r.session).accessToken
                Outcome.Rejected, Outcome.Transient -> null
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Keystore/DataStore/parsing trouble: behave as "not configured"; never crash the coach screen.
            null
        }
    }

    /** The backend answered 401 for [rejectedToken]: force a refresh on the next [token] call. */
    override suspend fun invalidate(rejectedToken: String) = mutex.withLock {
        val s = cached ?: return@withLock
        if (s.accessToken == rejectedToken) cached = s.copy(expiresAt = 0)
    }

    // ---------- session storage ----------

    private suspend fun currentSession(base: HttpUrl): StoredSession? {
        if (!loadedFromStorage) {
            loadedFromStorage = true
            cached = try {
                storage.get(SESSION_KEY)?.let { json.decodeFromString(StoredSession.serializer(), it) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                null
            }
        }
        // A session of a different Supabase project (build re-pointed) is useless: start over.
        return cached?.takeIf { it.projectUrl == base.toString() && it.isWellFormed() }
    }

    private suspend fun save(session: StoredSession): StoredSession {
        cached = session
        try {
            storage.put(SESSION_KEY, json.encodeToString(StoredSession.serializer(), session))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Not persisted (Keystore issue): the in-memory session still works for this process.
        }
        return session
    }

    private suspend fun clear() {
        cached = null
        try {
            storage.put(SESSION_KEY, null)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // ignore
        }
    }

    // ---------- network ----------

    private sealed interface Outcome {
        data class Ok(val session: StoredSession) : Outcome
        /** The server refused the credentials (400/401/403/422): retrying the same request is pointless. */
        data object Rejected : Outcome
        /** Offline, timeout, 5xx, 429, malformed body: try again later. */
        data object Transient : Outcome
    }

    private suspend fun signUp(base: HttpUrl): Outcome =
        authCall(authUrl(base, SIGNUP_PATH).build(), EMPTY_JSON_BODY, base)

    private suspend fun refresh(base: HttpUrl, refreshToken: String): Outcome {
        val url = authUrl(base, TOKEN_PATH).addQueryParameter("grant_type", "refresh_token").build()
        val body = json.encodeToString(RefreshRequest.serializer(), RefreshRequest(refreshToken))
        return authCall(url, body, base)
    }

    private suspend fun authCall(url: HttpUrl, body: String, base: HttpUrl): Outcome {
        val request = Request.Builder()
            .url(url)
            .header("apikey", config.anonKey)
            .header("Accept", "application/json")
            .header("Cache-Control", "no-store")
            .post(body.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        val response = try {
            client.newCall(request).await()
        } catch (e: IOException) {
            return Outcome.Transient
        }
        return response.use { r ->
            when {
                r.isSuccessful -> parseSession(r, base)?.let { Outcome.Ok(it) } ?: Outcome.Transient
                r.code in REJECTED_CODES -> Outcome.Rejected
                else -> Outcome.Transient
            }
        }
    }

    private fun parseSession(response: Response, base: HttpUrl): StoredSession? {
        val text = try {
            response.peekBody(MAX_RESPONSE_BYTES).string()
        } catch (e: IOException) {
            return null
        }
        val parsed = try {
            json.decodeFromString(AuthResponse.serializer(), text)
        } catch (e: Exception) {
            return null
        }
        val access = parsed.accessToken ?: return null
        val refresh = parsed.refreshToken ?: return null
        val now = time.now().epochSecond
        val expiresAt = parsed.expiresAt
            ?: parsed.expiresIn?.let { now + it }
            ?: return null
        val session = StoredSession(base.toString(), access, refresh, expiresAt)
        return session.takeIf { it.isWellFormed() && expiresAt > now }
    }

    private fun authUrl(base: HttpUrl, path: String): HttpUrl.Builder =
        base.newBuilder().encodedPath(base.encodedPath.trimEnd('/') + path)

    companion object {
        /** Secure entry name for the session blob (SecureStore allows [A-Za-z0-9_.] names). */
        const val SESSION_KEY = "supabase_auth_session"
        const val SIGNUP_PATH = "/auth/v1/signup"
        const val TOKEN_PATH = "/auth/v1/token"
        /** Refresh when the access token expires within this many seconds. */
        const val REFRESH_MARGIN_SECONDS = 60L
        private const val MAX_RESPONSE_BYTES = 64L * 1024
        private const val EMPTY_JSON_BODY = "{}"
        private val REJECTED_CODES = setOf(400, 401, 403, 404, 422)
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        /** JWT shape (header.payload.signature, base64url) — also guarantees the value is a safe HTTP header. */
        private val JWT_FORMAT = Regex("^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$")
        /** Opaque refresh token: printable ASCII without spaces. */
        private val REFRESH_FORMAT = Regex("^[\\x21-\\x7E]+$")
        private const val MAX_ACCESS_CHARS = 8_192
        private const val MAX_REFRESH_CHARS = 2_048

        internal val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
        }

        private fun StoredSession.isWellFormed(): Boolean =
            accessToken.length <= MAX_ACCESS_CHARS && JWT_FORMAT.matches(accessToken) &&
                refreshToken.length <= MAX_REFRESH_CHARS && REFRESH_FORMAT.matches(refreshToken)
    }
}

/** Cancellable bridge from OkHttp's async API: cancelling the coroutine cancels the HTTP call. */
private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    cont.invokeOnCancellation { cancel() }
    enqueue(
        object : Callback {
            override fun onResponse(call: Call, response: Response) {
                if (cont.isActive) cont.resume(response) else response.close()
            }

            override fun onFailure(call: Call, e: IOException) {
                if (cont.isActive) cont.resumeWithException(e)
            }
        },
    )
}

@Serializable
internal data class StoredSession(
    @SerialName("project_url") val projectUrl: String,
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    /** Epoch seconds. */
    @SerialName("expires_at") val expiresAt: Long,
) {
    override fun toString(): String = "StoredSession(projectUrl=$projectUrl, expiresAt=$expiresAt)" // no tokens
}

@Serializable
private data class RefreshRequest(@SerialName("refresh_token") val refreshToken: String)

@Serializable
private data class AuthResponse(
    @SerialName("access_token") val accessToken: String? = null,
    @SerialName("refresh_token") val refreshToken: String? = null,
    @SerialName("expires_at") val expiresAt: Long? = null,
    @SerialName("expires_in") val expiresIn: Long? = null,
)
