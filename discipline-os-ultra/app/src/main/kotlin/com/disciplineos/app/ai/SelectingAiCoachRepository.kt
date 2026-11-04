package com.disciplineos.app.ai

import com.disciplineos.core.domain.coach.AiCoachRepository
import com.disciplineos.core.domain.coach.CoachChunk
import com.disciplineos.core.domain.coach.CoachContext
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.model.AiPrivacySettings
import com.disciplineos.core.model.ChatMessage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The AiCoachRepository bound app-wide. Chooses the provider per request:
 *  - remote ([RemoteCoach]) only when the user opted in (`AiPrivacySettings.remoteProviderEnabled`) AND the build has
 *    a backend URL ([AiBackendConfig.isConfigured]);
 *  - otherwise the offline [LocalCoach] provider (LocalDemoCoachProvider) — the app works with zero backend.
 *
 * No silent fallback: once a remote stream is chosen, its errors (OFFLINE, BACKEND_UNAVAILABLE, RATE_LIMITED…)
 * are emitted as-is so the use case can show a notice. Silently switching to the local coach mid-conversation
 * would misrepresent who answered.
 */
@Singleton
class SelectingAiCoachRepository @Inject constructor(
    private val settings: SettingsRepository,
    private val config: AiBackendConfig,
    @LocalCoach private val local: AiCoachRepository,
    @RemoteCoach private val remote: AiCoachRepository,
) : AiCoachRepository {

    @Volatile
    private var selected: AiCoachRepository = local

    /** Name of the provider used by the most recent (or ongoing) [streamReply]; "local-demo" until the first one. */
    override val providerName: String
        get() = selected.providerName

    /** Pure selection rule, exposed for tests and for UI that wants to label the next reply. */
    fun shouldUseRemote(privacy: AiPrivacySettings): Boolean =
        privacy.remoteProviderEnabled && config.isConfigured

    override fun streamReply(history: List<ChatMessage>, userMessage: String, context: CoachContext): Flow<CoachChunk> = flow {
        val privacy = settings.observeAiPrivacy().first()
        if (shouldUseRemote(privacy)) {
            selected = remote
            // Defence in depth: app-usage data leaves the device only with explicit opt-in, even if a caller
            // built the context incorrectly.
            val minimized = if (privacy.shareAppUsage) context else context.copy(appUsageSummary = null)
            emitAll(remote.streamReply(history, userMessage, minimized))
        } else {
            selected = local
            emitAll(local.streamReply(history, userMessage, context))
        }
    }
}
