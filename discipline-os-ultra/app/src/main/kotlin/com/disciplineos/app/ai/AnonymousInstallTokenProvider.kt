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
 * DEPLOYMENT NOTE (not implemented on purpose): the reference backend (`backend/supabase/functions/coach-stream`)
 * verifies a Supabase Auth JWT. A real deployment should exchange this install id for a short-lived JWT via
 * Supabase Auth *anonymous sign-in* (`POST /auth/v1/signup` with the project's publishable anon key, which is
 * public by design), cache the access token in memory, refresh it before expiry, and return it here. Until that
 * exchange is wired, a deployed reference backend will answer 401 → NOT_CONFIGURED, and the app keeps working
 * with the local coach. See docs/AI_SECURITY.md §"אימות".
 */
@Singleton
class AnonymousInstallTokenProvider @Inject constructor(
    private val secureStore: SecureStore,
) : BackendTokenProvider {

    private val mutex = Mutex()
    private val random = SecureRandom()

    override suspend fun token(): String? = mutex.withLock {
        try {
            val existing = secureStore.getString(KEY_INSTALL_ID)
            if (existing != null && TOKEN_FORMAT.matches(existing)) return@withLock existing
            val fresh = newInstallId()
            secureStore.putString(KEY_INSTALL_ID, fresh)
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
        const val KEY_INSTALL_ID = "ai.backend.install_id"
        /** 32 bytes, base64url without padding = 43 chars. */
        private val TOKEN_FORMAT = Regex("^[A-Za-z0-9_-]{43}$")
    }
}
