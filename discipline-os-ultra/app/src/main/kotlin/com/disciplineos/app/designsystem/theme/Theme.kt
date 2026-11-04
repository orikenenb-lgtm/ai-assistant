package com.disciplineos.app.designsystem.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp

private val DefaultColors = DisciplineColors()
private val DefaultSpacing = DisciplineSpacing()
private val DefaultShapes = DisciplineShapes()

private val MaterialShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

/**
 * Root theme. Provides the DISCIPLINE OS tokens and a dark Material3 [ColorScheme] mapped from the
 * palette, so plain M3 components (dialogs, pickers, checkboxes, switches) look on-brand.
 */
@Composable
fun DisciplineTheme(
    highContrast: Boolean = false,
    reduceMotion: Boolean = false,
    content: @Composable () -> Unit,
) {
    val colors = if (highContrast) HighContrastColors else DefaultColors
    val motion = remember(reduceMotion) { DisciplineMotion(reduceMotion = reduceMotion) }
    val colorScheme = remember(colors) { colors.toMaterialColorScheme() }
    CompositionLocalProvider(
        LocalDisciplineColors provides colors,
        LocalDisciplineSpacing provides DefaultSpacing,
        LocalDisciplineShapes provides DefaultShapes,
        LocalDisciplineMotion provides motion,
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = DisciplineTypography,
            shapes = MaterialShapes,
            content = content,
        )
    }
}

/** Token accessors. Use these instead of hex values anywhere in the UI. */
object DisciplineTheme {
    val colors: DisciplineColors
        @Composable @ReadOnlyComposable get() = LocalDisciplineColors.current
    val spacing: DisciplineSpacing
        @Composable @ReadOnlyComposable get() = LocalDisciplineSpacing.current
    val shapes: DisciplineShapes
        @Composable @ReadOnlyComposable get() = LocalDisciplineShapes.current
    val motion: DisciplineMotion
        @Composable @ReadOnlyComposable get() = LocalDisciplineMotion.current
    val typography: Typography
        @Composable @ReadOnlyComposable get() = MaterialTheme.typography
}

/**
 * Solid fill for an accent used behind white text. Brand accents (#3B82F6, #EF4444) are ~3.7:1
 * against white, so we darken them until white text passes WCAG AA (≥ 4.5:1).
 */
fun Color.accentFill(): Color = lerp(this, Color.Black, 0.24f)

/** Readable content color on top of [background]: near-white on dark fills, near-black on light ones. */
fun DisciplineColors.contentOn(background: Color): Color =
    if (background.luminance() > 0.35f) this.background else textPrimary

private fun DisciplineColors.toMaterialColorScheme(): ColorScheme = darkColorScheme(
    primary = primary,
    onPrimary = Color.White,
    primaryContainer = lerp(surface, primary, 0.28f),
    onPrimaryContainer = textPrimary,
    inversePrimary = primarySoft,
    secondary = success,
    onSecondary = background,
    secondaryContainer = lerp(surface, success, 0.24f),
    onSecondaryContainer = textPrimary,
    tertiary = warning,
    onTertiary = background,
    tertiaryContainer = lerp(surface, warning, 0.24f),
    onTertiaryContainer = textPrimary,
    background = background,
    onBackground = textPrimary,
    surface = surface,
    onSurface = textPrimary,
    surfaceVariant = surfaceRaised,
    onSurfaceVariant = textSecondary,
    surfaceTint = primary,
    inverseSurface = textPrimary,
    inverseOnSurface = background,
    error = danger,
    onError = Color.White,
    errorContainer = lerp(surface, danger, 0.28f),
    onErrorContainer = textPrimary,
    outline = outline,
    outlineVariant = lerp(outline, surface, 0.4f),
    scrim = Color.Black,
    surfaceBright = surfaceRaised,
    surfaceDim = background,
    surfaceContainerLowest = background,
    surfaceContainerLow = surfaceSunken,
    surfaceContainer = surface,
    surfaceContainerHigh = surfaceRaised,
    surfaceContainerHighest = lerp(surfaceRaised, outline, 0.35f),
)
