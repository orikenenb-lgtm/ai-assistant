package com.disciplineos.app.ui.onboarding

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class OnboardingLogicTest {

    @Test fun titleValidation() {
        assertTrue(OnboardingLogic.isTitleValid("אימון"))
        assertFalse(OnboardingLogic.isTitleValid("   "))
        assertFalse(OnboardingLogic.isTitleValid("x".repeat(OnboardingLogic.MAX_TITLE + 1)))
    }

    @Test fun paging() {
        assertEquals(1, OnboardingLogic.nextPage(0))
        assertEquals(OnboardingLogic.PAGE_COUNT - 1, OnboardingLogic.nextPage(OnboardingLogic.PAGE_COUNT - 1))
        assertEquals(0, OnboardingLogic.previousPage(0))
        assertTrue(OnboardingLogic.isLastPage(OnboardingLogic.PAGE_COUNT - 1))
        assertFalse(OnboardingLogic.isLastPage(0))
    }
}
