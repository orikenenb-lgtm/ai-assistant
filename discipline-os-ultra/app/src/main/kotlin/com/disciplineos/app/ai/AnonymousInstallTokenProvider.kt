package com.disciplineos.app.ai

import com.disciplineos.app.data.security.SecureStore
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.security.SecureRandom
import java.util.Base64
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.cancellation.CancellationException

/**
 * Per-install anonymous token: a random 256-bit id generated once and kept in the Keystore-backed [SecureStore].
 * It identifies an installation (for quota) without identifying a person. No account, no login, no PII.
 *
 * Fallback provider: [com.disciplineos.app.di.AiModule] uses it only when the build has no Supabase Auth
 * configuration (`discipline.supabaseUrl` / `discipline.supabaseAnonKey`). The reference backend
 * (`backend/supabase/functions/coach-stream`) verifies a Supabase Auth JWT, so with this provider it answers
 * 401 → NOT_CONFIGURED and the app keeps working with the local coach. With Supabase configured,
 * [SupabaseAnonymousTokenProvider] exchanges an anonymous sign-in for a short-lived JWT instead.
 * See docs/AI_SECURITY.md §"אימות".
 */
@Singleton
class AnonymousInstallTokenProvider @Inject constructor(
    private val secureStore: SecureStore,
) : BackendTokenProvider {

    private val mutex = Mutex()
    private val random = SecureRandom()

    override suspend fun token(): String? = mutex.withLock {
        try {
            val existing = secureStore.get(KEY_INSTALL_ID)
            if (existing != null && TOKEN_FORMAT.matches(existing)) return@withLock existing
            val fresh = newInstallId()
            secureStore.put(KEY_INSTALL_ID, fresh)
            fresh
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Keystore unavailable/corrupted → behave as "not configured"; never crash the coach screen.
            null
        }
    }

    private fun newInstallId(): String {
        val bytes = ByteArray(32)
        random.nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    companion object {
        /** Reuses agent E's well-known entry name; wiped by SecureStore.clearAll() ("delete all my data"). */
        const val KEY_INSTALL_ID = SecureStore.BACKEND_DEVICE_TOKEN
        /** 32 bytes, base64url without padding = 43 chars. */
        private val TOKEN_FORMAT = Regex("^[A-Za-z0-9_-]{43}$")
    }
}
