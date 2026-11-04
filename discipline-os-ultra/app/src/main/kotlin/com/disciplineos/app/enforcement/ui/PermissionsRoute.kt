package com.disciplineos.app.enforcement.ui

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsBadge
import com.disciplineos.app.designsystem.component.DsCard
import com.disciplineos.app.designsystem.component.DsSecondaryButton
import com.disciplineos.app.designsystem.component.DsTopBar
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.enforcement.EnforcementController
import com.disciplineos.app.enforcement.EnforcementMode
import com.disciplineos.app.enforcement.EnforcementPrefs
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

@HiltViewModel
class PermissionsViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val prefs: EnforcementPrefs,
    private val controller: EnforcementController,
) : ViewModel() {

    private val _snapshot = MutableStateFlow(PermissionChecks.snapshot(context))
    val snapshot: StateFlow<PermissionSnapshot> = _snapshot.asStateFlow()
    val consentAt: StateFlow<Long?> = prefs.accessibilityConsentAt

    /** Called on every ON_RESUME: the user may have changed anything in Settings meanwhile. */
    fun refresh() {
        _snapshot.value = PermissionChecks.snapshot(context)
        controller.sync()
    }

    fun acceptAccessibilityDisclosure() {
        prefs.giveAccessibilityConsent()
        prefs.setMode(EnforcementMode.ACCESSIBILITY)
    }
}

@Composable
fun PermissionsRoute(
    onBack: () -> Unit,
    viewModel: PermissionsViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()
    val consentAt by viewModel.consentAt.collectAsStateWithLifecycle()
    var showDisclosure by rememberSaveable { mutableStateOf(false) }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.refresh() }

    val notificationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) PermissionIntents.open(context, PermissionKind.NOTIFICATIONS)
        viewModel.refresh()
    }

    PermissionsScreen(
        snapshot = snapshot,
        onBack = onBack,
        onOpen = { kind ->
            when {
                kind == PermissionKind.NOTIFICATIONS && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
                    notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                kind == PermissionKind.ACCESSIBILITY && consentAt == null -> showDisclosure = true
                else -> PermissionIntents.open(context, kind)
            }
        },
        onOpenAppDetails = { PermissionIntents.open(context, PermissionIntents.appDetails(context)) },
    )

    if (showDisclosure) {
        AccessibilityDisclosureDialog(
            onAccept = {
                showDisclosure = false
                viewModel.acceptAccessibilityDisclosure()
                PermissionIntents.open(context, PermissionKind.ACCESSIBILITY)
            },
            onDecline = { showDisclosure = false },
        )
    }
}

@Composable
fun PermissionsScreen(
    snapshot: PermissionSnapshot,
    onBack: () -> Unit,
    onOpen: (PermissionKind) -> Unit,
    onOpenAppDetails: () -> Unit,
) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    var samsungExpanded by rememberSaveable { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().background(colors.background)) {
        DsTopBar(title = stringResource(R.string.perm_title), onBack = onBack)
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = spacing.screenGutter),
            verticalArrangement = Arrangement.spacedBy(spacing.md),
        ) {
            Text(
                text = stringResource(R.string.perm_intro),
                style = DisciplineTheme.typography.bodyMedium,
                color = colors.textSecondary,
            )
            DsBadge(
                text = stringResource(if (snapshot.usageModeReady) R.string.perm_ready else R.string.perm_not_ready),
                color = if (snapshot.usageModeReady) colors.success else colors.warning,
            )
            snapshot.items().forEach { item ->
                PermissionRow(
                    item = item,
                    onOpen = { onOpen(item.kind) },
                    onOpenAppDetails = if (item.kind == PermissionKind.BATTERY_OPTIMIZATION) onOpenAppDetails else null,
                )
            }

            DsCard(modifier = Modifier.fillMaxWidth(), onClick = { samsungExpanded = !samsungExpanded }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = stringResource(R.string.perm_samsung_header),
                        style = DisciplineTheme.typography.titleMedium,
                        color = colors.textPrimary,
                        modifier = Modifier.weight(1f).semantics { heading() },
                    )
                    Icon(
                        imageVector = if (samsungExpanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                        contentDescription = stringResource(
                            if (samsungExpanded) R.string.perm_samsung_collapse else R.string.perm_samsung_expand,
                        ),
                        tint = colors.textSecondary,
                    )
                }
                AnimatedVisibility(visible = samsungExpanded) {
                    Text(
                        text = stringResource(R.string.perm_samsung_tips),
                        style = DisciplineTheme.typography.bodyMedium,
                        color = colors.textSecondary,
                        modifier = Modifier.padding(top = spacing.sm),
                    )
                }
            }
            Spacer(Modifier.height(spacing.xl))
        }
    }
}

@Composable
private fun PermissionRow(
    item: PermissionItem,
    onOpen: () -> Unit,
    onOpenAppDetails: (() -> Unit)?,
) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    val (titleRes, whyRes) = when (item.kind) {
        PermissionKind.USAGE_ACCESS -> R.string.perm_usage_title to R.string.perm_usage_why
        PermissionKind.OVERLAY -> R.string.perm_overlay_title to R.string.perm_overlay_why
        PermissionKind.NOTIFICATIONS -> R.string.perm_notif_title to R.string.perm_notif_why
        PermissionKind.BATTERY_OPTIMIZATION -> R.string.perm_battery_title to R.string.perm_battery_why
        PermissionKind.ACCESSIBILITY -> R.string.perm_a11y_title to R.string.perm_a11y_why
        PermissionKind.EXACT_ALARM -> R.string.perm_exact_title to R.string.perm_exact_why
    }
    val (chipText, chipColor) = when {
        !item.applicable -> stringResource(R.string.perm_not_applicable) to colors.textMuted
        item.granted -> stringResource(R.string.perm_granted) to colors.success
        item.required -> stringResource(R.string.perm_missing) to colors.danger
        else -> stringResource(R.string.perm_optional) to colors.warning
    }
    DsCard(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = stringResource(titleRes),
                style = DisciplineTheme.typography.titleMedium,
                color = colors.textPrimary,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            DsBadge(text = chipText, color = chipColor)
        }
        Spacer(Modifier.height(spacing.xs))
        Text(
            text = stringResource(whyRes),
            style = DisciplineTheme.typography.bodyMedium,
            color = colors.textSecondary,
        )
        if (item.kind == PermissionKind.BATTERY_OPTIMIZATION && !item.granted) {
            Spacer(Modifier.height(spacing.xs))
            Text(
                text = stringResource(R.string.perm_battery_hint),
                style = DisciplineTheme.typography.bodySmall,
                color = colors.textMuted,
            )
        }
        if (item.applicable) {
            Spacer(Modifier.height(spacing.sm))
            Row(horizontalArrangement = Arrangement.spacedBy(spacing.sm), verticalAlignment = Alignment.CenterVertically) {
                DsSecondaryButton(text = stringResource(R.string.perm_open_settings), onClick = onOpen)
                if (onOpenAppDetails != null) {
                    TextButton(onClick = onOpenAppDetails) {
                        Text(stringResource(R.string.perm_app_details), color = colors.primarySoft)
                    }
                }
            }
        }
    }
}
