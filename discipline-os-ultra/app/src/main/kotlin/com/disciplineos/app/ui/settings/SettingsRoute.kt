package com.disciplineos.app.ui.settings

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Accessibility
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.HealthAndSafety
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PrivacyTip
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.SelfImprovement
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.disciplineos.app.BuildConfig
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsCard
import com.disciplineos.app.designsystem.component.DsChip
import com.disciplineos.app.designsystem.component.DsConfirmDialog
import com.disciplineos.app.designsystem.component.DsDangerButton
import com.disciplineos.app.designsystem.component.DsErrorState
import com.disciplineos.app.designsystem.component.DsListRow
import com.disciplineos.app.designsystem.component.DsLoadingState
import com.disciplineos.app.designsystem.component.DsPrimaryButton
import com.disciplineos.app.designsystem.component.DsSecondaryButton
import com.disciplineos.app.designsystem.component.DsSectionHeader
import com.disciplineos.app.designsystem.component.DsSwitchRow
import com.disciplineos.app.designsystem.component.DsTextField
import com.disciplineos.app.designsystem.component.DsTopBar
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.ui.focus.FocusConfigEditor
import com.disciplineos.core.model.AppLanguage
import com.disciplineos.core.model.FocusConfig
import java.time.DayOfWeek
import java.time.LocalTime
import java.time.format.TextStyle
import java.util.Locale

private enum class SettingsDialog { NONE, TIME, FOCUS, EXEMPTIONS, IMPORT_CONFIRM, DELETE }

