package ai.noa.bridge.app.ui

import ai.noa.bridge.app.ui.components.RelativeTime
import ai.noa.bridge.app.ui.components.classifyRelativeTime
import ai.noa.bridge.app.ui.components.pendingCount
import ai.noa.bridge.app.ui.navigation.NavState
import ai.noa.bridge.app.ui.navigation.Overlay
import ai.noa.bridge.app.ui.navigation.Tab
import ai.noa.bridge.app.ui.preview.FakeAppController
import androidx.compose.runtime.saveable.SaverScope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId

/** Plain JVM tests (no Robolectric needed). */
class PureLogicTest {
    private val zone = ZoneId.of("Asia/Jerusalem")
    private fun at(h: Int, m: Int, day: Int = 15) = LocalDateTime.of(2026, 11, day, h, m).atZone(zone).toInstant().toEpochMilli()

    @Test
    fun relativeTime() {
        val now = at(14, 0)
        assertEquals(RelativeTime.JustNow, classifyRelativeTime(now, now - 20_000, zone))
        assertEquals(RelativeTime.Minutes(1), classifyRelativeTime(now, at(13, 59), zone))
        assertEquals(RelativeTime.Minutes(45), classifyRelativeTime(now, at(13, 15), zone))
        assertEquals(RelativeTime.Hours(2), classifyRelativeTime(now, at(12, 0), zone))
        assertEquals(RelativeTime.Yesterday("22:10"), classifyRelativeTime(now, at(22, 10, day = 14), zone))
        assertEquals(RelativeTime.Absolute("10.11.26, 09:05"), classifyRelativeTime(now, at(9, 5, day = 10), zone))
        // Clock skew (future timestamps) never shows negative values.
        assertEquals(RelativeTime.JustNow, classifyRelativeTime(now, now + 60_000, zone))
    }

    @Test
    fun pendingCountsOnlyDraftsWaitingForTheUser() {
        assertEquals(3, FakeAppController.sampleDrafts().pendingCount())
    }

    @Test
    fun navStateSurvivesSaveRestore() {
        val nav = NavState(Tab.DRAFTS)
        nav.push(Overlay.DraftDetail("draft-7"))
        nav.push(Overlay.Pairing)
        val scope = SaverScope { true }
        val saved = with(NavState.Saver) { scope.save(nav) }!!
        val restored = NavState.Saver.restore(saved)!!
        assertEquals(Tab.DRAFTS, restored.tab)
        assertEquals(Overlay.Pairing, restored.top)
        assertTrue(restored.pop())
        assertEquals(Overlay.DraftDetail("draft-7"), restored.top)
        restored.select(Tab.HOME)
        assertEquals(null, restored.top)
    }
}
