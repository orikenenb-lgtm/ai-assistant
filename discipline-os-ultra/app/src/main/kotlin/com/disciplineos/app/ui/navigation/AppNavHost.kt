package com.disciplineos.app.ui.navigation

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.enforcement.ui.BlockedAppsRoute
import com.disciplineos.app.enforcement.ui.BlockerRoute
import com.disciplineos.app.enforcement.ui.PermissionsRoute
import com.disciplineos.app.ui.coach.CoachRoute
import com.disciplineos.app.ui.dashboard.DashboardRoute
import com.disciplineos.app.ui.focus.FocusRoute
import com.disciplineos.app.ui.onboarding.OnboardingRoute
import com.disciplineos.app.ui.settings.PrivacyRoute
import com.disciplineos.app.ui.settings.SettingsRoute
import com.disciplineos.app.ui.stats.AchievementsRoute
import com.disciplineos.app.ui.stats.StatsRoute
import com.disciplineos.app.ui.stats.WeeklyReviewRoute
import com.disciplineos.app.ui.tasks.TaskDetailRoute
import com.disciplineos.app.ui.tasks.TaskEditorRoute
import com.disciplineos.app.ui.tasks.TasksRoute
import com.disciplineos.app.ui.tasks.WeekPlanRoute

private val TopLevelRoutes: Set<String> = TopLevelDestination.entries.map { it.route }.toSet()

private fun AnimatedContentTransitionScope<NavBackStackEntry>.isTabSwitch(): Boolean =
    initialState.destination.route in TopLevelRoutes && targetState.destination.route in TopLevelRoutes

/**
 * All routes from [Routes]. Pushes slide toward the reading direction (SlideDirection.Start/End are
 * layout-direction aware, so in Hebrew new screens enter from the left); tab switches cross-fade.
 * With reduce-motion on, every transition is instant.
 */
@Composable
fun AppNavHost(
    navController: NavHostController,
    startDestination: String,
    modifier: Modifier = Modifier,
) {
    val motion = DisciplineTheme.motion
    val reduceMotion = motion.reduceMotion
    val push = motion.mediumMillis + 40
    val fade = motion.mediumMillis - 80

    NavHost(
        navController = navController,
        startDestination = startDestination,
        modifier = modifier,
        enterTransition = {
            when {
                reduceMotion -> EnterTransition.None
                isTabSwitch() -> fadeIn(tween(fade))
                else -> slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.Start, tween(push)) + fadeIn(tween(push))
            }
        },
        exitTransition = {
            when {
                reduceMotion -> ExitTransition.None
                isTabSwitch() -> fadeOut(tween(fade))
                else -> slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.Start, tween(push)) { it / 4 } + fadeOut(tween(push))
            }
        },
        popEnterTransition = {
            when {
                reduceMotion -> EnterTransition.None
                isTabSwitch() -> fadeIn(tween(fade))
                else -> slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.End, tween(push)) { it / 4 } + fadeIn(tween(push))
            }
        },
        popExitTransition = {
            when {
                reduceMotion -> ExitTransition.None
                isTabSwitch() -> fadeOut(tween(fade))
                else -> slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.End, tween(push)) + fadeOut(tween(push))
            }
        },
    ) {
        // Guarded so a double-tapped back arrow can never pop the root and leave a blank screen.
        val back: () -> Unit = {
            if (navController.previousBackStackEntry != null) navController.popBackStack()
        }

        composable(Routes.ONBOARDING) {
            OnboardingRoute(
                onFinished = {
                    navController.navigate(Routes.DASHBOARD) {
                        popUpTo(Routes.ONBOARDING) { inclusive = true }
                        launchSingleTop = true
                    }
                },
            )
        }
        composable(Routes.DASHBOARD) {
            DashboardRoute(
                onOpenTask = { taskId -> navController.navigate(Routes.taskDetail(taskId)) },
                onCreateTask = { navController.navigate(Routes.taskEditor()) },
                onOpenFocus = { navController.navigateToTopLevel(TopLevelDestination.FOCUS) },
                onOpenCoach = { navController.navigate(Routes.COACH) },
                onOpenBlocker = { navController.navigate(Routes.BLOCKER) },
                onOpenAchievements = { navController.navigate(Routes.ACHIEVEMENTS) },
                onOpenStats = { navController.navigateToTopLevel(TopLevelDestination.STATS) },
            )
        }
        composable(Routes.TASKS) {
            TasksRoute(
                onOpenTask = { taskId -> navController.navigate(Routes.taskDetail(taskId)) },
                onCreateTask = { navController.navigate(Routes.taskEditor()) },
                onOpenWeek = { navController.navigate(Routes.WEEK_PLAN) },
            )
        }
        composable(
            route = Routes.TASK_EDITOR,
            arguments = listOf(
                navArgument("taskId") {
                    type = NavType.LongType
                    defaultValue = -1L
                },
            ),
        ) {
            TaskEditorRoute(onDone = back)
        }
        composable(
            route = Routes.TASK_DETAIL,
            arguments = listOf(navArgument("taskId") { type = NavType.LongType }),
        ) {
            TaskDetailRoute(
                onEdit = { taskId -> navController.navigate(Routes.taskEditor(taskId)) },
                onBack = back,
                onOpenFocus = { navController.navigateToTopLevel(TopLevelDestination.FOCUS) },
            )
        }
        composable(Routes.WEEK_PLAN) {
            WeekPlanRoute(
                onBack = back,
                onOpenTask = { taskId -> navController.navigate(Routes.taskDetail(taskId)) },
            )
        }
        composable(Routes.FOCUS) {
            FocusRoute()
        }
        composable(Routes.STATS) {
            StatsRoute(onOpenWeeklyReview = { navController.navigate(Routes.WEEKLY_REVIEW) })
        }
        composable(Routes.WEEKLY_REVIEW) {
            WeeklyReviewRoute(onBack = back)
        }
        composable(Routes.ACHIEVEMENTS) {
            AchievementsRoute(onBack = back)
        }
        composable(Routes.COACH) {
            CoachRoute(onBack = back)
        }
        composable(Routes.SETTINGS) {
            SettingsRoute(
                onOpenBlockedApps = { navController.navigate(Routes.BLOCKED_APPS) },
                onOpenPermissions = { navController.navigate(Routes.PERMISSIONS) },
                onOpenPrivacy = { navController.navigate(Routes.PRIVACY) },
                onBack = back,
            )
        }
        composable(Routes.PRIVACY) {
            PrivacyRoute(onBack = back)
        }
        composable(Routes.BLOCKER) {
            BlockerRoute(
                onOpenApps = { navController.navigate(Routes.BLOCKED_APPS) },
                onOpenPermissions = { navController.navigate(Routes.PERMISSIONS) },
                onBack = back,
            )
        }
        composable(Routes.BLOCKED_APPS) {
            BlockedAppsRoute(onBack = back)
        }
        composable(Routes.PERMISSIONS) {
            PermissionsRoute(onBack = back)
        }
    }
}
