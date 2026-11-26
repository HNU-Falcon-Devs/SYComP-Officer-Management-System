## 1. Project Identity
* **Project Name:** SYComP Organizational Management System (SYComP OMS)
* **Organization:** Society of Young Computer Professionals (SYComP)
* **Document Status:** v1.0 — Approved Baseline
* **Phase:** Phase 1 — Initiation & Charter Definition (Completed)
* **Repository Path:** `docs/00-project-charter.md`

---

## 2. Executive Summary
The **SYComP Organizational Management System (SYComP OMS)** is a centralized web platform designed to manage, document, and monitor the internal operations, leadership transitions, event structures, task assignments, attendance records, and institutional archives of the Society of Young Computer Professionals. By replacing fragmented spreadsheets, scattered cloud folders, and informal group-chat tracking with a structured system, SYComP OMS enforces operational accountability during active academic terms and preserves institutional memory across future generations of officers.

---

## 3. Background and Organizational Context
As an active computing student organization, SYComP coordinates academic seminars, technical workshops, institutional assemblies, and internal governance across changing academic terms. Because student leadership turns over annually, operational knowledge, past event structures, official documents, and participation records frequently become fragmented between outgoing and incoming executive boards. SYComP OMS establishes a permanent operational backbone aligned with SYComP's actual governance structure.

---

## 4. Problem Statement
| Operational Pain Point | Current Impact | Target System Direction |
| :--- | :--- | :--- |
| **Scattered Organizational Files** | Letters, proposals, and reports live across personal drives and chat threads. | Centralized document tracking backed by structured cloud folder storage. |
| **Officer Turnover & Term Loss** | Historical positions, past terms, and officer records are hard to reconstruct. | Structured officer profiles with term-bound appointment history. |
| **Dynamic Event Structuring** | Each event requires assembling different committees and leads from scratch. | Event-scoped committee creation and single-officer head assignment. |
| **Untracked Deliverables** | Tasks assigned in meetings or chats lack clear ownership and status visibility. | Structured task assignment, deadlines, and progress tracking. |
| **Manual Attendance & Masterlists** | Sign-in sheets, student masterlist discrepancies, and attendance logs require manual tallying. | Pre-provisioned student directory with role-governed digital attendance logging. |
| **Opaque Proposal & Approval Flows** | Officers lack a shared space to propose events or track approval statuses. | Open officer event proposal drafting with Executive approval workflows. |
| **Limited Leadership Visibility** | Executive leaders lack a real-time overview of active events, bottlenecks, and compliance. | Role-aware operational dashboards and summary reporting. |

---

## 5. Project Vision
To establish a unified, resilient organizational workspace where SYComP officers can execute daily operations with clarity, leadership can oversee accountability in real time, general members can transparently track official activities and attendance, and every academic term contributes to a permanent institutional archive.

---

## 6. General Objective
Design and build a centralized, maintainable web-based organizational management system that standardizes SYComP's internal workflows, enforces event-based operational accountability, and preserves historical organizational records across academic terms.

---

## 7. Specific Objectives
1. **Centralize Records:** Maintain a single authoritative source for member registries (with account lifecycle statuses), officer profiles, academic terms, and historical appointments.
2. **Standardize Event Lifecycle & Committees:** Allow any officer to draft event proposals, empower Executive leadership to approve events, and enable dynamic event-specific committee creation with single-officer Committee Heads.
3. **Track Accountability:** Provide clear assignment, deadline, and completion tracking for officer and committee deliverables.
4. **Governed Attendance & Self-Service:** Enforce strict recording permissions between general member attendance and officer attendance while giving students read-only visibility into their records, calendar, and announcements.
5. **Structured Document Management:** Support direct file uploads integrated with automated Google Drive folder classification and previewing.
6. **Enforce Security & Maintainability:** Implement a 3-layer role architecture, audit logging, and thorough documentation for seamless handover to future technical officers.

---

## 8. Stakeholders & 3-Layer Role Architecture
SYComP OMS decouples **Organizational Titles** (stored as historical metadata) from **Global System Tiers** and **Event-Scoped Roles**:

| Layer / Tier                     | Who Holds It                                          | Core Authority & System Access                                                                                                                                      |
| :------------------------------- | :---------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Tier 1: `Super Admin`**        | Technical Director / System Maintainer                | System configuration, masterlist imports, user lifecycle/status overrides, term transitions, and audit logs.                                                        |
| **Tier 2: `Executive`**          | Faculty Adviser, President, VP Internal, VP External  | Full operational governance: approve event proposals, create/manage event committees, appoint Officers as Committee Heads, and record **officer attendance**.       |
| **Tier 3: `Officer`**            | Standard SYComP Officers                              | Draft event proposals, view organizational records, manage assigned tasks, upload/track documents, and record **general member attendance**.                        |
| **Tier 4: `Member`**             | General Computing Students                            | Read-only portal access to view personal attendance records, the official event calendar, and organizational announcements, plus optional university email binding. |
| **Contextual: `Committee Head`** | Any `Officer` appointed to a specific Event Committee | Elevated management permissions (tasks, committee roster, deliverables) scoped strictly to their assigned committee within that specific event.                     |

---

