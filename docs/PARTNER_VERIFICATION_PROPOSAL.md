# Delivery-partner verification — contract proposal, not an implemented API

The delivery-partner addendum is included in the frontend requirements. The current backend has no corresponding models or endpoints. This proposal is for the backend owner to approve; the existing API contract and routes remain unchanged. The frontend makes **no invented partner HTTP calls**.

## Proposed data and permissions

- Partner: opaque ID, organization ID, permitted display name, employer, partner reference, masked verified contact, verification status, active flag, timestamps. Authorization requires both approved review and active membership, checked server-side for each delivery action.
- Consent: version, purpose, accepted timestamp, actor, withdrawal timestamp, applicable retention/deletion policy identifier. Capture consent before identity evidence. Agree policy text and retention periods before collecting real information.
- Evidence metadata: evidence type, provider/reference or protected document reference, masked identifier where allowed, submission date, outcome, retention expiry. No raw biometric templates, full document images or government identifiers in ordinary responses/logs/local storage.
- Verification case: partner/organization, method (`MANUAL_REVIEW` or authorized provider), current state, reviewer/provider reference, reason code, submitted/decided dates. Manual review, contact validation, document capture, photo comparison and official verification must remain distinct methods.
- Append-only audit: event ID, case ID, actor/role/source, old/new state, consent version or structured reason, timestamp, safe metadata. Reviewer access must be scoped to organization and role, not granted by a frontend toggle.
- Failure response: existing error envelope, including invalid transitions, revoked consent, invalid evidence, duplicate submission, provider unavailable, expired contact challenge and unauthorized/inactive membership. Use common pagination for history/review queues.

## State proposal

`NOT_STARTED → CONTACT_PENDING → CONTACT_VERIFIED → DOCUMENT_READY → PENDING_REVIEW → APPROVED | NEEDS_INFORMATION | REJECTED`.

Revision from `NEEDS_INFORMATION` / `REJECTED` returns to evidence preparation after required contact/consent revalidation. Activation is a separate permissioned action available only after approval. Deactivation and consent withdrawal immediately prevent restricted actions; audit and evidence deletion follow the agreed retention policy. Every transition must be transactional and validated by the backend, with concurrency/replay tests.

The frontend prototype uses these states only in the synthetic demo. Final endpoint methods/paths, request shapes, provider proof, contact sessions, reviewer role, retention and deletion semantics require backend agreement before any live integration. No assumption is made that a seller can approve a partner.

## Identity safeguards

No Aadhaar enrolment, Aadhaar authentication, UIDAI lookup, facial verification, or government identity check is implemented. An authorized provider and an appropriate lawful integration are dependencies for any future official verification. Provide an assisted/manual alternative. Collect the minimum necessary data, mask identifiers, protect transport/storage, limit reviewer access and do not log identity documents or OTPs.

## Synthetic implementation

`/demo/partners` uses fictional employer information, `rider@example.invalid`, `UL-DEMO-000124`, synthetic badge/letter choices, simulated contact code and manual reviewer outcomes. Every screen says **DEMO — NOT OFFICIALLY VERIFIED**. There are no upload/camera controls, biometric templates, Aadhaar-like numbers or official receipts. The state resides only in memory; reload, delete, or consent withdrawal clears it. It cannot authorize a live delivery request.
