package com.disciplineos.app.designsystem.component

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.theme.DisciplineTheme

/**
 * Filter/choice chip. The 48dp touch target wraps a 36dp visual pill. Exposed to TalkBack as a
 * checkbox-like toggle so the selected state is announced.
 */
@Composable
fun DsChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    leadingIcon: ImageVector? = null,
) {
    val colors = DisciplineTheme.colors
    val motion = DisciplineTheme.motion
    val shape = RoundedCornerShape(DisciplineTheme.shapes.chipRadius)
    val background by animateColorAsState(
        targetValue = if (selected) colors.primary.copy(alpha = 0.22f) else colors.surface,
        animationSpec = tween(motion.duration(motion.shortMillis)),
        label = "chipBg",
    )
    val borderColor by animateColorAsState(
        targetValue = if (selected) colors.primary else colors.outline,
        animationSpec = tween(motion.duration(motion.shortMillis)),
        label = "chipBorder",
    )
    val content = if (selected) colors.textPrimary else colors.textSecondary
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = modifier
            .heightIn(min = DisciplineTheme.spacing.minTouch)
            .toggleable(
                value = selected,
                interactionSource = interaction,
                indication = null,
                role = Role.Checkbox,
                onValueChange = { onClick() },
            ),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            modifier = Modifier
                .heightIn(min = 36.dp)
                .clip(shape)
                .background(background)
                .border(1.dp, borderColor, shape)
                .indication(interaction, LocalIndication.current)
                .padding(horizontal = 14.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val icon = if (selected && leadingIcon == null) Icons.Filled.Check else leadingIcon
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = if (selected) colors.primarySoft else content, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
            }
            Text(text = label, style = DisciplineTheme.typography.labelLarge, color = content)
        }
    }
}

/** Outlined text field with brand colors, optional hard length limit and character counter. */
@Composable
fun DsTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    maxLength: Int? = null,
    isError: Boolean = false,
    supportingText: String? = null,
) {
    val colors = DisciplineTheme.colors
    val showSupport = supportingText != null || maxLength != null
    OutlinedTextField(
        value = value,
        onValueChange = { next ->
            onValueChange(if (maxLength != null && next.length > maxLength) next.take(maxLength) else next)
        },
        label = { Text(label) },
        modifier = modifier.fillMaxWidth(),
        singleLine = singleLine,
        minLines = if (singleLine) 1 else 3,
        isError = isError,
        shape = RoundedCornerShape(DisciplineTheme.shapes.buttonRadius),
        textStyle = DisciplineTheme.typography.bodyLarge,
        supportingText = if (showSupport) {
            {
                Row(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = supportingText.orEmpty(),
                        modifier = Modifier.weight(1f),
                    )
                    if (maxLength != null) {
                        Text(
                            text = stringResource(R.string.core_char_counter, value.length, maxLength),
                            textAlign = TextAlign.End,
                        )
                    }
                }
            }
        } else {
            null
        },
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = colors.textPrimary,
            unfocusedTextColor = colors.textPrimary,
            focusedContainerColor = colors.surfaceSunken,
            unfocusedContainerColor = colors.surfaceSunken,
            focusedBorderColor = colors.primary,
            unfocusedBorderColor = colors.outline,
            focusedLabelColor = colors.primarySoft,
            unfocusedLabelColor = colors.textSecondary,
            cursorColor = colors.primary,
            errorBorderColor = colors.danger,
            errorLabelColor = colors.danger,
            errorSupportingTextColor = colors.danger,
            focusedSupportingTextColor = colors.textMuted,
            unfocusedSupportingTextColor = colors.textMuted,
        ),
    )
}

/** Full-width row with a switch. The entire row is the touch target and a single "switch" node. */
@Composable
fun DsSwitchRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    enabled: Boolean = true,
) {
    val colors = DisciplineTheme.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(RoundedCornerShape(DisciplineTheme.shapes.chipRadius))
            .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onCheckedChange)
            .padding(horizontal = 4.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = DisciplineTheme.typography.bodyLarge,
                color = if (enabled) colors.textPrimary else colors.textMuted,
            )
            if (subtitle != null) {
                Text(text = subtitle, style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
            }
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = checked,
            onCheckedChange = null,
            enabled = enabled,
            colors = SwitchDefaults.colors(
                checkedThumbColor = colors.textPrimary,
                checkedTrackColor = colors.primary,
                uncheckedThumbColor = colors.textSecondary,
                uncheckedTrackColor = colors.surfaceSunken,
                uncheckedBorderColor = colors.outline,
            ),
        )
    }
}

@DsPreviews
@Composable
private fun InputsPreview() {
    DsPreviewSurface {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DsChip(label = "הכל", selected = true, onClick = {})
                DsChip(label = "חובה", selected = false, onClick = {}, leadingIcon = Icons.Filled.Flag)
            }
            DsTextField(value = "לסיים דוח", onValueChange = {}, label = "כותרת", maxLength = 120)
            DsTextField(value = "", onValueChange = {}, label = "כותרת", isError = true, supportingText = "יש להזין כותרת")
            DsSwitchRow(title = "ניגודיות גבוהה", subtitle = "טקסט וקווי מתאר בהירים יותר", checked = true, onCheckedChange = {})
        }
    }
}
