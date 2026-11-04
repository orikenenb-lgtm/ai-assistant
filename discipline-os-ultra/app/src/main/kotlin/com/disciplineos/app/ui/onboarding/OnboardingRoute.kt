package com.disciplineos.app.ui.onboarding

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.PhoneInTalk
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material.icons.filled.RocketLaunch
import androidx.compose.material.icons.filled.SelfImprovement
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsCard
import com.disciplineos.app.designsystem.component.DsPrimaryButton
import com.disciplineos.app.designsystem.component.DsSecondaryButton
import com.disciplineos.app.designsystem.component.DsSwitchRow
import com.disciplineos.app.designsystem.component.DsTextField
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import kotlinx.coroutines.launch

/** Navigation entry point (see Routes.ONBOARDING). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun OnboardingRoute(onFinished: () -> Unit, viewModel: OnboardingViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    val reduceMotion = DisciplineTheme.motion.reduceMotion
    val pagerState = rememberPagerState(pageCount = { OnboardingLogic.PAGE_COUNT })
    val scope = rememberCoroutineScope()

    fun goTo(page: Int) {
        scope.launch {
            if (reduceMotion) pagerState.scrollToPage(page) else pagerState.animateScrollToPage(page)
        }
    }

    val page = pagerState.currentPage
    val isLast = OnboardingLogic.isLastPage(page)

    Column(
        Modifier
            .fillMaxSize()
            .background(colors.background)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
    ) {
        // Skip jumps to the final page (which explains what can be configured later) rather than silently finishing.
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = spacing.sm),
            horizontalArrangement = Arrangement.End,
        ) {
            if (!isLast) {
                TextButton(onClick = { goTo(OnboardingLogic.PAGE_COUNT - 1) }, modifier = Modifier.height(48.dp)) {
                    Text(stringResource(R.string.feat_onb_skip), color = colors.textSecondary)
                }
            } else {
                Spacer(Modifier.height(48.dp))
            }
        }

        // HorizontalPager follows the layout direction, so in RTL "next" swipes from left to right naturally.
        HorizontalPager(
            state = pagerState,
            modifier = Modifier.weight(1f),
        ) { index ->
            Box(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = spacing.xl),
            ) {
                when (index) {
                    0 -> WelcomePage()
                    1 -> HowItWorksPage()
                    2 -> NotificationsPage()
                    3 -> FirstTaskPage(
                        state = state,
                        onTitleChange = viewModel::onTitleChange,
                        onDailyChange = viewModel::onDailyChange,
                    )
                    else -> ReadyPage(createdTaskTitle = state.createdTaskTitle)
                }
            }
        }

        PageDots(current = page, total = OnboardingLogic.PAGE_COUNT)
        Spacer(Modifier.height(spacing.md))

        state.finishErrorRes?.let {
            Text(
                stringResource(it),
                color = colors.danger,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier
                    .padding(horizontal = spacing.xl)
                    .semantics { liveRegion = LiveRegionMode.Polite },
            )
        }

        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = spacing.xl, vertical = spacing.md),
            horizontalArrangement = Arrangement.spacedBy(spacing.sm),
        ) {
            if (page > 0) {
                DsSecondaryButton(
                    text = stringResource(R.string.feat_onb_back),
                    onClick = { goTo(OnboardingLogic.previousPage(page)) },
                    modifier = Modifier.weight(1f),
                )
            }
            when {
                isLast -> DsPrimaryButton(
                    text = stringResource(R.string.feat_onb_finish),
                    onClick = { viewModel.finish(onFinished) },
                    loading = state.finishing,
                    enabled = !state.finishing,
                    icon = Icons.Filled.RocketLaunch,
                    modifier = Modifier.weight(1f),
                )
                page == 3 && state.taskTitle.isNotBlank() -> DsPrimaryButton(
                    text = stringResource(R.string.feat_onb_task_create),
                    onClick = { viewModel.createFirstTask { goTo(OnboardingLogic.nextPage(page)) } },
                    loading = state.creatingTask,
                    enabled = !state.creatingTask,
                    modifier = Modifier.weight(1f),
                )
                else -> DsPrimaryButton(
                    text = stringResource(if (page == 3) R.string.feat_onb_task_skip else R.string.feat_onb_next),
                    onClick = { goTo(OnboardingLogic.nextPage(page)) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun PageHeader(icon: ImageVector, title: String, body: String) {
    val colors = DisciplineTheme.colors
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        Spacer(Modifier.height(DisciplineTheme.spacing.xl))
        Box(
            Modifier
                .size(96.dp)
                .clip(CircleShape)
                .background(colors.primary.copy(alpha = 0.18f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = colors.primarySoft, modifier = Modifier.size(48.dp))
        }
        Spacer(Modifier.height(DisciplineTheme.spacing.xl))
        Text(
            title,
            style = MaterialTheme.typography.headlineSmall,
            color = colors.textPrimary,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() },
        )
        Spacer(Modifier.height(DisciplineTheme.spacing.md))
        Text(
            body,
            style = MaterialTheme.typography.bodyLarge,
            color = colors.textSecondary,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun WelcomePage() {
    Column {
        PageHeader(
            icon = Icons.Filled.TaskAlt,
            title = stringResource(R.string.feat_onb_welcome_title),
            body = stringResource(R.string.feat_onb_welcome_body),
        )
        Spacer(Modifier.height(DisciplineTheme.spacing.xl))
        BulletLine(Icons.Filled.PriorityHigh, stringResource(R.string.feat_onb_welcome_point1))
        BulletLine(Icons.Filled.Shield, stringResource(R.string.feat_onb_welcome_point2))
        BulletLine(Icons.Filled.SelfImprovement, stringResource(R.string.feat_onb_welcome_point3))
    }
}

@Composable
private fun HowItWorksPage() {
    val colors = DisciplineTheme.colors
    Column {
        PageHeader(
            icon = Icons.Filled.Shield,
            title = stringResource(R.string.feat_onb_how_title),
            body = stringResource(R.string.feat_onb_how_body),
        )
        Spacer(Modifier.height(DisciplineTheme.spacing.lg))
        DsCard(Modifier.fillMaxWidth()) {
            Text(
                stringResource(R.string.feat_onb_honest_title),
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.height(DisciplineTheme.spacing.sm))
            BulletLine(Icons.Filled.Lock, stringResource(R.string.feat_onb_honest_point1))
            BulletLine(Icons.Filled.CheckCircle, stringResource(R.string.feat_onb_honest_point2))
            BulletLine(Icons.Filled.PhoneInTalk, stringResource(R.string.feat_onb_honest_point3))
        }
    }
}

@Composable
private fun NotificationsPage() {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(notificationsGranted(context)) }
    // Re-check when returning from system settings.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { granted = notificationsGranted(context) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { result ->
        granted = result || notificationsGranted(context)
    }
    val colors = DisciplineTheme.colors
    Column {
        PageHeader(
            icon = Icons.Filled.NotificationsActive,
            title = stringResource(R.string.feat_onb_notif_title),
            body = stringResource(R.string.feat_onb_notif_body),
        )
        Spacer(Modifier.height(DisciplineTheme.spacing.xl))
        if (granted) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
            ) {
                Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = colors.success)
                Spacer(Modifier.width(DisciplineTheme.spacing.sm))
                Text(stringResource(R.string.feat_onb_notif_granted), color = colors.success, style = MaterialTheme.typography.titleMedium)
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            DsPrimaryButton(
                text = stringResource(R.string.feat_onb_notif_allow),
                onClick = { launcher.launch(Manifest.permission.POST_NOTIFICATIONS) },
                icon = Icons.Filled.NotificationsActive,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(DisciplineTheme.spacing.sm))
            Text(
                stringResource(R.string.feat_onb_notif_optional),
                style = MaterialTheme.typography.bodySmall,
                color = colors.textMuted,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            // Pre-Android 13: no runtime permission; notifications were turned off in system settings.
            Text(
                stringResource(R.string.feat_onb_notif_disabled_legacy),
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun FirstTaskPage(
    state: OnboardingUiState,
    onTitleChange: (String) -> Unit,
    onDailyChange: (Boolean) -> Unit,
) {
    val colors = DisciplineTheme.colors
    Column {
        PageHeader(
            icon = Icons.Filled.PriorityHigh,
            title = stringResource(R.string.feat_onb_task_title),
            body = stringResource(R.string.feat_onb_task_body),
        )
        Spacer(Modifier.height(DisciplineTheme.spacing.xl))
        if (state.createdTaskTitle != null) {
            Text(
                stringResource(R.string.feat_onb_task_created, state.createdTaskTitle),
                color = colors.success,
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            Spacer(Modifier.height(DisciplineTheme.spacing.md))
        }
        DsTextField(
            value = state.taskTitle,
            onValueChange = onTitleChange,
            label = stringResource(R.string.feat_onb_task_field),
            maxLength = OnboardingLogic.MAX_TITLE,
            isError = state.taskErrorRes != null,
            supportingText = state.taskErrorRes?.let { stringResource(it) } ?: stringResource(R.string.feat_onb_task_hint),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(DisciplineTheme.spacing.sm))
        DsSwitchRow(
            title = stringResource(R.string.feat_onb_task_daily),
            subtitle = stringResource(R.string.feat_onb_task_daily_sub),
            checked = state.taskDaily,
            onCheckedChange = onDailyChange,
        )
    }
}

@Composable
private fun ReadyPage(createdTaskTitle: String?) {
    val colors = DisciplineTheme.colors
    Column {
        PageHeader(
            icon = Icons.Filled.RocketLaunch,
            title = stringResource(R.string.feat_onb_ready_title),
            body = stringResource(R.string.feat_onb_ready_body),
        )
        Spacer(Modifier.height(DisciplineTheme.spacing.lg))
        if (createdTaskTitle != null) {
            BulletLine(Icons.Filled.CheckCircle, stringResource(R.string.feat_onb_task_created, createdTaskTitle))
        }
        DsCard(Modifier.fillMaxWidth()) {
            Text(
                stringResource(R.string.feat_onb_ready_permissions),
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textSecondary,
            )
        }
    }
}

@Composable
private fun BulletLine(icon: ImageVector, text: String) {
    Row(
        verticalAlignment = Alignment.Top,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = DisciplineTheme.spacing.xs)
            .semantics(mergeDescendants = true) {},
    ) {
        Icon(icon, contentDescription = null, tint = DisciplineTheme.colors.primarySoft, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(DisciplineTheme.spacing.md))
        Text(text, style = MaterialTheme.typography.bodyLarge, color = DisciplineTheme.colors.textPrimary)
    }
}

@Composable
private fun PageDots(current: Int, total: Int) {
    val colors = DisciplineTheme.colors
    val description = stringResource(R.string.feat_onb_page_a11y, current + 1, total)
    Row(
        horizontalArrangement = Arrangement.spacedBy(DisciplineTheme.spacing.sm, Alignment.CenterHorizontally),
        modifier = Modifier
            .fillMaxWidth()
            .clearAndSetSemantics { contentDescription = description },
    ) {
        repeat(total) { i ->
            Box(
                Modifier
                    .size(width = if (i == current) 22.dp else 8.dp, height = 8.dp)
                    .clip(CircleShape)
                    .background(if (i == current) colors.primary else colors.surfaceRaised),
            )
        }
    }
}

private fun notificationsGranted(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
        return false
    }
    return NotificationManagerCompat.from(context).areNotificationsEnabled()
}
