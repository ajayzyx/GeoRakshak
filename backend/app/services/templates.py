"""Notification templates (docs/architecture.md §3.6).

English is the working text. The Hindi strings are DRAFT translations that have NOT been reviewed by a
native speaker (CLAUDE.md §10). They carry review_status=DRAFT_UNREVIEWED until Product/Communication
replaces them with reviewed text. The pilot-area language is added once the pilot area is selected.
"""

TEMPLATES = {
    "en": {
        "review_status": "WORKING_TEXT",
        "WATCH": {
            "title": "Internal watch: {severity} landslide risk",
            "body": "GeoRakshak estimates {severity} landslide risk in {n} area cell(s) ({reason}). Please verify ground conditions and report. Decision-support estimate, not an official warning.",
            "sms": "GeoRakshak WATCH: {severity} landslide risk in {n} cell(s). Verify and report. Not an official warning.",
        },
        "WATCH_FORECAST": {
            "title": "Internal watch (forecast +{lead} h): {severity} landslide risk",
            "body": "Forecast inputs indicate {severity} landslide risk within {lead} h in {n} area cell(s) ({reason}). Prepare to verify ground conditions. Forecast-based decision-support estimate, not an official warning.",
            "sms": "GeoRakshak WATCH (forecast +{lead} h): {severity} landslide risk in {n} cell(s). Not an official warning.",
        },
        "WARNING": {
            "title": "Landslide risk warning",
            "body": "Authorities report {severity} landslide risk near your area. {actions} Follow instructions from local authorities.",
            "sms": "Landslide risk {severity} near your area. {actions} Follow local authorities.",
        },
        "UPDATE": {
            "title": "Landslide risk update",
            "body": "Update from authorities about landslide risk near your area: {actions} Follow instructions from local authorities.",
            "sms": "Landslide risk update: {actions} Follow local authorities.",
        },
    },
    "hi": {
        "review_status": "DRAFT_UNREVIEWED",
        "WATCH": {
            "title": "आंतरिक निगरानी: {severity} भूस्खलन जोखिम",
            "body": "GeoRakshak के अनुसार {n} क्षेत्र में {severity} भूस्खलन जोखिम है। कृपया ज़मीनी स्थिति जाँचें और रिपोर्ट करें। यह आधिकारिक चेतावनी नहीं है।",
            "sms": "GeoRakshak निगरानी: {severity} भूस्खलन जोखिम। जाँच कर रिपोर्ट करें। आधिकारिक चेतावनी नहीं।",
        },
        "WATCH_FORECAST": {
            "title": "आंतरिक निगरानी (पूर्वानुमान +{lead} घंटे): {severity} भूस्खलन जोखिम",
            "body": "पूर्वानुमान के अनुसार {lead} घंटे में {n} क्षेत्र में {severity} भूस्खलन जोखिम हो सकता है। ज़मीनी स्थिति जाँचने की तैयारी करें। यह आधिकारिक चेतावनी नहीं है।",
            "sms": "GeoRakshak निगरानी (पूर्वानुमान +{lead} घंटे): {severity} भूस्खलन जोखिम। आधिकारिक चेतावनी नहीं।",
        },
        "WARNING": {
            "title": "भूस्खलन जोखिम चेतावनी",
            "body": "अधिकारियों के अनुसार आपके क्षेत्र के पास {severity} भूस्खलन जोखिम है। {actions} स्थानीय अधिकारियों के निर्देशों का पालन करें।",
            "sms": "आपके क्षेत्र के पास {severity} भूस्खलन जोखिम। {actions} स्थानीय अधिकारियों का पालन करें।",
        },
        "UPDATE": {
            "title": "भूस्खलन जोखिम अपडेट",
            "body": "आपके क्षेत्र के पास भूस्खलन जोखिम पर अधिकारियों का अपडेट: {actions} स्थानीय अधिकारियों के निर्देशों का पालन करें।",
            "sms": "भूस्खलन जोखिम अपडेट: {actions} स्थानीय अधिकारियों का पालन करें।",
        },
    },
}
SUPPORTED_LANGUAGES = tuple(TEMPLATES)


TEMPLATE_KEYS = ("WATCH", "WATCH_FORECAST", "WARNING", "UPDATE")

# Severity is a fixed four-term vocabulary, so it is translated. The Hindi terms carry the same
# DRAFT_UNREVIEWED status as the rest of the Hindi text until a native speaker reviews them.
SEVERITY_TERMS = {
    "en": {"Low": "Low", "Moderate": "Moderate", "High": "High", "Very High": "Very High"},
    "hi": {"Low": "कम", "Moderate": "मध्यम", "High": "अधिक", "Very High": "बहुत अधिक"},
}


def severity_term(severity: str, lang: str) -> str:
    """Translate a severity label, falling back to the English term rather than inventing one."""
    return SEVERITY_TERMS.get(lang, {}).get(severity, severity)


def render(template_key: str, languages: list[str], **values) -> dict:
    if template_key not in TEMPLATE_KEYS:
        raise ValueError(f"Unknown template {template_key}")
    tier_key = template_key
    out = {}
    for lang in languages:
        t = TEMPLATES.get(lang)
        if not t:
            continue
        v = {k: ("" if val is None else val) for k, val in values.items()}
        if "severity" in v:
            v["severity"] = severity_term(str(v["severity"]), lang)
        out[lang] = {
            "title": t[tier_key]["title"].format(**v),
            "body": " ".join(t[tier_key]["body"].format(**v).split()),
            "sms_text": " ".join(t[tier_key]["sms"].format(**v).split()),
            "review_status": t["review_status"],
        }
    return out
