package com.disciplineos.app.ui.navigation

/**
 * NAVIGATION CONTRACT. The NavHost (owned by the UI-Core agent) wires these routes to the
 * composables listed next to each. Screen owners must expose exactly these entry points.
 */
object Routes {
    const val ONBOARDING = "onboarding"        // ui.onboarding.OnboardingRoute(onFinished: () -> Unit)
    const val DASHBOARD = "dashboard"          // ui.dashboard.DashboardRoute(onOpenTask, onCreateTask, onOpenFocus, onOpenCoach, onOpenBlocker)
    const val TASKS = "tasks"                  // ui.tasks.TasksRoute(onOpenTask, onCreateTask, onOpenWeek)
    const val TASK_EDITOR = "task/edit?taskId={taskId}" // ui.tasks.TaskEditorRoute(onDone: () -> Unit)  (taskId: Long, -1 = new; read via SavedStateHandle "taskId")
    const val TASK_DETAIL = "task/{taskId}"    // ui.tasks.TaskDetailRoute(onEdit: (Long) -> Unit, onBack: () -> Unit)
    const val WEEK_PLAN = "week"               // ui.tasks.WeekPlanRoute(onBack, onOpenTask)
    const val FOCUS = "focus"                  // ui.focus.FocusRoute()
    const val STATS = "stats"                  // ui.stats.StatsRoute(onOpenWeeklyReview)
    const val WEEKLY_REVIEW = "weekly_review"  // ui.stats.WeeklyReviewRoute(onBack)
    const val COACH = "coach"                  // ui.coach.CoachRoute(onBack: () -> Unit)
    const val SETTINGS = "settings"            // ui.settings.SettingsRoute(onOpenBlockedApps, onOpenPermissions, onOpenPrivacy, onBack)
    const val PRIVACY = "settings/privacy"     // ui.settings.PrivacyRoute(onBack)
    const val BLOCKED_APPS = "blocker/apps"    // enforcement.ui.BlockedAppsRoute(onBack)
    const val BLOCKER = "blocker"              // enforcement.ui.BlockerRoute(onOpenApps, onOpenPermissions, onBack)
    const val PERMISSIONS = "permissions"      // enforcement.ui.PermissionsRoute(onBack)
    const val ACHIEVEMENTS = "achievements"    // ui.stats.AchievementsRoute(onBack)

    fun taskEditor(taskId: Long = -1L) = "task/edit?taskId=$taskId"
    fun taskDetail(taskId: Long) = "task/$taskId"
}

/** Bottom navigation destinations (in display order; layout mirrors automatically in RTL). */
enum class TopLevelDestination(val route: String) {
    DASHBOARD(Routes.DASHBOARD),
    TASKS(Routes.TASKS),
    FOCUS(Routes.FOCUS),
    STATS(Routes.STATS),
    SETTINGS(Routes.SETTINGS),
}
