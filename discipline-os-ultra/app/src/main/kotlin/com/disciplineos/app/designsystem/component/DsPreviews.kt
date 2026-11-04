package com.disciplineos.app.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.disciplineos.app.designsystem.theme.DisciplineTheme

/**
 * Multi-preview used across the design system: dark (default locale), Hebrew RTL, and Hebrew RTL at
 * 150% font scale. Use it on any `@Composable` preview function.
 */
@Preview(name = "Dark", showBackground = true, widthDp = 380)
@Preview(name = "RTL Hebrew", locale = "iw", showBackground = true, widthDp = 380)
@Preview(name = "Large font RTL", locale = "iw", fontScale = 1.5f, showBackground = true, widthDp = 380)
annotation class DsPreviews

/** Preview host: themed background with screen gutter. */
@Composable
fun DsPreviewSurface(
    highContrast: Boolean = false,
    content: @Composable () -> Unit,
) {
    DisciplineTheme(highContrast = highContrast) {
        Box(
            modifier = Modifier
                .background(DisciplineTheme.colors.background)
                .padding(16.dp),
        ) {
            content()
        }
    }
}
