package com.disciplineos.app.ai

/**
 * Supplies the bearer token sent to the AI backend. Returning null means "not configured" and the remote
 * provider emits CoachErrorKind.NOT_CONFIGURED without any network call.
 *
 * This is the seam for real authentication: no provider API key is ever in the APK.
 */
interface BackendTokenProvider {
    suspend fun token(): String?

    /**
     * Called when the backend rejected [rejectedToken] with HTTP 401. Implementations drop their cached
     * credentials (if they still equal [rejectedToken]) so the next [token] call obtains a fresh one.
     * Default: no-op (e.g. a static install id cannot be refreshed).
     */
    suspend fun invalidate(rejectedToken: String) {}
}
