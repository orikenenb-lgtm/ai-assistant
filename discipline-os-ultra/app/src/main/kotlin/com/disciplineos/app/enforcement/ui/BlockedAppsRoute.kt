package com.disciplineos.app.enforcement.ui

import android.content.Context
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.SearchOff
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsEmptyState
import com.disciplineos.app.designsystem.component.DsLoadingState
import com.disciplineos.app.designsystem.component.DsSectionHeader
import com.disciplineos.app.designsystem.component.DsTextField
import com.disciplineos.app.designsystem.component.DsTopBar
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.enforcement.DeviceProtectedPackages
import com.disciplineos.core.domain.blocker.DefaultBlockTargets
import com.disciplineos.core.domain.blocker.ProtectedPackages
import com.disciplineos.core.domain.repository.BlockerRepository
import com.disciplineos.core.model.BlockedApp
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject

data class AppRow(
    val app: InstalledApp,
    val blocked: Boolean,
    val protected: Boolean,
    val suggested: Boolean,
)

data class BlockedAppsUiState(
    val loading: Boolean = true,
    val query: String = "",
    val suggested: List<AppRow> = emptyList(),
    val others: List<AppRow> = emptyList(),
    val selectedCount: Int = 0,
)

@HiltViewModel
class BlockedAppsViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val appsRepository: InstalledAppsRepository,
    private val blockerRepository: BlockerRepository,
    private val deviceProtected: DeviceProtectedPackages,
) : ViewModel() {

    private val query = MutableStateFlow("")
    private val apps = MutableStateFlow<List<InstalledApp>?>(null)
    private val writeMutex = Mutex()

    init {
        viewModelScope.launch { apps.value = runCatching { appsRepository.launchableApps() }.getOrDefault(emptyList()) }
    }

    val state: StateFlow<BlockedAppsUiState> = combine(
        apps,
        blockerRepository.observeBlockedApps(),
        blockerRepository.observeConfig(),
        query,
    ) { installed, blockedApps, config, q ->
        if (installed == null) return@combine BlockedAppsUiState(loading = true, query = q)
        val blocked = blockedApps.filter { it.enabled }.mapTo(HashSet()) { it.packageName }
        val device = deviceProtected.get()
        val rows = installed.map { app ->
            val isProtected = deviceProtected.contains(app.packageName) || runCatching {
                ProtectedPackages.isProtected(app.packageName, context.packageName, device, config.userExemptPackages)
            }.getOrDefault(false)
            AppRow(
                app = app,
                blocked = app.packageName in blocked && !isProtected,
                protected = isProtected,
                suggested = app.packageName in DefaultBlockTargets.SUGGESTED,
            )
        }
        val needle = q.trim()
        val filtered = if (needle.isEmpty()) rows else rows.filter {
            it.app.label.contains(needle, ignoreCase = true) || it.app.packageName.contains(needle, ignoreCase = true)
        }
        BlockedAppsUiState(
            loading = false,
            query = q,
            suggested = if (needle.isEmpty()) filtered.filter { it.suggested && !it.protected } else emptyList(),
            others = if (needle.isEmpty()) filtered.filterNot { it.suggested && !it.protected } else filtered,
            selectedCount = rows.count { it.blocked },
        )
    }
        .flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BlockedAppsUiState())

    fun onQueryChange(value: String) {
        query.value = value.take(60)
    }

    fun toggle(row: AppRow, block: Boolean) {
        if (row.protected) return
        viewModelScope.launch {
            writeMutex.withLock {
                val current = blockerRepository.observeBlockedApps().first()
                val without = current.filterNot { it.packageName == row.app.packageName }
                val updated = if (block) {
                    without + BlockedApp(
                        packageName = row.app.packageName,
                        label = row.app.label,
                        enabled = true,
                        suggestedByDefault = row.suggested,
                    )
                } else {
                    without
                }
                blockerRepository.setBlockedApps(updated)
            }
        }
    }
}

