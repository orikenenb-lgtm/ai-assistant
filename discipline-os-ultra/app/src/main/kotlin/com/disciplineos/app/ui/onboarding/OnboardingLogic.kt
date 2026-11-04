package com.disciplineos.app.ui.onboarding

/** Pure onboarding rules (unit-tested in OnboardingLogicTest). */
object OnboardingLogic {
    const val MAX_TITLE = 120
    const val PAGE_COUNT = 5

    fun isTitleValid(title: String): Boolean = title.isNotBlank() && title.trim().length <= MAX_TITLE

    fun isLastPage(page: Int): Boolean = page >= PAGE_COUNT - 1

    fun nextPage(page: Int): Int = (page + 1).coerceAtMost(PAGE_COUNT - 1)

    fun previousPage(page: Int): Int = (page - 1).coerceAtLeast(0)
}
