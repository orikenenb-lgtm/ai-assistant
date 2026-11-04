package com.disciplineos.app.di

import com.disciplineos.app.BuildConfig
import com.disciplineos.app.ai.AI_HTTP_CLIENT
import com.disciplineos.app.ai.AiBackendConfig
import com.disciplineos.app.ai.AnonymousInstallTokenProvider
import com.disciplineos.app.ai.BackendTokenProvider
import com.disciplineos.app.ai.LocalCoach
import com.disciplineos.app.ai.RemoteBackendCoachProvider
import com.disciplineos.app.ai.RemoteCoach
import com.disciplineos.app.ai.SelectingAiCoachRepository
import com.disciplineos.core.domain.coach.AiCoachRepository
import com.disciplineos.core.domain.coach.LocalDemoCoachProvider
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.ConnectionSpec
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit
import javax.inject.Named
import javax.inject.Singleton

/**
 * AI coach wiring. Provides the app-wide [AiCoachRepository] (G's contract in AGENTS.md).
 * Nothing here contains a secret: BuildConfig.AI_BACKEND_URL is a public URL and is empty by default.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class AiModule {

    @Binds
    abstract fun bindAiCoachRepository(impl: SelectingAiCoachRepository): AiCoachRepository

    @Binds
    @LocalCoach
    abstract fun bindLocalCoach(impl: LocalDemoCoachProvider): AiCoachRepository

    @Binds
    @RemoteCoach
    abstract fun bindRemoteCoach(impl: RemoteBackendCoachProvider): AiCoachRepository

    @Binds
    abstract fun bindBackendTokenProvider(impl: AnonymousInstallTokenProvider): BackendTokenProvider

    companion object {

        @Provides
        @Singleton
        fun provideAiBackendConfig(): AiBackendConfig = AiBackendConfig(
            baseUrl = BuildConfig.AI_BACKEND_URL,
            cleartextHostsAllowed = if (BuildConfig.DEBUG) setOf(AiBackendConfig.EMULATOR_HOST) else emptySet(),
        )

        /**
         * Dedicated client for the AI proxy: never shared with other features, no logging interceptor,
         * no redirects (the bearer token must not follow a redirect), no silent retries (a retried POST could
         * double-charge quota), TLS 1.2+ only in release.
         */
        @Provides
        @Singleton
        @Named(AI_HTTP_CLIENT)
        fun provideAiOkHttpClient(config: AiBackendConfig): OkHttpClient {
            val specs = if (config.cleartextHostsAllowed.isEmpty()) {
                listOf(ConnectionSpec.MODERN_TLS)
            } else {
                listOf(ConnectionSpec.MODERN_TLS, ConnectionSpec.CLEARTEXT)
            }
            return OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .writeTimeout(15, TimeUnit.SECONDS)
                .followRedirects(false)
                .followSslRedirects(false)
                .retryOnConnectionFailure(false)
                .connectionSpecs(specs)
                .build()
        }
    }
}
