# Verification

## University Room Booking descriptor - 2026-10-16

Implemented and tested the mandatory local application workflow against the supplied one-page descriptor. `npm test`: 34 passed. The existing `verify:ui` suite passes with updated room terminology and request status expectations. All seven `verify:availability` error-state/accessibility scenarios pass. The new `verify:brief` browser suite exercises student study-room auto-approval, staff requests, administrator review, retained cancellation history, catalogue edits, campus hours and role management in isolated SQLite databases.

The v5-to-v6 migration is tested twice against accounts, password verification, sessions, booking IDs and retired rooms. A copy of the actual local database also retained its existing booking and passed foreign-key checks after two migrations. An unmodified pre-migration SQLite backup is retained in the ignored `data/` directory. No cloud account or production database was modified.

The current supported run mode is `campus-local` (default `npm run build` / `npm run dev`). The existing Supabase deployment has not been upgraded to this schema. Recommended extras such as recurring bookings and print confirmations are outside this change. The notes below describe earlier work where dated and are not a claim that remote parity has been verified.

## Design comparison

Reference: `design-concept.png`. Desktop capture: `app-desktop.png`, at a 1505 × 1045 viewport (full-page screenshot). Mobile capture: `app-mobile.png`, at 390 × 844.

The built-in browser reported unavailable. Verification used Playwright with installed Microsoft Edge against the production build and an isolated in-memory SQLite database. The concept and both captures were inspected with `view_image`.

| Point | Result |
| --- | --- |
| Layout | Retains the 260px sidebar, three summary cards, booking toolbar, category tabs, and adjacent floor plan/details. |
| Typography | Locally bundled DM Sans; large primary heading, compact controls, clear secondary text. |
| Palette | White panels, cool near-white background, forest green actions, pale green navigation. |
| Floor plan | Native vector architecture and selectable desk controls reproduce the reference composition; live state controls availability. |
| Spacing and containers | Fine borders and restrained radii preserve the reference hierarchy and panel anatomy. |
| Copy | Primary navigation, heading, subtitle, category names, and booking action preserved. Functional deviations listed below. |
| Mobile | Navigation condenses, controls wrap, details stack; no page-level horizontal overflow. |

Intentional deviations: live dates/counts replace the reference's static values; campus text replaces the decorative bell; favorites and individual authenticated accounts are available; building selection is functional; backend amenities determine the detail list; the non-bookable room is labeled Staff room. A map note explains that List includes every space on the floor. These keep the screen honest about the working data and scope.

## Functional checks

`npm run verify:ui` runs `tests/ui.mjs` against an isolated in-memory server. It creates its own temporary frontend build with cloud configuration disabled, so no separate build command is required. It verifies account setup and approvals, booking and cancellation, CSV imports, room ordering, desktop/mobile overflow, and browser runtime errors. Screenshots go to the system temporary directory (`coventry-classrooms-qa`), or `QA_OUTPUT_DIR` when set; production data is not used.

`npm test` covers server validation, atomic overlap prevention, adjacent reservations, concurrent submissions, elapsed time rejection, cross-site mutations, restart persistence, cancellation, and static path traversal.

The production build passes. Docker files are supplied; Docker runtime execution has not been verified in this environment.

## Scope

The local app supports individual password accounts, account and booking approvals, role-based administration, room editing, campus/type/opening-hour configuration, and cancellation with retained history. University SSO and verified campus floor-plan import are not implemented. The prior hosted Supabase adapter remains in the repository but has not been upgraded for the new local workflow.


## Availability and accessibility fixes - 2026-10-07

`npm run verify:availability` builds an isolated frontend and runs seven browser regression scenarios: failed availability and retry across map/list/favorites; failed, empty and signed-out schedules; personal-booking failures and retry; late responses after sign-out; failed submission followed by failed availability refresh; named dialogs with Escape and focus restoration; and desktop/mobile dropdown keyboard selection without inline CSS.

Availability, personal bookings and daily schedules now keep separate loading, ready and error states. Rooms are shown as unknown and booking is disabled until availability is loaded. Empty-state messages appear only after successful reads. Booking responses are scoped to the account, date and refresh so stale requests cannot restore outdated data. The date input uses valid phrasing content inside its label. Dialogs have accessible names, and dropdown positioning uses the external stylesheet.

Verification completed locally: 26 backend/API tests, all seven new browser regression scenarios, and the existing full UI suite passed. The UI suites use temporary builds, an in-memory database and Microsoft Edge; production records are not used. Desktop and 390px mobile checks found no horizontal overflow or unexpected browser runtime errors. Expected HTTP 503 responses are injected by the error-state scenarios.

These are software checks, not evidence of participant-based user research. Personas, surveys, low-fidelity prototypes and real user-testing results must come from the team's actual work. The University Room Booking descriptor was subsequently provided and addressed in the October 16 local update above. This update has not been deployed.