@Composable
fun BlockedAppsRoute(
    onBack: () -> Unit,
    viewModel: BlockedAppsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    BlockedAppsScreen(state = state, onBack = onBack, onQueryChange = viewModel::onQueryChange, onToggle = viewModel::toggle)
}

@Composable
fun BlockedAppsScreen(
    state: BlockedAppsUiState,
    onBack: () -> Unit,
    onQueryChange: (String) -> Unit,
    onToggle: (AppRow, Boolean) -> Unit,
) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    Column(Modifier.fillMaxSize().background(colors.background)) {
        DsTopBar(title = stringResource(R.string.apps_title), onBack = onBack)
        DsTextField(
            value = state.query,
            onValueChange = onQueryChange,
            label = stringResource(R.string.apps_search),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = spacing.screenGutter),
        )
        if (!state.loading) {
            Text(
                text = stringResource(R.string.apps_selected_count, state.selectedCount),
                style = DisciplineTheme.typography.labelLarge,
                color = colors.textSecondary,
                modifier = Modifier.padding(horizontal = spacing.screenGutter, vertical = spacing.sm),
            )
        }
        when {
            state.loading -> DsLoadingState(message = stringResource(R.string.apps_loading))
            state.suggested.isEmpty() && state.others.isEmpty() -> DsEmptyState(
                title = stringResource(if (state.query.isBlank()) R.string.apps_empty else R.string.apps_empty_search),
                message = "",
                icon = Icons.Filled.SearchOff,
            )
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize().navigationBarsPadding(),
                verticalArrangement = Arrangement.spacedBy(spacing.xxs),
            ) {
                if (state.suggested.isNotEmpty()) {
                    item(key = "h_suggested") {
                        DsSectionHeader(
                            title = stringResource(R.string.apps_suggested_header),
                            modifier = Modifier.padding(horizontal = spacing.screenGutter),
                        )
                    }
                    items(state.suggested, key = { "s_" + it.app.packageName }) { row -> AppToggleRow(row, onToggle) }
                }
                item(key = "h_all") {
                    DsSectionHeader(
                        title = stringResource(R.string.apps_all_header),
                        modifier = Modifier.padding(horizontal = spacing.screenGutter),
                    )
                }
                items(state.others, key = { "a_" + it.app.packageName }) { row -> AppToggleRow(row, onToggle) }
                item(key = "bottom") { Spacer(Modifier.padding(spacing.xl)) }
            }
        }
    }
}

@Composable
private fun AppToggleRow(row: AppRow, onToggle: (AppRow, Boolean) -> Unit) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    val toggleDescription = stringResource(R.string.apps_toggle_cd, row.app.label)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .toggleable(
                value = row.blocked,
                enabled = !row.protected,
                role = Role.Switch,
                onValueChange = { onToggle(row, it) },
            )
            .semantics { contentDescription = toggleDescription }
            .alpha(if (row.protected) 0.55f else 1f)
            .padding(horizontal = spacing.screenGutter, vertical = spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(spacing.md),
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(colors.surface),
            contentAlignment = Alignment.Center,
        ) {
            val icon = row.app.icon
            if (icon != null) {
                Image(bitmap = icon, contentDescription = null, modifier = Modifier.size(40.dp))
            } else {
                Icon(Icons.Filled.Apps, contentDescription = null, tint = colors.textSecondary)
            }
        }
        Column(Modifier.weight(1f)) {
            Text(text = row.app.label, style = DisciplineTheme.typography.bodyLarge, color = colors.textPrimary)
            if (row.protected) {
                Text(
                    text = stringResource(R.string.apps_protected),
                    style = DisciplineTheme.typography.bodySmall,
                    color = colors.textMuted,
                )
            }
        }
        Switch(checked = row.blocked, onCheckedChange = null, enabled = !row.protected)
    }
}
