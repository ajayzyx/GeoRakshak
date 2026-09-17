# Problem Statement — SIH26001

## Tag legend

| Tag | Meaning |
|---|---|
| **[OFFICIAL REQUIREMENT]** | Stated in the official SIH26001 text. Must be quoted or directly traceable. |
| **[OUR MVP IMPLEMENTATION]** | How GeoRakshak addresses it in the MVP |
| **[FUTURE ENHANCEMENT]** | Planned beyond the MVP |
| **[TECHNICAL ASSUMPTION]** | Our interpretation or assumption. It needs validation and is not an official requirement. |

---

## 1. Official problem statement

**[OFFICIAL REQUIREMENT]**

- **ID:** SIH26001
- **Title:** AI-Based Early Warning and Landslide Risk Monitoring System in NER

> ⚠️ **ACTION REQUIRED (Product/Communication Lead):** The team currently has only the ID and title above. Copy the full official description, organisation/ministry, category, theme and any expected deliverables **verbatim** from the SIH 2026 portal into §1.1 below. Until then, nothing else in this document counts as an official requirement.

### 1.1 Official description (verbatim)

```
TODO(verify): paste official SIH26001 description here, unedited.
Organisation: TODO(verify)
Category (Software/Hardware): TODO(verify)
Theme: TODO(verify)
```

### 1.2 What the title explicitly requires

These points come directly from the words of the official title and nothing else:

| Phrase in title | Requirement it implies |
|---|---|
| "AI-Based" | The solution uses artificial intelligence / machine learning |
| "Early Warning" | The solution produces warnings before or during rising risk |
| "Landslide Risk Monitoring" | The solution continuously or periodically monitors landslide risk |
| "in NER" | Geographic focus on the North Eastern Region of India |

After the official description is pasted, re-map every item in §2 against it and update the tags.

---

## 2. Requirement mapping

### 2.1 AI-based risk assessment

- **[OFFICIAL REQUIREMENT]** "AI-Based" (title).
- **[OUR MVP IMPLEMENTATION]** Location-level risk score from a transparent baseline model (rule-based, then logistic regression / gradient boosting) using terrain and rainfall features, with per-factor explanations.
- **[FUTURE ENHANCEMENT]** Satellite-image change detection, InSAR ground deformation, and learning from verified field reports.
- **[TECHNICAL ASSUMPTION]** "AI" can reasonably be met by classical ML with explainability. Deep learning is not required for the MVP.

### 2.2 Early warning

- **[OFFICIAL REQUIREMENT]** "Early Warning" (title).
- **[OUR MVP IMPLEMENTATION]** The system drafts alerts when a location's risk crosses a configured threshold. An authority user reviews and approves them before publication. Delivery is in-app (web + mobile) with basic multilingual templates.
- **[FUTURE ENHANCEMENT]** SMS/IVR delivery, integration with official alerting channels (subject to authorisation), and escalation rules.
- **[TECHNICAL ASSUMPTION]** Official public warnings remain with mandated agencies. GeoRakshak supports authorities and does not replace them.

### 2.3 Landslide risk monitoring

- **[OFFICIAL REQUIREMENT]** "Landslide Risk Monitoring" (title).
- **[OUR MVP IMPLEMENTATION]** GIS risk map with periodically refreshed risk from ingested rainfall and static terrain factors. The authority dashboard shows current risk, trends, incidents and alerts.
- **[FUTURE ENHANCEMENT]** Near-real-time ingestion, ground sensors (rain gauges, piezometers, inclinometers), and remote-sensing deformation monitoring.
- **[TECHNICAL ASSUMPTION]** "Monitoring" is satisfied by periodic (for example daily or sub-daily) updates from open datasets for the prototype.

### 2.4 Geographic focus: NER

- **[OFFICIAL REQUIREMENT]** "in NER" (title).
- **[OUR MVP IMPLEMENTATION]** Data model and map cover the NER states. The detailed prototype covers **one pilot area** (to be chosen, pending human approval).
- **[FUTURE ENHANCEMENT]** Full NER coverage at consistent resolution.
- **[TECHNICAL ASSUMPTION]** NER is taken as the eight states under the Ministry of DoNER: Arunachal Pradesh, Assam, Manipur, Meghalaya, Mizoram, Nagaland, Sikkim and Tripura.

### 2.5 Field verification and incident reporting

- **[OFFICIAL REQUIREMENT]** Not stated in the title. Check against the official description.
- **[OUR MVP IMPLEMENTATION]** Mobile app for geo-tagged incident reports with photo/video evidence and an offline queue.
- **[FUTURE ENHANCEMENT]** Citizen reporting with moderation, and drone imagery upload.
- **[TECHNICAL ASSUMPTION]** Ground truth from field officers improves warning credibility and helps authorities respond, especially where connectivity is poor.

### 2.6 Authority dashboard and response prioritisation

- **[OFFICIAL REQUIREMENT]** Not stated in the title. Check against the official description.
- **[OUR MVP IMPLEMENTATION]** Web dashboard showing risk, alerts, incidents and an explainable response-priority list.
- **[FUTURE ENHANCEMENT]** Resource allocation, road-closure coordination and inter-agency workflows.
- **[TECHNICAL ASSUMPTION]** Primary users are district/state disaster-management authorities and field officers.

### 2.7 Multilingual warnings

- **[OFFICIAL REQUIREMENT]** Not stated in the title. Check against the official description.
- **[OUR MVP IMPLEMENTATION]** Human-reviewed alert templates in a small initial language set (pending approval).
- **[FUTURE ENHANCEMENT]** More NER languages, voice/IVR alerts and accessibility features.
- **[TECHNICAL ASSUMPTION]** NER is linguistically diverse, so English-only warnings would reach fewer people.

### 2.8 Offline operation

- **[OFFICIAL REQUIREMENT]** Not stated in the title. Check against the official description.
- **[OUR MVP IMPLEMENTATION]** The mobile app queues reports locally and syncs them when connectivity returns.
- **[FUTURE ENHANCEMENT]** Offline map tiles for the pilot area, and SMS-based report fallback.
- **[TECHNICAL ASSUMPTION]** Mobile connectivity in hilly NER terrain can be intermittent, particularly during severe weather.

---

## 3. Explicit non-claims

- GeoRakshak does not claim to predict the exact time or location of a landslide.
- GeoRakshak is not an official warning authority.
- Metrics we report will come from documented historical data and stated validation methods, not from simulated data.

## 4. Open questions

1. What is the full official SIH26001 text? Are specific deliverables (for example hardware, a particular state, or a data source) expected?
2. Does the problem statement's organisation provide datasets or APIs to participants?
3. Is there a preferred pilot state or district?
