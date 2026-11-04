package com.disciplineos.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.disciplineos.app.data.local.dao.BackupDao
import com.disciplineos.app.data.local.dao.BlockerDao
import com.disciplineos.app.data.local.dao.ChatDao
import com.disciplineos.app.data.local.dao.FocusDao
import com.disciplineos.app.data.local.dao.GamificationDao
import com.disciplineos.app.data.local.dao.TaskDao
import com.disciplineos.app.data.local.entity.AchievementEntity
import com.disciplineos.app.data.local.entity.BlockedAppEntity
import com.disciplineos.app.data.local.entity.BypassSessionEntity
import com.disciplineos.app.data.local.entity.CategoryEntity
import com.disciplineos.app.data.local.entity.ChatMessageEntity
import com.disciplineos.app.data.local.entity.FocusSessionEntity
import com.disciplineos.app.data.local.entity.StreakFreezeEntity
import com.disciplineos.app.data.local.entity.SubTaskEntity
import com.disciplineos.app.data.local.entity.TaskDependencyEntity
import com.disciplineos.app.data.local.entity.TaskEntity
import com.disciplineos.app.data.local.entity.TaskHistoryEntity
import com.disciplineos.app.data.local.entity.TaskOccurrenceEntity
import com.disciplineos.app.data.local.entity.XpEventEntity

/**
 * Single local database. Schema history is exported to `app/schemas/` (see docs/DATABASE.md).
 * Every version bump needs an explicit Migration in [Migrations] — destructive fallback is never enabled.
 */
@Database(
    entities = [
        CategoryEntity::class,
        TaskEntity::class,
        TaskDependencyEntity::class,
        SubTaskEntity::class,
        TaskOccurrenceEntity::class,
        TaskHistoryEntity::class,
        BlockedAppEntity::class,
        BypassSessionEntity::class,
        FocusSessionEntity::class,
        XpEventEntity::class,
        AchievementEntity::class,
        StreakFreezeEntity::class,
        ChatMessageEntity::class,
    ],
    version = DisciplineDatabase.VERSION,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class DisciplineDatabase : RoomDatabase() {
    abstract fun taskDao(): TaskDao
    abstract fun blockerDao(): BlockerDao
    abstract fun focusDao(): FocusDao
    abstract fun gamificationDao(): GamificationDao
    abstract fun chatDao(): ChatDao
    abstract fun backupDao(): BackupDao

    companion object {
        const val VERSION = 2
        const val NAME = "discipline.db"
    }
}