## 9. Scope (In-Scope for Version 1)
* **Automated Member Provisioning & Directory:** Bulk/automated account generation from official masterlists using Student ID and Full Name (default credentials: Student ID + `lastname + ID`), lifecycle status tracking (`Active`, `Transferred`, `Inactive`, `Needs Review`), optional university email linking, and email-verified password recovery.
* **Officer & Term Registry:** Profiles, organizational titles, academic terms, and historical appointment tracking.
* **Event Proposal & Lifecycle Management:** Open officer event proposal drafting, Executive approval workflows (`Faculty Adviser`, `President`, `VP Internal`, `VP External`), official event calendar publishing, and post-event archiving.
* **Event-Bound Committees:** Dynamic creation of committees per event with one designated Officer as Committee Head.
* **Tasks & Deliverables:** Task creation, assignment to officers/committees, due dates, and completion states.
* **Role-Governed Attendance Management:** Digital attendance recording for meetings and events, enforcing separate recording authority for general members (`Officer`+) vs. officers (`Executive` only), with offline verification and audited Executive direct-edit corrections (no in-app student dispute queue in v1).
* **Documents & Cloud Storage Integration:** Direct file upload with automated folder classification and viewing via Google Drive API, paired with metadata and approval status tracking.
* **Announcements & Read-Only Member Portal:** Official organizational announcements, event calendar, and personal attendance views for general computing students.
* **Governance & Audit Logs:** Role-based access control (RBAC) and activity trails for critical actions and record corrections.

---

## 10. Out-of-Scope Boundaries (Excluded from Version 1)
To prevent scope creep and ensure timely delivery of core functionality, SYComP OMS v1 will **not** include:
* Public social networking feeds, comment threads, or community forums outside structured officer event proposals.
* Replacement of the university's official Student Information System (SIS) or registrar database.
* A full Learning Management System (LMS) for coursework, grading, or modules.
* Real-time peer-to-peer chat or replacement of external messaging platforms.
* Online payment gateway integration or automated financial disbursement processing.
* Full end-to-end automation of external university administrative signatures outside SYComP.
* In-app student attendance dispute ticketing queues (discrepancies are verified offline and corrected directly by an `Executive` with mandatory audit logging).

---

## 11. Foundational Principles
1. **Institutional Continuity:** System data and structure must survive annual officer turnover without data loss or structural resets.
2. **Historical Preservation:** Past officer terms, event rosters, committee heads, and attendance logs remain historically accurate.
3. **Event-Based Responsibilities:** Committees and committee heads exist strictly within the context of a specific event rather than as permanent standing departments.
4. **Decoupled Authorization:** Permissions rely on system tiers and event-committee context rather than hardcoded officer position titles.
5. **Accountability:** Critical actions—proposals, approvals, committee assignments, attendance edits, and record status changes—must be attributable to an actor and timestamp.
6. **Low-Friction Onboarding:** General members exist in the system immediately via masterlist provisioning without manual sign-up bottlenecks, while maintaining secure recovery paths.
7. **Maintainability:** Clean architecture, clear conventions, and complete documentation take priority over unnecessary technical complexity.
8. **Data Integrity:** Masterlist status flags, relational constraints, and controlled status transitions prevent orphaned or duplicated records.

---

## 12. Success Criteria
* **SC-1 (Zero-Friction Onboarding):** 100% of enrolled computing students from the masterlist can log in immediately using default credentials and view their attendance, calendar, and announcements.
* **SC-2 (Governance Enforcement):** Event creation/approval, Committee Head assignments, and officer attendance logging strictly enforce the defined Executive vs. Officer boundaries.
* **SC-3 (Document Centralization):** Uploaded organizational files are automatically organized into classified Google Drive folders and linked to trackable system records.
* **SC-4 (Historical Integrity):** Consecutive academic terms can be queried independently without overwriting prior officer appointments or past event committee assignments.
* **SC-5 (Handover Readiness):** All 10 blueprint documents (`00`–`09`) are complete and synchronized with the deployed v1 codebase.

---

## 13. Constraints and Assumptions
### Constraints
* **Academic Calendar:** Development and rollout must align with university semester schedules and officer term transitions.
* **Student Developer Bandwidth:** Built and maintained by student officers balancing academic coursework and organizational duties.
* **Cloud & API Quotas:** Relies on Google Drive API (organization OAuth2 storage quota) and free/low-cost cloud hosting tiers.

### Assumptions
* Official computing student masterlists (Student ID and Full Name) are obtainable at the start of each semester/academic year.
* Students have access to an institutional university email address for account recovery and announcement notifications.
* Organizational leadership adopts SYComP OMS as the authoritative record for event proposals, committees, attendance, and document tracking.

---

## 14. Risks
| Risk | Likelihood | Impact | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Masterlist Inaccuracies / Duplicates** | High | Medium | Implement explicit member account lifecycle statuses (`Active`, `Transferred`, `Inactive`, `Needs Review`) and safe merge/edit tools. |
| **Default Credential Exposure** | Medium | High | Prompt users to bind their university email and change default (`lastname + ID`) passwords upon first login. |
| **Scope Creep** | High | High | Enforce Section 10 Out-of-Scope boundaries strictly and defer non-core ideas to v2+. |
| **Low Officer Adoption** | Medium | High | Validate actual SYComP workflows in Phase 2 so the tool reduces—rather than adds—administrative work. |
| **Google Drive API / Storage Limits** | Low | Medium | Structure folder hierarchies cleanly and support external Drive URL linking as a fallback alongside direct uploads. |

---

## 15. Glossary
* **Academic Term:** A defined period of organizational governance (e.g., AY 2026–2027, 1st Semester) during which a specific set of officers holds office.
* **Officer Appointment:** The binding of an officer to an official SYComP leadership position title for a specific academic term.
* **Masterlist Provisioning:** Automated creation of general member accounts from official enrollment lists using Student ID and Full Name.
* **Member Lifecycle Status:** A state flag (`Active`, `Transferred`, `Inactive`, `Needs Review`) tracking enrollment validity and masterlist data quality.
* **Event Proposal:** A draft event concept submitted by any Officer for open review and Executive approval.
* **Event Committee:** A temporary functional group created for a single approved event, led by one designated Officer (`Committee Head`).
* **Institutional Record:** Any preserved historical artifact—such as past appointments, attendance logs, or classified documents—retained across terms.