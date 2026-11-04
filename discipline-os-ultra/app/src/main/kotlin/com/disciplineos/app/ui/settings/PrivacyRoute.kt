package com.disciplineos.app.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsCard
import com.disciplineos.app.designsystem.component.DsErrorState
import com.disciplineos.app.designsystem.component.DsLoadingState
import com.disciplineos.app.designsystem.component.DsSectionHeader
import com.disciplineos.app.designsystem.component.DsSwitchRow
import com.disciplineos.app.designsystem.component.DsTopBar
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import kotlin.math.roundToInt

/** Navigation entry point (see Routes.PRIVACY). */
@Composable
fun PrivacyRoute(onBack: () -> Unit, viewModel: PrivacyViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    val snackbar = remember { SnackbarHostState() }
    val saveError = stringResource(R.string.feat_settings_error_save)
    LaunchedEffect(state.saveFailed) {
        if (state.saveFailed) {
            snackbar.showSnackbar(saveError)
            viewModel.dismissSaveError()
        }
    }

    Scaffold(
        containerColor = colors.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = { DsTopBar(title = stringResource(R.string.feat_privacy_title), onBack = onBack) },
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
                // ----- Local-first explanation -----
                DsCard(Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.PhoneAndroid, contentDescription = null, tint = colors.success)
                        Spacer(Modifier.size(spacing.sm))
                        Text(
                            stringResource(R.string.feat_privacy_local_title),
                            style = MaterialTheme.typography.titleMedium,
                            color = colors.textPrimary,
                        )
                    }
                    Spacer(Modifier.height(spacing.sm))
                    Text(
                        stringResource(R.string.feat_privacy_local_body),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textSecondary,
                    )
                }

                // ----- AI coach -----
                DsSectionHeader(stringResource(R.string.feat_privacy_section_ai))
                DsCard(Modifier.fillMaxWidth()) {
                    DsSwitchRow(
                        title = stringResource(R.string.feat_privacy_remote),
                        subtitle = stringResource(R.string.feat_privacy_remote_sub),
                        checked = state.privacy.remoteProviderEnabled,
                        onCheckedChange = viewModel::setRemoteEnabled,
                    )
                    if (state.privacy.remoteProviderEnabled && !state.backendConfigured) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = spacing.xs)) {
                            Icon(Icons.Filled.Warning, contentDescription = null, tint = colors.warning, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.size(spacing.sm))
                            Text(
                                stringResource(R.string.feat_privacy_no_backend),
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.warning,
                            )
                        }
                    }
                    Spacer(Modifier.height(spacing.sm))
                    Disclosure(remoteEnabled = state.privacy.remoteProviderEnabled)
                }

                DsSectionHeader(stringResource(R.string.feat_privacy_section_sharing))
                DsCard(Modifier.fillMaxWidth()) {
                    DsSwitchRow(
                        title = stringResource(R.string.feat_privacy_share_titles),
                        subtitle = stringResource(R.string.feat_privacy_share_titles_sub),
                        checked = state.privacy.shareTaskTitles,
                        onCheckedChange = viewModel::setShareTaskTitles,
                        enabled = state.privacy.remoteProviderEnabled,
                    )
                    DsSwitchRow(
                        title = stringResource(R.string.feat_privacy_share_usage),
                        subtitle = stringResource(R.string.feat_privacy_share_usage_sub),
                        // Not wired yet: no app-usage summary is ever built, so the switch is shown as off and disabled.
                        checked = false,
                        onCheckedChange = viewModel::setShareAppUsage,
                        enabled = false,
                    )
                    if (!state.privacy.remoteProviderEnabled) {
                        Text(
                            stringResource(R.string.feat_privacy_sharing_inactive),
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textMuted,
                        )
                    }
                }

                DsSectionHeader(stringResource(R.string.feat_privacy_section_limit))
                DsCard(Modifier.fillMaxWidth()) {
                    DailyLimitSlider(value = state.privacy.dailyMessageLimit, onCommit = viewModel::setDailyLimit)
                }
                Spacer(Modifier.height(spacing.xl))
            }
        }
    }
}

@Composable
private fun Disclosure(remoteEnabled: Boolean) {
    val colors = DisciplineTheme.colors
    Row(verticalAlignment = Alignment.Top) {
        Icon(
            if (remoteEnabled) Icons.Filled.Cloud else Icons.Filled.PhoneAndroid,
            contentDescription = null,
            tint = colors.primarySoft,
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.size(DisciplineTheme.spacing.sm))
        Text(
            stringResource(if (remoteEnabled) R.string.feat_privacy_disclosure_remote else R.string.feat_privacy_disclosure_local),
            style = MaterialTheme.typography.bodySmall,
            color = colors.textSecondary,
        )
    }
}

@Composable
private fun DailyLimitSlider(value: Int, onCommit: (Int) -> Unit) {
    val colors = DisciplineTheme.colors
    val range = SettingsLogic.DAILY_LIMIT_RANGE
    // Local drag state; persisted only when the finger lifts (avoids a write per pixel).
    var dragging by remember(value) { mutableFloatStateOf(value.toFloat()) }
    val shown = dragging.roundToInt()
    val label = stringResource(R.string.feat_privacy_limit)
    val valueText = stringResource(R.string.feat_privacy_limit_value, shown)
    Column {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = MaterialTheme.typography.bodyLarge, color = colors.textPrimary)
            Text(valueText, style = MaterialTheme.typography.titleMedium, color = colors.primarySoft)
        }
        Slider(
            value = dragging,
            onValueChange = { dragging = it },
            onValueChangeFinished = { onCommit(dragging.roundToInt()) },
            valueRange = range.first.toFloat()..range.last.toFloat(),
            colors = SliderDefaults.colors(thumbColor = colors.primary, activeTrackColor = colors.primary, inactiveTrackColor = colors.surfaceSunken),
            modifier = Modifier
                .fillMaxWidth()
                .semantics { stateDescription = "$label: $valueText" },
        )
        Text(
            stringResource(R.string.feat_privacy_limit_sub),
            style = MaterialTheme.typography.bodySmall,
            color = colors.textSecondary,
        )
    }
}
