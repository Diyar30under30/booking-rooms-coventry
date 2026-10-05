# Booking Club Project

A React classroom booking application with a dependency-free Node HTTP API and persistent SQLite storage. Students, teachers and staff register real password accounts; an administrator approves each account before it can reserve a classroom. Administrators can upload campus events as CSV. Reservations and events share one schedule and block the same room inventory.

Coventry contains eight rooms on each of floors 2, 3 and 4: 201–208, 301–308 and 401–408. Room 301 is the library; 302 is the club room; 303 and 204 are large lecture rooms. Other numbered rooms retain their classroom labels. Floor 4 is the confirmed highest floor. New rooms have no recorded capacity, equipment or photos; capacity is stored as `NULL` and amenities as `[]`. Each reservation occupies the whole classroom. The six existing illustrative classrooms in Science Center and Main Library are preserved, including their capacities and bookings. These legacy building labels are retained to preserve existing records; the user identifies the library as inside Coventry. Floor plans are illustrative, not verified campus maps. The interface uses the [official Coventry University logo](https://www.coventry.ac.uk/globalassets/media/logos/cov.svg).

## Project structure

```text
app/
  frontend/     React source, styles, static assets and browser entry point
  backend/      HTTP API, authentication, SQLite, CSV and notifications
  shared/       Room utilities used by frontend and backend
  tests/        Backend/API regression tests and headless browser checks
  dist/         Generated frontend (ignored by Git)
  node_modules/ Installed dependencies (ignored by Git)
  package.json  Application commands and dependencies
  vite.config.js Frontend build configuration
deployment/     Dockerfile and Compose configuration
docs/           README, design notes, reference images and examples/
data/           Existing database and setup code (ignored by Git)
```

Run all npm commands from `app/`. Its `vite.config.js` builds `frontend/`
into `dist/`; `backend/index.mjs` serves that output and the API. Deployment
files live in `deployment/`. The top-level `.gitignore` is Git configuration;
application configuration stays inside `app/`.

## Run locally

Use Node.js 24 or newer. From the project folder, run `cd app` first.

```sh
npm install
npm run dev:server
```

In another terminal, also open the `app/` folder:

```sh
npm run dev
```

Open the Vite URL. Vite forwards `/api` to the backend on port 3001. On Windows PowerShell systems that block `npm.ps1`, use `npm.cmd` for these commands.

At first startup, the server creates `data/admin-setup-code.txt` using an exclusive file creation and restrictive file mode. The local operator reads that file and enters its code in **Administrator setup**, together with their own name, email and password. There are no seeded credentials. The server never prints the code. Alternatively, set `ADMIN_SETUP_CODE` before the first startup. Only the first administrator setup succeeds; the unused code file can remain after setup, because the endpoint permanently rejects setup once an administrator exists. Keep a custom `DATA_DIR` outside version control and limit access to the database and code file; Windows permissions also depend on the directory's ACL.

Register student, teacher or staff accounts through the application. The administrator approves or rejects them under administration. Pending accounts may sign in and view the schedule, but cannot book. Passwords require 12–128 characters. Choosing a role at registration does not grant administrator access.

## Single server and deployment

```sh
npm run build
npm start
```

Open http://localhost:3001. `PORT` changes the port; `HOST` changes the listening address (default `127.0.0.1`); `DATA_DIR` changes storage (default: the project-level `data/` folder, outside `app/`). Use the campus timezone on the server. Dates and times are campus wall-clock values, and “today” uses the server's local date.

For remote deployment, serve the application over HTTPS and set `APP_ORIGIN` to its exact public origin, such as `https://booking.example.edu` (no trailing slash). An HTTPS origin automatically enables Secure session cookies; `SESSION_SECURE=1` explicitly requires an HTTPS `APP_ORIGIN`. The server checks Origin exactly and does not trust forwarded headers. With no `APP_ORIGIN`, only HTTP localhost or 127.0.0.1 origins on ports 3001 and 5173 may mutate data. Configure `APP_ORIGIN` when changing those ports. Vite uses same-origin API proxying during development.

Passwords use asynchronous scrypt with a unique random salt. Sessions use random tokens whose SHA-256 hashes are stored in SQLite; cookies are HttpOnly, SameSite=Lax, and expire after an absolute seven days. All authenticated mutations require `X-CSRF-Token`. Login, registration and setup require JSON and an allowed Origin, and are rate limited per direct client address. Account registration does not verify email ownership or university affiliation; administrators must check affiliation before approving accounts. Campus SSO is not included. Establish a SQLite-aware backup and administrator recovery policy before deployment.

## Vercel and Supabase

The Vercel project is named `booking-club-project`, with Git build root `app`.
The source repository is https://github.com/Diyar30under30/booking-rooms-coventry
and the production branch is `main`.
`app/vercel.json` runs `npm run build:preview` and publishes `preview-dist/`.
Production uses Supabase project `vgfrjeanmgmumvjuxffg` for email/password
accounts, approvals, bookings and CSV events. Public connection variables are set
in Vercel; no service-role key is sent to the browser. Without Supabase variables,
the preview build shows bundled inventory and disables accounts and bookings.
Builds never publish the local `data/` directory or its existing records.

The regular `npm run build` and `npm start` can still use SQLite when Supabase
variables are absent. For local Supabase builds, put the public variables in
`app/frontend/.env.local` (ignored by Git). Hosted inventory was seeded separately;
existing local SQLite accounts and reservations were not migrated.

The schedule includes a room-specific month calendar and half-hour availability.
Authenticated sessions show booked/free slots from saved reservations.
Unavailable or unsigned-in data is marked unknown, never assumed free.

Signups start pending and need administrator approval before booking. Email
confirmation is disabled to preserve the existing manual approval workflow without
requiring an SMTP provider; administrators must verify university affiliation.
Use **Sign in / Register → Set up administrator** and the one-time code in
`data/supabase-admin-setup-code.txt` to create the first hosted administrator.
Only a SHA-256 hash is stored in the private database schema. Claiming the code is
atomic and permanently disables setup. Keep the code out of Git and screenshots.

Schema migrations and Auth configuration are in `app/backend/supabase/`.
RLS restricts profiles, booking ownership and approvals. Database constraints
reject overlapping reservations, invalid hours and capacity violations. Schedule
RPCs hide other users' booking purposes and identities. Campus time is
`Asia/Qyzylorda`. Hosted CSV inserts are atomic. Telegram notifications remain
available only in the SQLite backend.

Google OAuth client support is included but disabled until credentials are set.
Create a Google Cloud web OAuth client with origin
`https://booking-club-project.vercel.app` and callback
`https://vgfrjeanmgmumvjuxffg.supabase.co/auth/v1/callback`. Configure its client ID
and secret privately in Supabase Authentication → Sign In / Providers → Google,
then set `VITE_GOOGLE_AUTH_ENABLED=true` in Vercel and redeploy. Never commit the
Google client secret. This session could not access Google Cloud because both
browser automation runtimes failed to start.

`tests/hosted-ui.mjs` verifies hosted login, CSV events, booking conflicts,
cancellation and calendar availability using a disposable approved QA account.
Its required environment variables are listed at the top of the file. It removes
only the test's uniquely named bookings; remove the disposable account afterward.

The database security advisor has no RLS findings. The Auth advisor reports that
[leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
is disabled; the project currently enforces a 12-character minimum password.

## Docker

Run Docker commands from `deployment/` (from the project folder, use `cd deployment`).
The explicit Compose project name keeps the existing `bookingclubpr_booking-data` volume.

```sh
docker compose up --build -d
```

Compose publishes localhost port 3001 and stores the database and first-run setup code in the `booking-data` volume. Read the setup code locally from that volume without publishing it. For remote use, terminate HTTPS at your reverse proxy and create a `compose.override.yaml` with your actual public origin:

```yaml
services:
  campus-booking:
    environment:
      APP_ORIGIN: https://booking.example.edu
      SESSION_SECURE: "1"
```

Compose automatically merges that file when you run `docker compose up --build -d`. An HTTPS `APP_ORIGIN` already enables Secure cookies; the explicit flag documents the deployment requirement. Shell variables alone do not pass these settings into the current Compose service. Compose defaults to `Asia/Qyzylorda`; override `TZ` for your campus. Back up with a SQLite-aware tool, or stop the server and copy the whole data directory. `docker compose down` preserves the volume; `docker compose down -v` deletes it.

## Booking and event rules

An approved account can reserve any active classroom, including multiple rooms at the same time. Each room needs its own booking and a reason of 3–120 characters. Attendees must be a positive whole number; a maximum is enforced only when the room has a recorded capacity. Coventry capacities are unspecified. Dates must be today or later; today's start time must still be in the future. Times must fall between 08:00 and 22:00, with positive duration up to eight hours. Adjacent entries are allowed; overlapping reservations or events for the same room are rejected. Retired resources remain available for historical room lookups but cannot accept new reservations. Lab seats and study rooms are excluded.

Administrators upload CSV with the exact headers `classroom,date,start,end,title` and optional `attendees` (default 1). `classroom` accepts an exact active classroom name or its numeric ID; ambiguous names require an ID. UTF-8 BOM, quoted commas, escaped quotes and quoted newlines are supported. Unknown or duplicate headers, malformed fields, invalid dates, capacity errors and overlaps reject the import. Maximum size is 256 KB and 500 event rows. Preview does not reserve rooms; import reparses and revalidates inside an immediate SQLite transaction. Every row commits together or none commits, including if someone books after preview. Reimporting overlapping events is rejected.

See [examples/events-template.csv](examples/events-template.csv). Its 2030 date is a placeholder; change dates to future campus dates and match your active classrooms.

## Telegram booking notifications

Notifications are optional and disabled until configured. After a successful booking, the server can send the person's name, room, building, floor, date, time, attendee count and reason to the configured recipient. No notification is sent for a rejected or conflicting booking. CSV events and cancellations do not send notifications.

To receive notifications as `@diorik00`:

1. Create a bot through Telegram's official `@BotFather` and keep its token private.
2. From the `@diorik00` account, open that bot and press **Start**. A bot cannot initiate a private conversation with a user.
3. Obtain that conversation's numeric `message.chat.id` through the bot's `getUpdates` response. A personal username such as `@diorik00` is not a private chat ID. Keep the token out of shared URLs, screenshots and source files.
4. Inside `app/`, copy `.env.example` to a local `.env`, then set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Start with `node --env-file=.env backend/index.mjs` (or `node --env-file=.env --watch backend/index.mjs` during development). Plain `npm start` reads exported environment variables but does not load `.env` automatically. For Docker, put these values in `deployment/.env`; Compose passes both variables from that file.

The booking commits before notification delivery. The server waits at most five seconds for Telegram and returns `notification: "sent"`, `"failed"`, or `"disabled"` with a successful booking response. A failure leaves the booking saved and displays a notification failure message; do not book again to retry delivery. Failed notifications are not automatically retried or queued. The booking reason remains stored in SQLite. Bot credentials never go to the browser or error logs. Live delivery requires the operator's credentials and chat setup; automated tests use a mock Telegram service.

See the official [Telegram bot setup FAQ](https://core.telegram.org/bots/faq#how-do-i-start-a-bot) and [sendMessage API](https://core.telegram.org/bots/api#sendmessage).

## API

- `GET /api/auth/session` returns `{ user, csrfToken, setupRequired }`, with null user/token when signed out.
- `POST /api/auth/register` accepts `{ name, email, password, role }`, where role is student, teacher or staff, and returns `201 { user }` with pending status. Email is trimmed and lowercased, and must be unique.
- `POST /api/auth/login` accepts `{ email, password }`, sets the session cookie and returns `{ user, csrfToken }`. Pending and rejected accounts may sign in.
- `POST /api/auth/setup` accepts `{ code, name, email, password }`, creates the first approved administrator and returns `201 { user, csrfToken }` with a session cookie.
- `POST /api/auth/logout` accepts `{}` and revokes the current session. Send its CSRF token.
- `GET /api/spaces` publicly returns all current and retired records. Use `active: 1`, `type: "classroom"`, and `bookingScope: "whole-room"` for the bookable inventory.
- `GET /api/bookings?from=2030-04-12&to=2030-04-18` requires a session and returns an inclusive range of up to 31 days. Without parameters it returns today. Every row contains `{ id, spaceId, date, start, end, title, attendees, source, isMine, canCancel }`. Events publish their actual titles; another user's booking purpose becomes `Classroom reservation`. Owner identities and emails are excluded.
- `GET /api/bookings/mine` privately returns the signed-in account's upcoming reservations with their actual purposes, limited to 1000 rows.
- `POST /api/bookings` accepts `{ spaceId, date, start, end, title, attendees }`; ownership comes from the approved session. Client-supplied identity or role fields grant no privileges. Returns the created schedule row and `notification` status.
- `DELETE /api/bookings/:id` accepts `{}`. Only the real owner or administrator may cancel a booking; only administrators may cancel events or unassigned legacy entries.
- `GET /api/admin/users?status=pending` returns public user records; `all`, `approved` and `rejected` are also supported. `PATCH /api/admin/users/:id` accepts `{ status: "approved" }` or `rejected`. Administrator status cannot be changed.
- `POST /api/admin/events/preview` accepts `{ csv }` and returns `{ valid, rows }`, with row numbers, resolved `spaceId`, parsed fields and errors. `POST /api/admin/events/import` accepts the same input and returns `201 { imported, entries }`. `GET /api/admin/events/template` downloads a sample CSV.

All POST/PATCH/DELETE requests require `Content-Type: application/json` and an allowed Origin. Authenticated mutations additionally require the current `X-CSRF-Token`. All administration routes require an approved administrator. `/api/profiles` has been removed. Invalid input returns 400; unauthenticated requests 401; denied actions 403; overlaps 409; rate limits 429.

## Existing databases and verification

Startup atomically migrates database versions 0–3 to version 4. The earlier migrations remain intact. Version 4 permits an unknown capacity and adds only missing Coventry rooms. It checks both stable resource keys and existing Coventry room numbers, including records named `Room 201`, `Classroom 201`, or `201`. Existing rows, capacities, retirement flags and bookings are preserved; existing retired rooms are not reactivated. No floor above 4 is added. Repeated startups preserve IDs and avoid duplicates. Foreign keys are checked before commit, and migration failure rolls back schema, rows and version together. Back up before upgrading. Legacy demo bookings retain `userId: null` and still block conflicting bookings and events.

```sh
npm test
npm run build
npm run verify:ui
```

Backend tests cover all three registration roles, pending approvals and revocation, session/CSRF/Origin controls, secure cookies and token storage, rate limiting, atomic first-admin setup, ownership/privacy, bounded schedules, CSV parsing and all-or-none conflicts, booking races, classroom floors, legacy migrations, persistence and static file traversal.
