package com.disciplineos.app.data.local

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * Version history
 * - v1: initial schema (app/schemas/.../1.json).
 * - v2: `task_occurrences` gains
 *     - `snoozeCount INTEGER NOT NULL DEFAULT 0` — enables the snooze limit (TaskError.SNOOZE_LIMIT_REACHED).
 *       Existing rows are back-filled from the audit trail (number of SNOOZED history entries per occurrence),
 *       so a user who already snoozed something keeps an accurate count instead of a reset to 0.
 *     - `verificationNote TEXT` (nullable) — the self-reported proof note for REFLECTION_NOTE tasks.
 *
 * The DEFAULT 0 is mirrored by `@ColumnInfo(defaultValue = "0")` on the entity so that a migrated database
 * and a freshly created v2 database are identical (Room validates this, and MigrationTest checks it).
 */
object Migrations {

    val MIGRATION_1_2: Migration = object : Migration(1, 2) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE `task_occurrences` ADD COLUMN `snoozeCount` INTEGER NOT NULL DEFAULT 0")
            db.execSQL("ALTER TABLE `task_occurrences` ADD COLUMN `verificationNote` TEXT")
            db.execSQL(
                """
                UPDATE `task_occurrences`
                SET `snoozeCount` = (
                    SELECT COUNT(*) FROM `task_history` AS h
                    WHERE h.`occurrenceId` = `task_occurrences`.`id` AND h.`type` = 'SNOOZED'
                )
                WHERE EXISTS (
                    SELECT 1 FROM `task_history` AS h
                    WHERE h.`occurrenceId` = `task_occurrences`.`id` AND h.`type` = 'SNOOZED'
                )
                """.trimIndent(),
            )
        }
    }

    /** Every migration, in order. DataModule and MigrationTest both use this list. */
    val ALL: Array<Migration> = arrayOf(MIGRATION_1_2)
}
