package com.disciplineos.app.ai

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import javax.inject.Qualifier

/**
 * Build-time AI backend configuration, provided by [com.disciplineos.app.di.AiModule] from BuildConfig so that
 * JVM tests never touch BuildConfig.
 *
 * @property baseUrl `BuildConfig.AI_BACKEND_URL` (gradle property `discipline.aiBackendUrl`). Blank = no backend;
 *   the app then uses only the offline LocalDemoCoachProvider. It is a URL, never a secret.
 * @property cleartextHostsAllowed hosts for which plain `http://` is tolerated. Production: empty.
 *   Debug builds: `10.0.2.2` (the Android emulator's alias for the developer machine running `supabase functions serve`).
 */
data class AiBackendConfig(
    val baseUrl: String,
    val cleartextHostsAllowed: Set<String> = emptySet(),
) {
    val isConfigured: Boolean get() = baseUrl.isNotBlank()

    /** The validated streaming endpoint, or null when [baseUrl] is blank or fails [BackendUrlValidator]. */
    fun streamEndpoint(): HttpUrl? = BackendUrlValidator.streamEndpoint(baseUrl, cleartextHostsAllowed)

    companion object {
        const val EMULATOR_HOST = "10.0.2.2"
    }
}

/**
 * Validates the backend base URL. Rules:
 *  - must parse as an absolute http(s) URL;
 *  - `https` always; `http` only for a host in `cleartextHostsAllowed` (debug emulator only);
 *  - no user-info (credentials in URLs leak via logs/crash reports), no query, no fragment.
 * The contract path `/v1/coach/stream` is appended to the base path.
 */
object BackendUrlValidator {
    const val STREAM_PATH = "/v1/coach/stream"

    fun validateBase(baseUrl: String, cleartextHostsAllowed: Set<String> = emptySet()): HttpUrl? {
        val trimmed = baseUrl.trim()
        if (trimmed.isEmpty()) return null
        val url = trimmed.toHttpUrlOrNull() ?: return null
        if (url.username.isNotEmpty() || url.password.isNotEmpty()) return null
        if (url.encodedQuery != null || url.encodedFragment != null) return null
        return when (url.scheme) {
            "https" -> url
            "http" -> url.takeIf { it.host in cleartextHostsAllowed }
            else -> null
        }
    }

    fun streamEndpoint(baseUrl: String, cleartextHostsAllowed: Set<String> = emptySet()): HttpUrl? {
        val base = validateBase(baseUrl, cleartextHostsAllowed) ?: return null
        val path = base.encodedPath.trimEnd('/') + STREAM_PATH
        return base.newBuilder().encodedPath(path).build()
    }
}

/** `@Named` value of the dedicated AI OkHttpClient provided by AiModule. */
const val AI_HTTP_CLIENT = "ai"

/** Qualifier for the offline rule-based provider (LocalDemoCoachProvider). */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class LocalCoach

/** Qualifier for the remote proxy provider (RemoteBackendCoachProvider). */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class RemoteCoach
