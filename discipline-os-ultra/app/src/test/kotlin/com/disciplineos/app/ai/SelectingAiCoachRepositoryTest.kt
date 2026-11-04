package com.disciplineos.app.ai

import com.disciplineos.core.domain.coach.AiCoachRepository
import com.disciplineos.core.domain.coach.CoachChunk
import com.disciplineos.core.domain.coach.CoachContext
import com.disciplineos.core.domain.coach.CoachErrorKind
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.model.AiPrivacySettings
import com.disciplineos.core.model.AppSettings
import com.disciplineos.core.model.ChatMessage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SelectingAiCoachRepositoryTest {

    private val context = CoachContext(
        localDateIso = "2026-11-04",
        pendingMandatoryTitles = emptyList(),
        pendingOptionalTitles = emptyList(),
        completedTodayCount = 0,
        streakDays = 0,
        focusMinutesToday = 0,
        appUsageSummary = "Instagram 40m",
    )

    private class FakeProvider(override val providerName: String, private val chunks: List<CoachChunk>) : AiCoachRepository {
        var calls = 0
        var lastContext: CoachContext? = null
        override fun streamReply(history: List<ChatMessage>, userMessage: String, context: CoachContext): Flow<CoachChunk> {
            calls++
            lastContext = context
            return flowOf(*chunks.toTypedArray())
        }
    }

    /** Only observeAiPrivacy is used by the repository under test. */
    private class FakeSettings(privacy: AiPrivacySettings) : SettingsRepository {
        val privacy = MutableStateFlow(privacy)
        override fun observeSettings(): Flow<AppSettings> = throw UnsupportedOperationException()
        override fun observeAiPrivacy(): Flow<AiPrivacySettings> = privacy
        override suspend fun updateSettings(transform: (AppSettings) -> AppSettings) = throw UnsupportedOperationException()
        override suspend fun updateAiPrivacy(transform: (AiPrivacySettings) -> AiPrivacySettings) {
            privacy.value = transform(privacy.value)
        }
    }

    private val local = FakeProvider("local-demo", listOf(CoachChunk.TextDelta("local"), CoachChunk.Done))
    private val remoteOffline = FakeProvider("remote-backend", listOf(CoachChunk.Error(CoachErrorKind.OFFLINE, "IOException")))

    private fun repo(privacy: AiPrivacySettings, baseUrl: String, remote: FakeProvider = remoteOffline) =
        SelectingAiCoachRepository(FakeSettings(privacy), AiBackendConfig(baseUrl), local, remote)

    @Test
    fun defaultsUseLocalProvider() = runTest {
        val r = repo(AiPrivacySettings(), baseUrl = "https://api.example.com")
        val out = r.streamReply(emptyList(), "hi", context).toList()
        assertEquals(listOf(CoachChunk.TextDelta("local"), CoachChunk.Done), out)
        assertEquals("local-demo", r.providerName)
        assertEquals(0, remoteOffline.calls)
    }

    @Test
    fun optInWithoutBackendUrlStaysLocal() = runTest {
        val r = repo(AiPrivacySettings(remoteProviderEnabled = true), baseUrl = "  ")
        r.streamReply(emptyList(), "hi", context).toList()
        assertEquals(1, local.calls)
        assertEquals(0, remoteOffline.calls)
        assertEquals("local-demo", r.providerName)
    }

    @Test
    fun optInWithBackendUsesRemoteAndDoesNotSilentlyFallBack() = runTest {
        val r = repo(AiPrivacySettings(remoteProviderEnabled = true), baseUrl = "https://api.example.com")
        val out = r.streamReply(emptyList(), "hi", context).toList()
        assertEquals(listOf<CoachChunk>(CoachChunk.Error(CoachErrorKind.OFFLINE, "IOException")), out)
        assertEquals(0, local.calls)
        assertEquals("remote-backend", r.providerName)
    }

    @Test
    fun appUsageIsStrippedForRemoteUnlessOptedIn() = runTest {
        val remote = FakeProvider("remote-backend", listOf(CoachChunk.Done))
        repo(AiPrivacySettings(remoteProviderEnabled = true, shareAppUsage = false), "https://api.example.com", remote)
            .streamReply(emptyList(), "hi", context).toList()
        assertNull(remote.lastContext!!.appUsageSummary)

        val remote2 = FakeProvider("remote-backend", listOf(CoachChunk.Done))
        repo(AiPrivacySettings(remoteProviderEnabled = true, shareAppUsage = true), "https://api.example.com", remote2)
            .streamReply(emptyList(), "hi", context).toList()
        assertEquals("Instagram 40m", remote2.lastContext!!.appUsageSummary)
    }

    @Test
    fun selectionIsEvaluatedPerRequest() = runTest {
        val settings = FakeSettings(AiPrivacySettings())
        val r = SelectingAiCoachRepository(settings, AiBackendConfig("https://api.example.com"), local, remoteOffline)
        r.streamReply(emptyList(), "hi", context).toList()
        assertEquals("local-demo", r.providerName)
        settings.updateAiPrivacy { it.copy(remoteProviderEnabled = true) }
        r.streamReply(emptyList(), "hi", context).toList()
        assertEquals("remote-backend", r.providerName)
        assertEquals(1, local.calls)
        assertEquals(1, remoteOffline.calls)
    }
}
