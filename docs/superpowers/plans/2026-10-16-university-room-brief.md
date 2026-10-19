# University Room Booking Implementation Plan

**Goal:** Implement the mandatory behaviours in the user's University Room Booking descriptor in the existing local application.

**Architecture:** Preserve React and the Node/SQLite API, existing user edits and database IDs. Add a transactional version 6 migration, shared room policy, server-enforced role and booking lifecycle, then expose the catalogue and administrative controls in React. Existing admin accounts retain Estates permissions; room_admin is a separate role. Local builds explicitly select the SQLite backend; the existing hosted Supabase deployment is not changed by local startup.

**Tech Stack:** React, Vite, Node HTTP, SQLite, node:test, Playwright.

## Contract and implementation tasks

- [x] Add regression tests in app/tests/brief.test.mjs for role restrictions, request/approval/decline/cancel, retained history, conflicts, room administration and Estates configuration. Run `node --test tests/brief.test.mjs` before implementing; missing behaviours must fail.
- [x] Migrate app/backend/db.mjs without deleting existing IDs or rows. Add room campus, bookableBy, photo, accessible; booking status, moduleCode, approvalNote; user department and room_admin role. Add campuses and room_types catalogues. Seed illustrative whole labs, study rooms and meeting rooms across two buildings, with explicit sample metadata; do not invent Coventry capacities.
- [x] Add app/backend/catalogue.mjs for validation/administration. GET /api/config returns campuses {id,name,opens,closes} and roomTypes {id,name}. POST/PATCH /api/admin/rooms accepts room fields. Estates-only POST/PATCH /api/admin/campuses and /api/admin/room-types maintains these catalogues. PATCH /api/admin/users/:id accepts status and/or role; prevent last Estates admin removal and self-demotion.
- [x] Update app/backend/index.mjs and auth.mjs: admin remains Estates admin, room_admin can review requests/manage rooms, staff/teacher can request teaching rooms/labs, students only student-bookable study rooms. GET /api/bookings/mine includes history. PATCH /api/admin/bookings/:id accepts status approved/declined plus approvalNote. GET /api/admin/bookings?date=&spaceId= returns chronological entries. DELETE booking changes status to cancelled only before start. Requested/approved bookings block time. Conflict error includes booking reference and time without exposing another user's private purpose.
- [x] Update React finder, detail, dialogs, personal timetable, schedule, sidebar and Administration. Add capacity/equipment/accessibility/type/campus filters, module code, status badges/history, room/day admin filter, catalogue editor and Estates settings. Keep the current style and prior availability/error handling. Add responsive form CSS.
- [x] Run all backend tests, adjust assertions that encode superseded classroom-only or deletion behaviour, build the local app and run a browser end-to-end check with an isolated database. Verify migration twice and user data retention. Restart only the known local booking server and check HTTP/API responses.

## Acceptance and boundaries

Guest catalogue is read-only. Time entry remains picker/select based. Server validates all writes, authorization, capacities and configured opening hours. Past bookings remain immutable history. Study rooms auto-approve; other requests need administrator review. Declined/cancelled rows do not block availability. Required scenario is local database-backed operation; remote deployment requires separate tested Supabase work. Recommended extras (recurrence, print) are not in this change.
