package com.disciplineos.app.ui.settings

import android.app.LocaleManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.LocaleList
import androidx.annotation.RequiresApi
import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.disciplineos.app.R
import com.disciplineos.app.data.backup.BackupManager
import com.disciplineos.app.ui.focus.FocusFormat
import com.disciplineos.core.domain.blocker.RecoveryModeUseCase
import com.disciplineos.core.domain.repository.BlockerRepository
import com.disciplineos.core.domain.repository.DataWipeRepository
import com.disciplineos.core.domain.repository.FocusRepository
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.AppLanguage
import com.disciplineos.core.model.AppSettings
import com.disciplineos.core.model.BlockerConfig
import com.disciplineos.core.model.FocusConfig
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import javax.inject.Inject

data class InstalledApp(val packageName: String, val label: String)

/** One-shot user feedback (snackbar). [arg] is formatted into the string when non-null. */
data class SettingsMessage(@StringRes val res: Int, val arg: Any? = null, val id: Long = System.nanoTime())

data class SettingsUiState(
    val loading: Boolean = true,
    val loadFailed: Boolean = false,
    val settings: AppSettings = AppSettings(),
    val focusConfig: FocusConfig = FocusConfig(),
    val blockerConfig: BlockerConfig = BlockerConfig(),
    val now: Instant = Instant.EPOCH,
    val zone: ZoneId = ZoneId.systemDefault(),
    val installedApps: List<InstalledApp>? = null,
    val exporting: Boolean = false,
    val importing: Boolean = false,
    val wiping: Boolean = false,
    val message: SettingsMessage? = null,
) {
    val recoveryActive: Boolean get() = SettingsLogic.isRecoveryActive(blockerConfig.recoveryUntil, now)
    /** Per-app language is applied by the OS on Android 13+; older versions only store the preference. */
    val languageAppliedBySystem: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
}

private data class SettingsTransient(
    val installedApps: List<InstalledApp>? = null,
    val exporting: Boolean = false,
    val importing: Boolean = false,
    val wiping: Boolean = false,
    val message: SettingsMessage? = null,
)

