package com.disciplineos.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsChip
import com.disciplineos.app.designsystem.component.DsEmptyState
import com.disciplineos.app.designsystem.component.DsPrimaryButton
import com.disciplineos.app.designsystem.component.DsProgressRing
import com.disciplineos.app.designsystem.component.DsStatTile
import com.disciplineos.app.designsystem.component.DsSwitchRow
import com.disciplineos.app.designsystem.component.DsTextField
import com.disciplineos.app.designsystem.component.DsTopBar
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Design-system contract tests: RTL mirroring, Hebrew content descriptions, large-font robustness. */
@RunWith(AndroidJUnit4::class)
class DesignSystemTest {

    @get:Rule
    val compose = createComposeRule()

    private fun string(id: Int, vararg args: Any): String =
        InstrumentationRegistry.getInstrumentation().targetContext.getString(id, *args)

    private fun setThemed(direction: LayoutDirection = LayoutDirection.Rtl, fontScale: Float? = null, content: @Composable () -> Unit) {
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(
                LocalLayoutDirection provides direction,
                LocalDensity provides Density(density.density, fontScale ?: density.fontScale),
            ) {
                DisciplineTheme { content() }
            }
        }
    }

    @Test
    fun topBar_backButton_isOnTheRightInRtl_andHasHebrewDescription() {
        var backClicks = 0
        setThemed(LayoutDirection.Rtl) {
            DsTopBar(title = "כותרת", onBack = { backClicks++ })
        }
        val back = compose.onNodeWithContentDescription(string(R.string.core_cd_back))
        back.assertIsDisplayed()
        val backBounds = back.getBoundsInRoot()
        val titleBounds = compose.onNodeWithText("כותרת").getBoundsInRoot()
        assertTrue("Back arrow must sit at the start (right) edge in RTL", backBounds.left > titleBounds.left)
        back.performClick()
        assertEquals(1, backClicks)
    }

    @Test
    fun topBar_backButton_isOnTheLeftInLtr() {
        setThemed(LayoutDirection.Ltr) {
            DsTopBar(title = "Title", onBack = {})
        }
        val backBounds = compose.onNodeWithContentDescription(string(R.string.core_cd_back)).getBoundsInRoot()
        val titleBounds = compose.onNodeWithText("Title").getBoundsInRoot()
        assertTrue(backBounds.left < titleBounds.left)
    }

    @Test
    fun progressRing_exposesPercentDescription() {
        setThemed {
            DsProgressRing(progress = 0.5f) { Text("50") }
        }
        compose.onNodeWithContentDescription(string(R.string.core_cd_progress, 50)).assertIsDisplayed()
    }

    @Test
    fun progressRing_clampsOutOfRangeValues() {
        setThemed {
            Column {
                DsProgressRing(progress = 1.7f)
            }
        }
        compose.onNodeWithContentDescription(string(R.string.core_cd_progress, 100)).assertIsDisplayed()
    }

    @Test
    fun chip_announcesToggleState() {
        setThemed {
            var selected by remember { mutableStateOf(false) }
            DsChip(label = "חובה", selected = selected, onClick = { selected = !selected })
        }
        val chip = compose.onNodeWithText("חובה")
        chip.assertIsOff()
        chip.performClick()
        chip.assertIsOn()
    }

    @Test
    fun switchRow_wholeRowToggles() {
        setThemed {
            var checked by remember { mutableStateOf(false) }
            DsSwitchRow(title = "ניגודיות גבוהה", checked = checked, onCheckedChange = { checked = it })
        }
        val row = compose.onNodeWithText("ניגודיות גבוהה")
        row.assertIsOff()
        row.performClick()
        row.assertIsOn()
    }

    @Test
    fun primaryButton_loadingIsNotClickable() {
        var clicks = 0
        setThemed {
            DsPrimaryButton(text = "שמירה", onClick = { clicks++ }, loading = true)
        }
        compose.onNodeWithText("שמירה").assertIsNotEnabled()
        assertEquals(0, clicks)
    }

    @Test
    fun textField_enforcesMaxLength() {
        var value = ""
        setThemed {
            var text by remember { mutableStateOf("") }
            DsTextField(value = text, onValueChange = { text = it; value = it }, label = "כותרת", maxLength = 5)
        }
        compose.onNodeWithText("כותרת").performTextInput("1234567890")
        compose.waitForIdle()
        assertEquals(5, value.length)
    }

    @Test
    fun largeFont_twoX_rendersWithoutCrash() {
        setThemed(fontScale = 2f) {
            Column {
                DsStatTile(label = "רצף", value = "12 ימים", caption = "שיא: 20")
                DsPrimaryButton(text = "צור משימה ראשונה עכשיו", onClick = {})
                DsEmptyState(
                    title = "אין משימות",
                    message = "צור משימה ראשונה כדי להתחיל לבנות רצף של הצלחות.",
                    icon = Icons.Outlined.TaskAlt,
                    actionLabel = "צור משימה",
                    onAction = {},
                )
            }
        }
        compose.onNodeWithText("12 ימים").assertIsDisplayed()
        compose.onNodeWithText("צור משימה ראשונה עכשיו").assertIsDisplayed()
    }
}
