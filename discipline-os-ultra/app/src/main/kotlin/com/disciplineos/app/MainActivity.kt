package com.disciplineos.app

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.ui.MainUiState
import com.disciplineos.app.ui.MainViewModel
import com.disciplineos.app.ui.navigation.AppRoot
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        // Keep the splash until settings are known, so we never flash onboarding for returning users.
        splash.setKeepOnScreenCondition { viewModel.uiState.value is MainUiState.Loading }
        // Always-dark UI: light system-bar icons on transparent bars.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        setContent {
            val state by viewModel.uiState.collectAsStateWithLifecycle()
            when (val current = state) {
                MainUiState.Loading -> DisciplineTheme {
                    Box(Modifier.fillMaxSize().background(DisciplineTheme.colors.background))
                }
                is MainUiState.Ready -> DisciplineTheme(
                    highContrast = current.highContrast,
                    reduceMotion = current.reduceMotion,
                ) {
                    AppRoot(startDestination = current.startDestination)
                }
            }
        }
    }
}
