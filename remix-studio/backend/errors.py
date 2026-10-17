"""Errors whose message is safe to show the user (Hebrew)."""


class UserError(Exception):
    """An expected failure with a friendly Hebrew message for the client."""

    def __init__(self, message_he: str):
        super().__init__(message_he)
        self.message_he = message_he