/** Navigation entry point (see Routes.SETTINGS). */
@Composable
fun SettingsRoute(
    onOpenBlockedApps: () -> Unit,
    onOpenPermissions: () -> Unit,
    onOpenPrivacy: () -> Unit,
    onBack: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var dialog by rememberSaveable { mutableStateOf(SettingsDialog.NONE) }

    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) viewModel.exportTo(uri)
    }
    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) viewModel.importFrom(uri)
    }

    val message = state.message
    val messageText = message?.let { if (it.arg != null) stringResource(it.res, it.arg) else stringResource(it.res) }
    LaunchedEffect(message?.id) {
        if (message != null && messageText != null) {
            snackbar.showSnackbar(messageText)
            viewModel.messageShown(message.id)
        }
    }

    Scaffold(
        containerColor = colors.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = { DsTopBar(title = stringResource(R.string.feat_settings_title), onBack = onBack) },
    ) { padding ->
        when {
            state.loading -> DsLoadingState(Modifier.padding(padding).fillMaxSize(), message = stringResource(R.string.feat_loading))
            state.loadFailed -> DsErrorState(stringResource(R.string.feat_settings_error_load), Modifier.padding(padding).fillMaxSize())
            else -> Column(
                Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = spacing.screenGutter, vertical = spacing.md),
                verticalArrangement = Arrangement.spacedBy(spacing.md),
            ) {
                // ----- Blocker & permissions -----
                DsSectionHeader(stringResource(R.string.feat_settings_section_blocker))
                DsCard(Modifier.fillMaxWidth(), contentPadding = PaddingValues(vertical = spacing.xs)) {
                    DsListRow(
                        title = stringResource(R.string.feat_settings_blocked_apps),
                        subtitle = stringResource(R.string.feat_settings_blocked_apps_sub),
                        leadingIcon = Icons.Filled.Block,
                        onClick = onOpenBlockedApps,
                    )
                    DsListRow(
                        title = stringResource(R.string.feat_settings_permissions),
                        subtitle = stringResource(R.string.feat_settings_permissions_sub),
                        leadingIcon = Icons.Filled.Security,
                        onClick = onOpenPermissions,
                    )
                    DsListRow(
                        title = stringResource(R.string.feat_settings_exemptions),
                        subtitle = stringResource(R.string.feat_settings_exemptions_sub, state.blockerConfig.userExemptPackages.size),
                        leadingIcon = Icons.Filled.HealthAndSafety,
                        onClick = {
                            viewModel.loadInstalledApps()
                            dialog = SettingsDialog.EXEMPTIONS
                        },
                    )
                }

                // ----- Recovery mode -----
                DsSectionHeader(stringResource(R.string.feat_settings_section_recovery))
                RecoveryCard(state = state, onEnable = viewModel::enableRecovery, onDisable = viewModel::disableRecovery)

                // ----- Notifications -----
                DsSectionHeader(stringResource(R.string.feat_settings_section_notifications))
                DsCard(Modifier.fillMaxWidth()) {
                    DsSwitchRow(
                        title = stringResource(R.string.feat_settings_notifications),
                        subtitle = stringResource(R.string.feat_settings_notifications_sub),
                        checked = state.settings.notificationsEnabled,
                        onCheckedChange = viewModel::setNotificationsEnabled,
                    )
                    DsListRow(
                        title = stringResource(R.string.feat_settings_notifications_system),
                        leadingIcon = Icons.Filled.Notifications,
                        onClick = { openNotificationSettings(context) },
                    )
                }

                // ----- Language -----
                DsSectionHeader(stringResource(R.string.feat_settings_section_language))
                DsCard(Modifier.fillMaxWidth()) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(spacing.sm),
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                    ) {
                        listOf(
                            AppLanguage.HEBREW to R.string.feat_settings_language_he,
                            AppLanguage.ENGLISH to R.string.feat_settings_language_en,
                            AppLanguage.SYSTEM to R.string.feat_settings_language_system,
                        ).forEach { (lang, label) ->
                            DsChip(
                                label = stringResource(label),
                                selected = state.settings.language == lang,
                                onClick = { viewModel.setLanguage(lang) },
                                leadingIcon = if (state.settings.language == lang) Icons.Filled.Language else null,
                            )
                        }
                    }
                    if (!state.languageAppliedBySystem) {
                        Spacer(Modifier.height(spacing.sm))
                        Text(
                            stringResource(R.string.feat_settings_language_legacy_note),
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textSecondary,
                        )
                    }
                }

                // ----- Accessibility -----
                DsSectionHeader(stringResource(R.string.feat_settings_section_accessibility))
                DsCard(Modifier.fillMaxWidth()) {
                    DsSwitchRow(
                        title = stringResource(R.string.feat_settings_high_contrast),
                        subtitle = stringResource(R.string.feat_settings_high_contrast_sub),
                        checked = state.settings.highContrast,
                        onCheckedChange = viewModel::setHighContrast,
                    )
                    DsSwitchRow(
                        title = stringResource(R.string.feat_settings_reduce_motion),
                        subtitle = stringResource(R.string.feat_settings_reduce_motion_sub),
                        checked = state.settings.reduceMotion,
                        onCheckedChange = viewModel::setReduceMotion,
                    )
                }

                // ----- Planning -----
                DsSectionHeader(stringResource(R.string.feat_settings_section_planning))
                DsCard(Modifier.fillMaxWidth()) {
                    DsListRow(
                        title = stringResource(R.string.feat_settings_planning_time),
                        subtitle = stringResource(R.string.feat_settings_planning_time_sub),
                        leadingIcon = Icons.Filled.Schedule,
                        trailing = {
                            Text(
                                formatTime(state.settings.dailyPlanningTime),
                                style = MaterialTheme.typography.titleMedium,
                                color = colors.primarySoft,
                            )
                        },
                        onClick = { dialog = SettingsDialog.TIME },
                    )
                    Spacer(Modifier.height(spacing.sm))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.CalendarMonth, contentDescription = null, tint = colors.textSecondary)
                        Spacer(Modifier.padding(start = spacing.sm))
                        Text(stringResource(R.string.feat_settings_week_start), style = MaterialTheme.typography.bodyLarge, color = colors.textPrimary)
                    }
                    Spacer(Modifier.height(spacing.sm))
                    val locale = Locale.getDefault()
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(spacing.sm),
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                    ) {
                        listOf(DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.SATURDAY).forEach { day ->
                            DsChip(
                                label = day.getDisplayName(TextStyle.FULL, locale),
                                selected = state.settings.weekStart == day,
                                onClick = { viewModel.setWeekStart(day) },
                            )
                        }
                    }
                }

                // ----- Focus defaults -----
                DsSectionHeader(stringResource(R.string.feat_settings_section_focus))
                DsCard(Modifier.fillMaxWidth(), contentPadding = PaddingValues(vertical = spacing.xs)) {
                    DsListRow(
                        title = stringResource(R.string.feat_settings_focus_defaults),
                        subtitle = stringResource(
                            R.string.feat_settings_focus_summary,
                            state.focusConfig.workMinutes,
                            state.focusConfig.shortBreakMinutes,
                            state.focusConfig.longBreakMinutes,
                        ),
                        leadingIcon = Icons.Filled.Timer,
                        onClick = { dialog = SettingsDialog.FOCUS },
                    )
                }

                // ----- Privacy -----
                DsSectionHeader(stringResource(R.string.feat_settings_section_privacy))
                DsCard(Modifier.fillMaxWidth(), contentPadding = PaddingValues(vertical = spacing.xs)) {
                    DsListRow(
                        title = stringResource(R.string.feat_settings_privacy),
                        subtitle = stringResource(R.string.feat_settings_privacy_sub),
                        leadingIcon = Icons.Filled.PrivacyTip,
                        onClick = onOpenPrivacy,
                    )
                }

                // ----- Backup -----
                DsSectionHeader(stringResource(R.string.feat_settings_section_backup))
                DsCard(Modifier.fillMaxWidth()) {
                    Text(
                        stringResource(R.string.feat_settings_backup_body),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textSecondary,
                    )
                    Spacer(Modifier.height(spacing.md))
                    DsPrimaryButton(
                        text = stringResource(R.string.feat_settings_backup_export),
                        onClick = { exportLauncher.launch(viewModel.backupFileName()) },
                        loading = state.exporting,
                        enabled = !state.exporting && !state.importing,
                        icon = Icons.Filled.FileUpload,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(spacing.sm))
                    DsSecondaryButton(
                        text = stringResource(if (state.importing) R.string.feat_settings_backup_importing else R.string.feat_settings_backup_import),
                        onClick = { dialog = SettingsDialog.IMPORT_CONFIRM },
                        enabled = !state.exporting && !state.importing,
                        icon = Icons.Filled.FileDownload,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                // ----- Danger zone -----
                DsSectionHeader(stringResource(R.string.feat_settings_section_danger))
                DsCard(Modifier.fillMaxWidth()) {
                    Text(
                        stringResource(R.string.feat_settings_delete_body),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textSecondary,
                    )
                    Spacer(Modifier.height(spacing.md))
                    DsDangerButton(
                        text = stringResource(R.string.feat_settings_delete),
                        onClick = { dialog = SettingsDialog.DELETE },
                        enabled = !state.wiping,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                // ----- About -----
                DsSectionHeader(stringResource(R.string.feat_settings_section_about))
                DsCard(Modifier.fillMaxWidth(), contentPadding = PaddingValues(vertical = spacing.xs)) {
                    DsListRow(
                        title = stringResource(R.string.feat_settings_version, BuildConfig.VERSION_NAME),
                        subtitle = stringResource(R.string.feat_settings_about_sub),
                        leadingIcon = Icons.Filled.Info,
                    )
                }
                Spacer(Modifier.height(spacing.xl))
            }
        }
    }

    when (dialog) {
        SettingsDialog.NONE -> Unit
        SettingsDialog.TIME -> PlanningTimeDialog(
            initial = state.settings.dailyPlanningTime,
            onConfirm = {
                viewModel.setDailyPlanningTime(it)
                dialog = SettingsDialog.NONE
            },
            onDismiss = { dialog = SettingsDialog.NONE },
        )
        SettingsDialog.FOCUS -> FocusDefaultsSheet(
            state = state,
            onSave = {
                viewModel.setFocusConfig(it)
                dialog = SettingsDialog.NONE
            },
            onDismiss = { dialog = SettingsDialog.NONE },
        )
        SettingsDialog.EXEMPTIONS -> ExemptionsDialog(
            apps = state.installedApps,
            selected = state.blockerConfig.userExemptPackages,
            onToggle = viewModel::toggleExemption,
            onDismiss = { dialog = SettingsDialog.NONE },
        )
        SettingsDialog.IMPORT_CONFIRM -> DsConfirmDialog(
            title = stringResource(R.string.feat_settings_import_confirm_title),
            message = stringResource(R.string.feat_settings_import_confirm_message),
            confirmLabel = stringResource(R.string.feat_settings_import_confirm),
            dismissLabel = stringResource(R.string.feat_cancel),
            destructive = true,
            onConfirm = {
                dialog = SettingsDialog.NONE
                importLauncher.launch(arrayOf("application/json", "text/plain", "application/octet-stream"))
            },
            onDismiss = { dialog = SettingsDialog.NONE },
        )
        SettingsDialog.DELETE -> DeleteAllDialog(
            wiping = state.wiping,
            onConfirm = { typed ->
                viewModel.wipeAll(typed)
                dialog = SettingsDialog.NONE
            },
            onDismiss = { dialog = SettingsDialog.NONE },
        )
    }
}

