package com.disciplineos.app.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.disciplineos.app.ai.AiBackendConfig
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.model.AiPrivacySettings
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class PrivacyUiState(
    val loading: Boolean = true,
    val loadFailed: Boolean = false,
    val privacy: AiPrivacySettings = AiPrivacySettings(),
    val backendConfigured: Boolean = false,
    val saveFailed: Boolean = false,
)

@HiltViewModel
class PrivacyViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository,
    backendConfig: AiBackendConfig,
) : ViewModel() {

    private val saveFailed = MutableStateFlow(false)
    private val configured = backendConfig.isConfigured

    val uiState: StateFlow<PrivacyUiState> = combine(
        settingsRepository.observeAiPrivacy().map { Result.success(it) }.catch { emit(Result.failure(it)) },
        saveFailed,
    ) { p, failed ->
        PrivacyUiState(
            loading = false,
            loadFailed = p.isFailure,
            privacy = p.getOrNull() ?: AiPrivacySettings(),
            backendConfigured = configured,
            saveFailed = failed,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PrivacyUiState())

    fun setRemoteEnabled(enabled: Boolean) = update { it.copy(remoteProviderEnabled = enabled) }
    fun setShareTaskTitles(enabled: Boolean) = update { it.copy(shareTaskTitles = enabled) }
    fun setShareAppUsage(enabled: Boolean) = update { it.copy(shareAppUsage = enabled) }
    fun setDailyLimit(limit: Int) = update { it.copy(dailyMessageLimit = limit.coerceIn(SettingsLogic.DAILY_LIMIT_RANGE)) }

    fun dismissSaveError() {
        saveFailed.value = false
    }

    private fun update(transform: (AiPrivacySettings) -> AiPrivacySettings) {
        viewModelScope.launch {
            runCatching { settingsRepository.updateAiPrivacy(transform) }.onFailure { saveFailed.value = true }
        }
    }
}
