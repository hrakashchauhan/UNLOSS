# Frontend design decision — 23 October 2026

The existing React shell, blue/neutral tokens, and seller authentication are retained. Reference: [Wikimedia Codex](https://doc.wikimedia.org/codex/latest/). Its visual principles are used; its Vue components are not added to this React application.

| Concept | Usability / accessibility | Distinctiveness | Effort | UNLOSS fit |
| --- | --- | --- | --- | --- |
| Operations register | Familiar tables, labelled filters, predictable keyboard order | Restrained | Low | Strong for daily seller work |
| Evidence notebook | Chronological events with actor/source/reason | Strong | Low | Strong for accountability |
| Public-service wizard | Short steps, explicit consent, recovery instructions | Moderate | Medium | Strong for customer and partner flows |
| Dispatch board | Spatial status columns need accessible alternatives | Moderate | High | Weak for large histories |
| Metric-first dashboard | Fast counts but risks overemphasising ungrounded trends | Low | Medium | Moderate |
| Document workspace | Clear print layout and reference-led navigation | Moderate | Low | Strong for QR sheets |

Selected direction: operations register, using evidence timelines in order details, short step forms for verification, and document layouts for printing. This is one coherent interface, not a theme switcher. White surfaces, dark text, restrained blue, modest radii, visible focus, text labels for status, 44px primary controls, intentional table scrolling, no decorative charts or unsupported metrics.

Feature modules separate orders, public workflows, reporting, and the isolated synthetic partner demo. Authentication and the HTTP boundary remain intact. QR encoding is delegated to `qrcode.react`; no decorative QR placeholder is used. No additional state/form framework is required.
