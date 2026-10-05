# Verification

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

Intentional deviations: live dates/counts replace the reference's static values; campus text replaces the decorative bell; a favorite control and demo identity are added; building selection is functional; backend amenities determine the detail list; the non-bookable room is labeled Staff room. A map note explains that List includes every space on the floor. These keep the screen honest about the working data and scope.

## Functional checks

`npm run verify:ui` runs `tests/ui.mjs` against an isolated in-memory server after `npm run build`. It verifies account setup and approvals, booking and cancellation, CSV imports, room ordering, desktop/mobile overflow, and browser runtime errors. Screenshots go to the system temporary directory (`coventry-classrooms-qa`), or `QA_OUTPUT_DIR` when set; production data is not used.

`npm test` covers server validation, atomic overlap prevention, adjacent reservations, concurrent submissions, elapsed time rejection, cross-site mutations, restart persistence, cancellation, and static path traversal.

The production build passes. Docker files are supplied; Docker runtime execution has not been verified in this environment.

## Scope

This is a working self-hosted MVP using a shared demo identity. Production university SSO, individual ownership, administrative space management, and real campus floor-plan import are not implemented.
