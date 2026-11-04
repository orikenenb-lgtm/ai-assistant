package com.disciplineos.app.ui.focus

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsSwitchRow
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.core.model.FocusConfig
import kotlin.math.roundToInt

/**
 * Slider-based editor for [FocusConfig]. Stateless: every change is reported through [onChange].
 * Shared by the focus settings sheet and Settings > Focus defaults.
 */
@Composable
fun FocusConfigEditor(
    config: FocusConfig,
    onChange: (FocusConfig) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(DisciplineTheme.spacing.md)) {
        MinutesSlider(
            label = stringResource(R.string.feat_focus_cfg_work),
            value = config.workMinutes,
            range = FocusFormat.WORK_RANGE,
            step = 5,
            onValue = { onChange(config.copy(workMinutes = it)) },
        )
        MinutesSlider(
            label = stringResource(R.string.feat_focus_cfg_short_break),
            value = config.shortBreakMinutes,
            range = FocusFormat.SHORT_BREAK_RANGE,
            step = 1,
            onValue = { onChange(config.copy(shortBreakMinutes = it)) },
        )
        MinutesSlider(
            label = stringResource(R.string.feat_focus_cfg_long_break),
            value = config.longBreakMinutes,
            range = FocusFormat.LONG_BREAK_RANGE,
            step = 5,
            onValue = { onChange(config.copy(longBreakMinutes = it)) },
        )
        CountSlider(
            label = stringResource(R.string.feat_focus_cfg_cycle),
            value = config.sessionsBeforeLongBreak,
            range = FocusFormat.CYCLE_RANGE,
            onValue = { onChange(config.copy(sessionsBeforeLongBreak = it)) },
        )
        DsSwitchRow(
            title = stringResource(R.string.feat_focus_cfg_auto_breaks),
            checked = config.autoStartBreaks,
            onCheckedChange = { onChange(config.copy(autoStartBreaks = it)) },
        )
        DsSwitchRow(
            title = stringResource(R.string.feat_focus_cfg_auto_work),
            checked = config.autoStartWork,
            onCheckedChange = { onChange(config.copy(autoStartWork = it)) },
        )
    }
}

@Composable
private fun MinutesSlider(label: String, value: Int, range: IntRange, step: Int, onValue: (Int) -> Unit) {
    val valueText = stringResource(R.string.feat_minutes_value, value)
    LabeledSlider(label = label, valueText = valueText, value = value, range = range, step = step, onValue = onValue)
}

@Composable
private fun CountSlider(label: String, value: Int, range: IntRange, onValue: (Int) -> Unit) {
    LabeledSlider(label = label, valueText = value.toString(), value = value, range = range, step = 1, onValue = onValue)
}

@Composable
private fun LabeledSlider(label: String, valueText: String, value: Int, range: IntRange, step: Int, onValue: (Int) -> Unit) {
    val colors = DisciplineTheme.colors
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = MaterialTheme.typography.bodyLarge, color = colors.textPrimary)
            Text(valueText, style = MaterialTheme.typography.titleMedium, color = colors.primarySoft)
        }
        // Number of discrete stops between the ends (Slider "steps" excludes both ends).
        val stops = ((range.last - range.first) / step - 1).coerceAtLeast(0)
        Slider(
            value = value.coerceIn(range).toFloat(),
            onValueChange = { raw ->
                val snapped = (((raw - range.first) / step).roundToInt() * step + range.first).coerceIn(range)
                if (snapped != value) onValue(snapped)
            },
            valueRange = range.first.toFloat()..range.last.toFloat(),
            steps = if ((range.last - range.first) % step == 0) stops else 0,
            colors = SliderDefaults.colors(
                thumbColor = colors.primary,
                activeTrackColor = colors.primary,
                inactiveTrackColor = colors.surfaceSunken,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .semantics { stateDescription = "$label: $valueText" },
        )
    }
}
