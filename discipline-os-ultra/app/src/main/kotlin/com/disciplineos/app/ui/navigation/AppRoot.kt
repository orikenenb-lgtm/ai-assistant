package com.disciplineos.app.ui.navigation

import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.disciplineos.app.designsystem.theme.DisciplineTheme

/**
 * App shell: bottom navigation + NavHost. The outer Scaffold only reserves space for the bottom bar
 * (its insets are consumed), each screen's own Scaffold handles status-bar/IME insets.
 */
// consumeWindowInsets(PaddingValues) was experimental in older foundation releases; opting in is harmless when stable.
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AppRoot(
    startDestination: String,
    onboardingCompleted: Boolean = true,
    pendingRoute: String? = null,
    onPendingRouteHandled: () -> Unit = {},
) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val routeHandled by rememberUpdatedState(onPendingRouteHandled)

    // External route (notification / block screen). Applied only once onboarding is finished and the
    // user has actually left the onboarding screen; until then it stays pending.
    LaunchedEffect(pendingRoute, onboardingCompleted, currentRoute) {
        val route = pendingRoute ?: return@LaunchedEffect
        if (!onboardingCompleted || currentRoute == null || currentRoute == Routes.ONBOARDING) return@LaunchedEffect
        if (route == Routes.DASHBOARD) {
            navController.navigateToTopLevel(TopLevelDestination.DASHBOARD)
        } else if (route != currentRoute) {
            navController.navigate(route) { launchSingleTop = true }
        }
        routeHandled()
    }
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
