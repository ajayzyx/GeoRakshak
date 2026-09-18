"""SMS encoding and segment counting, for cost and compliance planning (H14).

No gateway is connected. This measures what a real gateway would charge: GSM-7 packs 160 characters per single
message (153 per segment when concatenated), while anything outside the GSM-7 alphabet — Hindi, Mizo and other
Indic scripts — forces UCS-2 at 70 characters (67 per concatenated segment).
"""
# GSM 03.38 basic alphabet plus the extension table characters that occupy two septets each.
GSM7_BASIC = (
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?"
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
)
GSM7_EXTENDED = "^{}\\[~]|€"
SINGLE = {"GSM7": 160, "UCS2": 70}
CONCATENATED = {"GSM7": 153, "UCS2": 67}


def encoding_of(text: str) -> str:
    return "GSM7" if all(c in GSM7_BASIC or c in GSM7_EXTENDED for c in text) else "UCS2"


def _units(text: str, encoding: str) -> int:
    if encoding == "UCS2":
        # UCS-2 counts 16-bit units, so characters outside the BMP (e.g. emoji) count as two.
        return sum(2 if ord(c) > 0xFFFF else 1 for c in text)
    return sum(2 if c in GSM7_EXTENDED else 1 for c in text)


def measure(text: str) -> tuple[str, int]:
    """(encoding, segments) a gateway would use for this message."""
    encoding = encoding_of(text)
    units = _units(text, encoding)
    if units == 0:
        return encoding, 1
    if units <= SINGLE[encoding]:
        return encoding, 1
    per_segment = CONCATENATED[encoding]
    return encoding, -(-units // per_segment)  # ceiling division
