package com.disciplineos.app.ui.navigation

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.disciplineos.app.designsystem.theme.DisciplineTheme

/**
 * App shell: bottom navigation + NavHost. The outer Scaffold only reserves space for the bottom bar
 * (its insets are consumed), each screen's own Scaffold handles status-bar/IME insets.
 */
@Composable
fun AppRoot(startDestination: String) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val currentTopLevel = TopLevelDestination.entries.firstOrNull { it.route == currentRoute }

    Scaffold(
        containerColor = DisciplineTheme.colors.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            DisciplineBottomBar(
                visible = currentTopLevel != null,
                current = currentTopLevel,
                onSelect = { navController.navigateToTopLevel(it) },
            )
        },
    ) { padding ->
        AppNavHost(
            navController = navController,
            startDestination = startDestination,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .consumeWindowInsets(padding),
        )
    }
}

/** Switch tabs without growing the back stack; each tab keeps its own saved state. */
fun NavHostController.navigateToTopLevel(destination: TopLevelDestination) {
    navigate(destination.route) {
        // Dashboard is always the root after onboarding (onboarding pops itself inclusively).
        popUpTo(Routes.DASHBOARD) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
