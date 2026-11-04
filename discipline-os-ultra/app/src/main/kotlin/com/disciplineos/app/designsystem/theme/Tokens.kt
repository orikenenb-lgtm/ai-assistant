package com.disciplineos.app.designsystem.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Brand palette (source of truth). Do not hardcode hex values elsewhere — use DisciplineTheme.colors. */
object Palette {
    val Background = Color(0xFF0B1220)
    val Surface = Color(0xFF1E293B)
    val SurfaceRaised = Color(0xFF253349)
    val SurfaceSunken = Color(0xFF111A2C)
    val Outline = Color(0xFF334155)
    val Blue = Color(0xFF3B82F6)
    val BlueSoft = Color(0xFF60A5FA)
    val Green = Color(0xFF22C55E)
    val Orange = Color(0xFFF59E0B)
    val Red = Color(0xFFEF4444)
    val Purple = Color(0xFF8B5CF6)
    val TextPrimary = Color(0xFFF1F5F9)
    val TextSecondary = Color(0xFF94A3B8)
    val TextMuted = Color(0xFF64748B)
}

@Immutable
data class DisciplineColors(
    val background: Color = Palette.Background,
    val surface: Color = Palette.Surface,
    val surfaceRaised: Color = Palette.SurfaceRaised,
    val surfaceSunken: Color = Palette.SurfaceSunken,
    val outline: Color = Palette.Outline,
    val primary: Color = Palette.Blue,
    val primarySoft: Color = Palette.BlueSoft,
    val success: Color = Palette.Green,
    val warning: Color = Palette.Orange,
    val danger: Color = Palette.Red,
    val xp: Color = Palette.Purple,
    val textPrimary: Color = Palette.TextPrimary,
    val textSecondary: Color = Palette.TextSecondary,
    val textMuted: Color = Palette.TextMuted,
    /** Semantic: mandatory tasks use warning-orange accents, optional tasks use primary-blue. */
    val mandatory: Color = Palette.Orange,
    val optional: Color = Palette.Blue,
)

/** High-contrast variant (Settings > Accessibility). Text and outlines meet WCAG AAA on background. */
val HighContrastColors = DisciplineColors(
    outline = Color(0xFF94A3B8),
    textSecondary = Color(0xFFE2E8F0),
    textMuted = Color(0xFFCBD5E1),
)

@Immutable
data class DisciplineSpacing(
    val xxs: Dp = 2.dp,
    val xs: Dp = 4.dp,
    val sm: Dp = 8.dp,
    val md: Dp = 12.dp,
    val lg: Dp = 16.dp,
    val xl: Dp = 24.dp,
    val xxl: Dp = 32.dp,
    val screenGutter: Dp = 16.dp,
    /** Minimum touch target (accessibility). */
    val minTouch: Dp = 48.dp,
)

@Immutable
data class DisciplineShapes(
    val cardRadius: Dp = 20.dp,
    val chipRadius: Dp = 12.dp,
    val buttonRadius: Dp = 14.dp,
    val sheetRadius: Dp = 28.dp,
)

@Immutable
data class DisciplineMotion(
    val reduceMotion: Boolean = false,
    val shortMillis: Int = 150,
    val mediumMillis: Int = 300,
    val longMillis: Int = 600,
) {
    fun duration(millis: Int): Int = if (reduceMotion) 0 else millis
}

val LocalDisciplineColors = staticCompositionLocalOf { DisciplineColors() }
val LocalDisciplineSpacing = staticCompositionLocalOf { DisciplineSpacing() }
val LocalDisciplineShapes = staticCompositionLocalOf { DisciplineShapes() }
val LocalDisciplineMotion = staticCompositionLocalOf { DisciplineMotion() }
