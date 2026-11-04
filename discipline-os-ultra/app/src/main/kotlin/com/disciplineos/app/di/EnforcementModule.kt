package com.disciplineos.app.di

import com.disciplineos.app.enforcement.UsageStatsScreenTimeSource
import com.disciplineos.core.domain.repository.ScreenTimeSource
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/** Enforcement-layer bindings (AGENTS.md §2: F provides ScreenTimeSource). */
@Module
@InstallIn(SingletonComponent::class)
abstract class EnforcementModule {
    @Binds
    @Singleton
    abstract fun bindScreenTimeSource(impl: UsageStatsScreenTimeSource): ScreenTimeSource
}