@Composable
private fun RecoveryCard(state: SettingsUiState, onEnable: (Int) -> Unit, onDisable: () -> Unit) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    DsCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.SelfImprovement, contentDescription = null, tint = colors.success)
            Spacer(Modifier.padding(start = spacing.sm))
            Text(
                if (state.recoveryActive) {
                    stringResource(
                        R.string.feat_settings_recovery_active,
                        SettingsLogic.clockTime(state.blockerConfig.recoveryUntil ?: state.now, state.zone),
                    )
                } else {
                    stringResource(R.string.feat_settings_recovery_inactive)
                },
                style = MaterialTheme.typography.titleSmall,
                color = colors.textPrimary,
            )
        }
        Spacer(Modifier.height(spacing.xs))
        Text(
            stringResource(R.string.feat_settings_recovery_body),
            style = MaterialTheme.typography.bodyMedium,
            color = colors.textSecondary,
        )
        Spacer(Modifier.height(spacing.md))
        Row(horizontalArrangement = Arrangement.spacedBy(spacing.sm), modifier = Modifier.fillMaxWidth()) {
            SettingsLogic.RECOVERY_PRESETS.forEach { hours ->
                DsSecondaryButton(
                    text = stringResource(R.string.feat_settings_recovery_hours, hours),
                    onClick = { onEnable(hours) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
        if (state.recoveryActive) {
            Spacer(Modifier.height(spacing.sm))
            DsPrimaryButton(
                text = stringResource(R.string.feat_settings_recovery_disable),
                onClick = onDisable,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlanningTimeDialog(initial: LocalTime, onConfirm: (LocalTime) -> Unit, onDismiss: () -> Unit) {
    val pickerState = rememberTimePickerState(initialHour = initial.hour, initialMinute = initial.minute, is24Hour = true)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.feat_settings_planning_time)) },
        text = { TimePicker(state = pickerState) },
        confirmButton = {
            TextButton(onClick = { onConfirm(LocalTime.of(pickerState.hour, pickerState.minute)) }) {
                Text(stringResource(R.string.feat_save))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.feat_cancel)) } },
        containerColor = DisciplineTheme.colors.surface,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FocusDefaultsSheet(state: SettingsUiState, onSave: (FocusConfig) -> Unit, onDismiss: () -> Unit) {
    val spacing = DisciplineTheme.spacing
    var draft by remember(state.focusConfig) { mutableStateOf(state.focusConfig) }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = DisciplineTheme.colors.surface,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = spacing.xl)
                .padding(bottom = spacing.xl)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(spacing.md),
        ) {
            Text(
                stringResource(R.string.feat_settings_focus_defaults),
                style = MaterialTheme.typography.titleLarge,
                color = DisciplineTheme.colors.textPrimary,
            )
            FocusConfigEditor(config = draft, onChange = { draft = it })
            DsPrimaryButton(text = stringResource(R.string.feat_save), onClick = { onSave(draft) }, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun ExemptionsDialog(
    apps: List<InstalledApp>?,
    selected: Set<String>,
    onToggle: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = DisciplineTheme.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.feat_settings_exemptions)) },
        text = {
            Column {
                Text(
                    stringResource(R.string.feat_settings_exemptions_dialog_body),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textSecondary,
                )
                Spacer(Modifier.height(DisciplineTheme.spacing.sm))
                when {
                    apps == null -> Row(
                        Modifier.fillMaxWidth().heightIn(min = 96.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) { CircularProgressIndicator() }
                    apps.isEmpty() -> Text(stringResource(R.string.feat_settings_exemptions_none), color = colors.textSecondary)
                    else -> LazyColumn(Modifier.heightIn(max = 380.dp)) {
                        items(apps, key = { it.packageName }) { app ->
                            val checked = app.packageName in selected
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(min = 48.dp)
                                    .toggleable(value = checked, role = Role.Checkbox, onValueChange = { onToggle(app.packageName) }),
                            ) {
                                Checkbox(checked = checked, onCheckedChange = null)
                                Spacer(Modifier.padding(start = DisciplineTheme.spacing.sm))
                                Text(app.label, style = MaterialTheme.typography.bodyLarge, color = colors.textPrimary)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.feat_done)) } },
        containerColor = colors.surface,
    )
}

@Composable
private fun DeleteAllDialog(wiping: Boolean, onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var typed by rememberSaveable { mutableStateOf("") }
    val confirmed = SettingsLogic.isDeleteConfirmed(typed)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.feat_settings_delete_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(DisciplineTheme.spacing.sm)) {
                Text(
                    stringResource(R.string.feat_settings_delete_message, SettingsLogic.DELETE_CONFIRM_WORD),
                    style = MaterialTheme.typography.bodyMedium,
                )
                DsTextField(
                    value = typed,
                    onValueChange = { typed = it },
                    label = stringResource(R.string.feat_settings_delete_field, SettingsLogic.DELETE_CONFIRM_WORD),
                    maxLength = 10,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(typed) }, enabled = confirmed && !wiping) {
                Text(stringResource(R.string.feat_settings_delete_confirm), color = if (confirmed) DisciplineTheme.colors.danger else DisciplineTheme.colors.textMuted)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.feat_cancel)) } },
        containerColor = DisciplineTheme.colors.surface,
    )
}

private fun formatTime(time: LocalTime): String = String.format(Locale.ROOT, "%02d:%02d", time.hour, time.minute)

private fun openNotificationSettings(context: Context) {
    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        context.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.fromParts("package", context.packageName, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}
