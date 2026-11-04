package com.disciplineos.app.designsystem.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * System sans-serif: on Android this resolves to Roboto for Latin and Noto Sans Hebrew for Hebrew,
 * so mixed Hebrew/English text renders with matching metrics and no bundled font weight.
 */
val DisciplineFontFamily: FontFamily = FontFamily.SansSerif

private fun style(size: Int, line: Int, weight: FontWeight, letterSpacing: Float = 0f) = TextStyle(
    fontFamily = DisciplineFontFamily,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = line.sp,
    // Hebrew has no letter-case; positive tracking hurts readability, so we keep it neutral.
    letterSpacing = letterSpacing.sp,
)

/**
 * Every size is in `sp` and every container wraps its text (no fixed heights), so the whole scale
 * follows the system font size (Dynamic Type safe up to 200%).
 */
val DisciplineTypography: Typography = Typography(
    displayLarge = style(52, 60, FontWeight.Bold, -0.5f),
    displayMedium = style(42, 50, FontWeight.Bold, -0.25f),
    displaySmall = style(34, 42, FontWeight.Bold),
    headlineLarge = style(30, 38, FontWeight.Bold),
    headlineMedium = style(26, 34, FontWeight.SemiBold),
    headlineSmall = style(22, 30, FontWeight.SemiBold),
    titleLarge = style(20, 28, FontWeight.SemiBold),
    titleMedium = style(17, 24, FontWeight.SemiBold),
    titleSmall = style(15, 22, FontWeight.Medium),
    bodyLarge = style(16, 24, FontWeight.Normal),
    bodyMedium = style(14, 21, FontWeight.Normal),
    bodySmall = style(12, 18, FontWeight.Normal),
    labelLarge = style(15, 20, FontWeight.SemiBold),
    labelMedium = style(13, 18, FontWeight.Medium),
    labelSmall = style(11, 16, FontWeight.Medium, 0.2f),
)
