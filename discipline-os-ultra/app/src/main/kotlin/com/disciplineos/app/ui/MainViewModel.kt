package com.disciplineos.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.disciplineos.app.ui.common.deferredFlow
import com.disciplineos.app.ui.navigation.Routes
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.model.AppSettings
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

sealed interface MainUiState {
    /** Settings not read yet: the splash screen stays up. */
    data object Loading : MainUiState

    data class Ready(
        val startDestination: String,
        val highContrast: Boolean,
        val reduceMotion: Boolean,
    ) : MainUiState
}

/**
 * App-level state: start destination (decided once, from the first settings emission, so finishing
 * onboarding later does not rebuild the nav graph) and live accessibility preferences.
 */
@HiltViewModel
class MainViewModel @Inject constructor(
    settingsRepository: SettingsRepository,
) : ViewModel() {

    private var startDestination: String? = null

    val uiState: StateFlow<MainUiState> = deferredFlow { settingsRepository.observeSettings() }
        // A settings read failure must never brick the app: fall back to defaults (onboarding).
        .catch { emit(AppSettings()) }
        .map { settings ->
            val start = startDestination
                ?: (if (settings.onboardingCompleted) Routes.DASHBOARD else Routes.ONBOARDING)
                    .also { startDestination = it }
            MainUiState.Ready(
                startDestination = start,
                highContrast = settings.highContrast,
                reduceMotion = settings.reduceMotion,
            )
        }
        .stateIn(viewModelScope, SharingStarted.Eagerly, MainUiState.Loading)
}
