import re
import pandas as pd

# ─────────────────────────────────────────────────────────────────────────────
# Cleaning Script Registry
#
# To add a new script, append one dict to CLEANING_SCRIPTS with three keys:
#   id          – unique snake_case identifier (string)
#   description – short human-readable description sent to the AI as context
#   apply       – function (pd.Series) -> pd.Series that transforms the column
#
# The AI only ever sees `id` and `description` (via get_script_menu()).
# The `apply` function is only called server-side by the apply-cleaning endpoint.
# ─────────────────────────────────────────────────────────────────────────────

CLEANING_SCRIPTS = [
    {
        "id": "strip_whitespace",
        "description": "Strip leading and trailing whitespace from each value",
        "apply": lambda s: s.apply(lambda v: v.strip() if isinstance(v, str) else v),
    },
    {
        "id": "collapse_spaces",
        "description": "Collapse multiple consecutive spaces into a single space and trim ends",
        "apply": lambda s: s.apply(
            lambda v: re.sub(r" {2,}", " ", v).strip() if isinstance(v, str) else v
        ),
    },
    {
        "id": "lowercase",
        "description": "Convert all text to lowercase",
        "apply": lambda s: s.apply(lambda v: v.lower() if isinstance(v, str) else v),
    },
    {
        "id": "uppercase",
        "description": "Convert all text to uppercase",
        "apply": lambda s: s.apply(lambda v: v.upper() if isinstance(v, str) else v),
    },
    {
        "id": "title_case",
        "description": "Convert text to title case (capitalize first letter of each word)",
        "apply": lambda s: s.apply(lambda v: v.title() if isinstance(v, str) else v),
    },
    {
        "id": "remove_special_chars",
        "description": "Remove all characters that are not letters, digits, or spaces",
        "apply": lambda s: s.apply(
            lambda v: re.sub(r"[^A-Za-z0-9 ]", "", v) if isinstance(v, str) else v
        ),
    },
    {
        "id": "remove_non_numeric",
        "description": "Remove all non-numeric characters, keeping only digits and decimal points",
        "apply": lambda s: s.apply(
            lambda v: re.sub(r"[^0-9.]", "", v) if isinstance(v, str) else v
        ),
    },
    {
        "id": "strip_currency",
        "description": "Remove common currency symbols ($, €, £, ¥, ₹) from the start or end of values",
        "apply": lambda s: s.apply(
            lambda v: re.sub(r"^[\$€£¥₹\s]+|[\$€£¥₹\s]+$", "", v) if isinstance(v, str) else v
        ),
    },
    {
        "id": "normalize_phone",
        "description": "Normalize phone numbers by stripping all non-digit characters (preserves a leading +)",
        "apply": lambda s: s.apply(
            lambda v: ("+" if isinstance(v, str) and v.startswith("+") else "")
                      + re.sub(r"\D", "", v) if isinstance(v, str) else v
        ),
    },
    {
        "id": "zero_pad_integers",
        "description": "Zero-pad pure integer values to a minimum of 5 digits (e.g. '42' → '00042')",
        "apply": lambda s: s.apply(
            lambda v: v.zfill(5) if isinstance(v, str) and v.isdigit() else v
        ),
    },
    {
        "id": "remove_html_tags",
        "description": "Strip HTML tags from text values, leaving only the inner text",
        "apply": lambda s: s.apply(
            lambda v: re.sub(r"<[^>]+>", "", v) if isinstance(v, str) else v
        ),
    },
    {
        "id": "remove_phone_separators",
        "description": "Remove phone number separators: dashes (-), dots (.), spaces, em/en dashes (—/–), and Korean dash (ㅡ)",
        "apply": lambda s: s.apply(
            lambda v: re.sub(r"[-.\s\u2014\u2013\u3161]", "", v) if isinstance(v, str) else v
        ),
    },
    {
        "id": "remove_internal_spaces",
        "description": "Remove all spaces from inside values (including internal spaces, not just leading/trailing) — useful for emails and codes",
        "apply": lambda s: s.apply(
            lambda v: v.replace(" ", "") if isinstance(v, str) else v
        ),
    },
    {
        "id": "remove_non_name_chars",
        "description": "Remove characters that don't belong in names — keeps letters, Korean characters (가-힣), and spaces; removes digits, punctuation, and symbols",
        "apply": lambda s: s.apply(
            lambda v: re.sub(r"[^\w가-힣\s]|\d", "", v).strip() if isinstance(v, str) else v
        ).replace("", pd.NA),
    },
    {
        "id": "remove_digits",
        "description": "Remove all digits (0–9) from values",
        "apply": lambda s: s.apply(
            lambda v: re.sub(r"\d", "", v) if isinstance(v, str) else v
        ),
    },
    {
        "id": "replace_empty_with_null",
        "description": "Replace empty or whitespace-only values with null — runs after other cleaning scripts that may produce empty strings",
        "apply": lambda s: s.apply(
            lambda v: pd.NA if isinstance(v, str) and v.strip() == "" else v
        ),
    },
]

# O(1) lookup used by the apply-cleaning endpoint
SCRIPTS_BY_ID = {s["id"]: s for s in CLEANING_SCRIPTS}


def get_script_menu():
    """Return [{id, description}] for all scripts — safe to send as AI context (no implementations)."""
    return [{"id": s["id"], "description": s["description"]} for s in CLEANING_SCRIPTS]
