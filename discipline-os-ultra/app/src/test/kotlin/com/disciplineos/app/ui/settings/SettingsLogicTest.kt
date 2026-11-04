package com.disciplineos.app.ui.settings

import com.disciplineos.core.model.AppLanguage
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SettingsLogicTest {

    @Test fun deleteConfirmationRequiresExactWord() {
        assertTrue(SettingsLogic.isDeleteConfirmed("מחק"))
        assertTrue(SettingsLogic.isDeleteConfirmed("  מחק "))
        assertFalse(SettingsLogic.isDeleteConfirmed(""))
        assertFalse(SettingsLogic.isDeleteConfirmed("מח"))
        assertFalse(SettingsLogic.isDeleteConfirmed("מחק הכל"))
        assertFalse(SettingsLogic.isDeleteConfirmed("delete"))
    }

    @Test fun recoveryActiveOnlyInFuture() {
        val now = Instant.parse("2026-11-04T10:00:00Z")
        assertTrue(SettingsLogic.isRecoveryActive(now.plusSeconds(60), now))
        assertFalse(SettingsLogic.isRecoveryActive(now, now))
        assertFalse(SettingsLogic.isRecoveryActive(now.minusSeconds(1), now))
        assertFalse(SettingsLogic.isRecoveryActive(null, now))
    }

    @Test fun recoveryPresetsWithinDomainBounds() {
        assertTrue(SettingsLogic.RECOVERY_PRESETS.all { it in 1..72 })
    }

    @Test fun languageTags() {
        assertEquals("he", SettingsLogic.languageTag(AppLanguage.HEBREW))
        assertEquals("en", SettingsLogic.languageTag(AppLanguage.ENGLISH))
        assertNull(SettingsLogic.languageTag(AppLanguage.SYSTEM))
    }

    @Test fun backupFileNameAndClock() {
        assertEquals("discipline-os-backup-2026-11-04.json", SettingsLogic.backupFileName(LocalDate.of(2026, 11, 4)))
        assertEquals("12:30", SettingsLogic.clockTime(Instant.parse("2026-11-04T10:30:00Z"), ZoneId.of("Asia/Jerusalem")))
    }

    @Test fun toggleExemption() {
        assertEquals(setOf("a", "b"), SettingsLogic.toggle(setOf("a"), "b"))
        assertEquals(setOf("a"), SettingsLogic.toggle(setOf("a", "b"), "b"))
    }
}
