# University Room Booking — 10-version progression

This branch reconstructs a learning progression from the existing project. These milestone snapshots were created now, not during the original development; commit dates are not backdated. The original `main` branch and its history are preserved. The final application source matches the source snapshot taken from the working project for this task.

**Current milestone: 01/10 — React starter and project layout**

| Version | Git tag | Adds |
| --- | --- | --- |
| 01 | [progress-v01](https://github.com/Diyar30under30/booking-rooms-coventry/tree/progress-v01) | React starter and project layout |
| 02 | [progress-v02](https://github.com/Diyar30under30/booking-rooms-coventry/tree/progress-v02) | Read-only sample room catalogue |
| 03 | [progress-v03](https://github.com/Diyar30under30/booking-rooms-coventry/tree/progress-v03) | Room search, capacity and equipment filters |
| 04 | [progress-v04](https://github.com/Diyar30under30/booking-rooms-coventry/tree/progress-v04) | Persistent SQLite catalogue and Node API |
| 05 | [progress-v05](https://github.com/Diyar30under30/booking-rooms-coventry/tree/progress-v05) | Accounts, sessions and account approval |
| 06 | [progress-v06](https://github.com/Diyar30under30/booking-rooms-coventry/tree/progress-v06) | Booking requests, conflict checks and personal history |
| 07 | [progress-v07](https://github.com/Diyar30under30/booking-rooms-coventry/tree/progress-v07) | Full room finder and availability timetable |
| 08 | [progress-v08](https://github.com/Diyar30under30/booking-rooms-coventry/tree/progress-v08) | Room and Estates administration |
| 09 | [progress-v09](https://github.com/Diyar30under30/booking-rooms-coventry/tree/progress-v09) | Regression tests and deployment configuration |
| 10 | [progress-v10](https://github.com/Diyar30under30/booking-rooms-coventry/tree/progress-v10) | Final documentation and verified project snapshot |

## Run this milestone

Requires Node.js 24 or newer. From the repository root:

```sh
cd app
npm ci
npm run dev
```

Versions 01–03 are frontend prototypes using sample data and do not persist bookings.

Accounts arrive in version 05.

Requests arrive in version 06.

Automated regression suites arrive in version 09.

## Inspect a version safely

```sh
git clone --branch progression/ten-versions https://github.com/Diyar30under30/booking-rooms-coventry.git
cd booking-rooms-coventry
git switch --detach progress-v03
```

Use a clean clone or commit/stash your changes before switching. Use separate `DATA_DIR` paths for different historical versions; do not point an older version at a newer production database. `git switch progression/ten-versions` returns to the final milestone.

The supported final application is local React + Node + SQLite. The legacy Supabase/Vercel adapter is preserved as reference and is not upgraded for the new workflow. Publishing this progression branch does not update the original application or deploy the main branch. Credentials, databases, dependencies and build outputs are excluded.
