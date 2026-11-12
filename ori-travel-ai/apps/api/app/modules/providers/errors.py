"""Module-level API errors shared by providers / search / comparison."""

from __future__ import annotations

from app.core.errors import AppError


class UnprocessableError(AppError):
    """422 with a Hebrew message (same shape as request validation errors)."""

    status_code = 422
    code = "VALIDATION_ERROR"
    default_message = "חלק מהשדות אינם תקינים"
