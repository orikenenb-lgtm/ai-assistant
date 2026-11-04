package com.disciplineos.app.data.prefs

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import java.io.IOException

/**
 * DataStore `data` that degrades to empty preferences (= defaults) on read I/O errors instead of crashing
 * every collector. File corruption itself is handled by the ReplaceFileCorruptionHandler in DataModule.
 */
internal fun DataStore<Preferences>.safeData(): Flow<Preferences> =
    data.catch { e -> if (e is IOException) emit(emptyPreferences()) else throw e }