private data class SettingsData(val settings: AppSettings, val focus: FocusConfig, val blocker: BlockerConfig)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository,
    private val focusRepository: FocusRepository,
    private val blockerRepository: BlockerRepository,
    private val recoveryMode: RecoveryModeUseCase,
    private val dataWipe: DataWipeRepository,
    private val backupManager: BackupManager,
    private val time: TimeProvider,
    @ApplicationContext private val context: Context,
) : ViewModel() {

    private val transient = MutableStateFlow(SettingsTransient())

    private val clock = flow {
        while (true) {
            emit(time.now())
            delay(30_000)
        }
    }

    private val data = combine(
        settingsRepository.observeSettings(),
        focusRepository.observeConfig(),
        blockerRepository.observeConfig(),
    ) { s, f, b -> Result.success(SettingsData(s, f, b)) }
        .catch { emit(Result.failure(it)) }

    val uiState: StateFlow<SettingsUiState> = combine(data, clock, transient) { d, now, t ->
        val loaded = d.getOrNull()
        SettingsUiState(
            loading = false,
            loadFailed = loaded == null,
            settings = loaded?.settings ?: AppSettings(),
            focusConfig = loaded?.focus ?: FocusConfig(),
            blockerConfig = loaded?.blocker ?: BlockerConfig(),
            now = now,
            zone = time.zone(),
            installedApps = t.installedApps,
            exporting = t.exporting,
            importing = t.importing,
            wiping = t.wiping,
            message = t.message,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SettingsUiState())

    // ---------- General settings ----------

    fun setNotificationsEnabled(enabled: Boolean) = updateSettings { it.copy(notificationsEnabled = enabled) }
    fun setHighContrast(enabled: Boolean) = updateSettings { it.copy(highContrast = enabled) }
    fun setReduceMotion(enabled: Boolean) = updateSettings { it.copy(reduceMotion = enabled) }
    fun setDailyPlanningTime(time: LocalTime) = updateSettings { it.copy(dailyPlanningTime = time) }
    fun setWeekStart(day: DayOfWeek) = updateSettings { it.copy(weekStart = day) }

    fun setLanguage(language: AppLanguage) {
        viewModelScope.launch {
            runCatching { settingsRepository.updateSettings { it.copy(language = language) } }
                .onFailure { postMessage(R.string.feat_settings_error_save) }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                runCatching { applyLocale(language) }.onFailure { postMessage(R.string.feat_settings_error_save) }
            } else {
                postMessage(R.string.feat_settings_language_saved_legacy)
            }
        }
    }

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun applyLocale(language: AppLanguage) {
        val localeManager = context.getSystemService(LocaleManager::class.java) ?: return
        val tag = SettingsLogic.languageTag(language)
        localeManager.applicationLocales = if (tag == null) LocaleList.getEmptyLocaleList() else LocaleList.forLanguageTags(tag)
    }

    fun setFocusConfig(config: FocusConfig) {
        viewModelScope.launch {
            runCatching { focusRepository.updateConfig { FocusFormat.sanitize(config) } }
                .onFailure { postMessage(R.string.feat_settings_error_save) }
        }
    }

    // ---------- Emergency exemptions ----------

    fun loadInstalledApps() {
        if (transient.value.installedApps != null) return
        viewModelScope.launch {
            val apps = withContext(Dispatchers.IO) { queryLaunchableApps() }
            transient.value = transient.value.copy(installedApps = apps)
        }
    }

    fun toggleExemption(packageName: String) {
        viewModelScope.launch {
            runCatching {
                blockerRepository.updateConfig { it.copy(userExemptPackages = SettingsLogic.toggle(it.userExemptPackages, packageName)) }
            }.onFailure { postMessage(R.string.feat_settings_error_save) }
        }
    }

    private fun queryLaunchableApps(): List<InstalledApp> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION")
        val activities = pm.queryIntentActivities(intent, 0)
        return activities
            .asSequence()
            .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
            .filter { (pkg, _) -> pkg != context.packageName }
            .distinctBy { it.first }
            .map { (pkg, label) -> InstalledApp(pkg, label) }
            .sortedBy { it.label.lowercase() }
            .toList()
    }

    // ---------- Recovery mode ----------

    fun enableRecovery(hours: Int) {
        viewModelScope.launch {
            runCatching { recoveryMode.enable(hours.coerceIn(1, 72)) }
                .onSuccess { postMessage(R.string.feat_settings_recovery_enabled_msg, hours) }
                .onFailure { postMessage(R.string.feat_settings_error_save) }
        }
    }

    fun disableRecovery() {
        viewModelScope.launch {
            runCatching { recoveryMode.disable() }
                .onSuccess { postMessage(R.string.feat_settings_recovery_disabled_msg) }
                .onFailure { postMessage(R.string.feat_settings_error_save) }
        }
    }

    // ---------- Backup ----------

    fun backupFileName(): String = SettingsLogic.backupFileName(time.today())

    fun exportTo(uri: Uri) {
        if (transient.value.exporting) return
        viewModelScope.launch {
            transient.value = transient.value.copy(exporting = true)
            val result = runCatching { backupManager.exportTo(uri) }.getOrElse { Result.failure(it) }
            transient.value = transient.value.copy(exporting = false)
            result.fold(
                onSuccess = { count -> postMessage(R.string.feat_settings_backup_export_done, count) },
                onFailure = { postMessage(R.string.feat_settings_backup_export_failed) },
            )
        }
    }

    fun importFrom(uri: Uri) {
        if (transient.value.importing) return
        viewModelScope.launch {
            transient.value = transient.value.copy(importing = true)
            val result = runCatching { backupManager.importFrom(uri) }.getOrElse { Result.failure(it) }
            transient.value = transient.value.copy(importing = false)
            result.fold(
                onSuccess = { count -> postMessage(R.string.feat_settings_backup_import_done, count) },
                onFailure = { postMessage(R.string.feat_settings_backup_import_failed) },
            )
        }
    }

    // ---------- Delete all data ----------

    fun wipeAll(confirmation: String) {
        if (!SettingsLogic.isDeleteConfirmed(confirmation) || transient.value.wiping) return
        viewModelScope.launch {
            transient.value = transient.value.copy(wiping = true)
            val result = runCatching { dataWipe.wipeAll() }
            transient.value = transient.value.copy(wiping = false)
            postMessage(if (result.isSuccess) R.string.feat_settings_delete_done else R.string.feat_settings_delete_failed)
        }
    }

    fun messageShown(id: Long) {
        if (transient.value.message?.id == id) transient.value = transient.value.copy(message = null)
    }

    private fun updateSettings(transform: (AppSettings) -> AppSettings) {
        viewModelScope.launch {
            runCatching { settingsRepository.updateSettings(transform) }
                .onFailure { postMessage(R.string.feat_settings_error_save) }
        }
    }

    private fun postMessage(@StringRes res: Int, arg: Any? = null) {
        transient.value = transient.value.copy(message = SettingsMessage(res, arg))
    }
}
