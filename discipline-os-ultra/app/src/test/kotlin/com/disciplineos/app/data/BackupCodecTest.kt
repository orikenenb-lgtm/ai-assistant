package com.disciplineos.app.data

import com.disciplineos.app.data.backup.BackupCodec
import com.disciplineos.app.data.backup.BackupFormatException
import com.disciplineos.app.data.backup.BackupFormatException.Reason
import com.disciplineos.app.data.backup.BackupSnapshot
import com.disciplineos.app.data.local.entity.TaskOccurrenceEntity
import java.time.Instant
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class BackupCodecTest {

    private val exportedAt = Instant.parse("2026-11-04T20:00:00Z")

    private fun normalize(s: BackupSnapshot) = s.copy(
        dependencies = s.dependencies.sortedWith(compareBy({ it.taskId }, { it.dependsOnTaskId })),
        subTasks = s.subTasks.sortedBy { it.id },
    )

    @Test
    fun roundTrip_preservesEverything() {
        val snap = backupTestSnapshot()
        val decoded = BackupCodec.decode(BackupCodec.encode(snap, exportedAt))
        assertEquals(normalize(snap), normalize(decoded))
        assertEquals(snap.recordCount, decoded.recordCount)
    }

    @Test
    fun export_excludesChatAndBypassAndAiPrivacy() {
        val text = BackupCodec.encode(backupTestSnapshot(), exportedAt)
        assertFalse(text.contains("chat", ignoreCase = true))
        assertFalse(text.contains("bypass\"", ignoreCase = true))
        assertFalse(text.contains("remoteProviderEnabled"))
        assertTrue(text.contains("\"schemaVersion\": 1"))
    }

    private fun reasonOf(text: String): Reason = assertFailsWith<BackupFormatException> { BackupCodec.decode(text) }.reason

    private fun mutate(transform: (String) -> String): String = transform(BackupCodec.encode(backupTestSnapshot(), exportedAt))

    @Test
    fun rejects_unknownSchemaVersion() {
        assertEquals(Reason.UNSUPPORTED_SCHEMA_VERSION, reasonOf(mutate { it.replace("\"schemaVersion\": 1", "\"schemaVersion\": 99") }))
    }

    @Test
    fun rejects_missingSchemaVersion_andForeignFiles() {
        assertEquals(Reason.MALFORMED_JSON, reasonOf("""{"app":"discipline-os","exportedAt":"2026-11-04T20:00:00Z"}"""))
        assertEquals(Reason.NOT_A_BACKUP, reasonOf("""{"schemaVersion":1,"app":"other","exportedAt":"2026-11-04T20:00:00Z"}"""))
        assertEquals(Reason.MALFORMED_JSON, reasonOf("not json at all"))
        assertEquals(Reason.MALFORMED_JSON, reasonOf("[]"))
    }

    @Test
    fun rejects_oversizedInput() {
        val huge = "x".repeat(BackupCodec.MAX_BYTES + 1)
        assertEquals(Reason.TOO_LARGE, reasonOf(huge))
    }

    @Test
    fun rejects_tooLongTitle_andBlankTitle() {
        val long = "א".repeat(BackupCodec.MAX_TITLE + 1)
        assertEquals(Reason.LIMIT_EXCEEDED, reasonOf(mutate { it.replace("\"Task one\"", "\"$long\"") }))
        assertEquals(Reason.INVALID_VALUE, reasonOf(mutate { it.replace("\"Task one\"", "\"   \"") }))
    }

    @Test
    fun rejects_invalidEnumAndDate() {
        assertEquals(Reason.INVALID_VALUE, reasonOf(mutate { it.replace("\"MANDATORY\"", "\"SUPER\"") }))
        assertEquals(Reason.INVALID_VALUE, reasonOf(mutate { it.replace("\"2026-11-04\"", "\"2026-13-40\"") }))
        assertEquals(Reason.INVALID_VALUE, reasonOf(mutate { it.replace("\"Asia/Jerusalem\"", "\"Mars/Base\"") }))
    }

    @Test
    fun rejects_brokenReferences() {
        val s = backupTestSnapshot()
        val orphan = s.copy(occurrences = s.occurrences + TaskOccurrenceEntity(99, 12345, LocalDate.of(2026, 11, 4), null, "PENDING", null, null))
        val e = assertFailsWith<BackupFormatException> { BackupCodec.decode(BackupCodec.encode(orphan, exportedAt)) }
        assertEquals(Reason.BROKEN_REFERENCE, e.reason)
        assertTrue(e.path.startsWith("occurrences["))
    }

    @Test
    fun rejects_duplicates() {
        val s = backupTestSnapshot()
        val dupOcc = s.copy(occurrences = s.occurrences + s.occurrences.first().copy(id = 500))
        assertEquals(Reason.DUPLICATE, assertFailsWith<BackupFormatException> { BackupCodec.decode(BackupCodec.encode(dupOcc, exportedAt)) }.reason)
        val dupXp = s.copy(xpEvents = s.xpEvents + s.xpEvents.first().copy(id = 600))
        assertEquals(Reason.DUPLICATE, assertFailsWith<BackupFormatException> { BackupCodec.decode(BackupCodec.encode(dupXp, exportedAt)) }.reason)
    }

    @Test
    fun errorMessages_neverContainUserContent() {
        val secret = "my-very-private-title"
        val long = secret + "x".repeat(BackupCodec.MAX_TITLE)
        val e = assertFailsWith<BackupFormatException> { BackupCodec.decode(mutate { it.replace("\"Task one\"", "\"$long\"") }) }
        assertFalse(e.message!!.contains(secret))
        assertEquals("tasks[0].title", e.path)
    }

    @Test
    fun unknownFields_areIgnoredWithinSameVersion() {
        val text = mutate { it.replaceFirst("{", "{\"futureField\": {\"a\": 1},") }
        assertEquals(normalize(backupTestSnapshot()), normalize(BackupCodec.decode(text)))
    }

    @Test
    fun emptyBackup_isValid() {
        val text = BackupCodec.encode(BackupSnapshot(), exportedAt)
        assertEquals(0, BackupCodec.decode(text).recordCount)
    }

}
