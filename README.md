# Raptor Robotics A team

A Firebase-hosted React app for a high school robotics team. Members can register with email verification, add planned
attendance that can sync to a Google Calendar, choose one or more team roles, post updates, comment on collaboration
threads, and keep an audit history of role and schedule changes.

## Features

- Email/password registration with email verification before app access.
- Password field is limited to 6-8 characters in the UI. Firebase requires at least 6 characters.
- Google Calendar OAuth connection for creating team attendance events.
- Planned attendance dashboard with total upcoming team hours and per-member planned hours.
- Self-selected roles: Driver, Builder, Coder, and Notebooker. Multiple people can choose the same role.
- History feed for attendance additions, edits, deletes, and role changes.
- Team updates and collaboration comments.
- Firebase Cloud Messaging registration plus optional Cloud Functions to send phone/browser notifications for new updates
  and comments.
- Firebase Hosting, Firestore rules, and Cloud Functions config for deployment from a Google account.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   cd functions && npm install && cd ..
   ```

2. Create a Firebase project from the Firebase Console.
3. Enable these Firebase products:
   - Authentication -> Email/Password
   - Firestore Database
   - Hosting
   - Cloud Messaging
   - Functions, if you want closed-app push notifications
4. Copy `.env.example` to `.env` and fill in the Firebase web app values.
5. In Google Cloud Console for the same project:
   - Enable the Google Calendar API.
   - Create an OAuth 2.0 Web client ID.
   - Add your local and deployed origins, such as `http://localhost:5173` and your Firebase Hosting URL.
   - Put the client ID in `VITE_GOOGLE_CLIENT_ID`.
6. Set `VITE_TEAM_CALENDAR_ID` to the shared team calendar ID, or use `primary` while testing.
7. Fill `public/firebase-messaging-sw.js` with the same Firebase web config values if you want background notifications.

Run locally:

```bash
npm run dev
```

Build locally:

```bash
npm run build
```

## Deploy to a Google/Firebase account

Install or log in to the Firebase CLI, then run:

```bash
firebase use --add
npm run build
firebase deploy
```

If using Cloud Functions notifications:

```bash
cd functions
npm run build
cd ..
firebase deploy --only functions
```

## Missing functionality or decisions before real team use

- **Account approval:** The current app accepts any verified email. A real team should add an allowlist, mentor approval,
  or school-domain-only rule before students use it.
- **Password wording:** Firebase does not let the app check whether a password is "unique" because passwords are never
  exposed. The app enforces the requested 8-character maximum, but uniqueness is handled by each user choosing a private
  password.
- **Google Calendar permissions:** Users must connect Google Calendar before their attendance plans can create or update
  events. For a production team calendar, create a shared team calendar and make sure the OAuth app has approved access.
- **Deleting Calendar events:** The app deletes attendance records from Firestore, but it does not currently delete the
  matching Google Calendar event. Add Calendar event delete support if that workflow matters.
- **Notification delivery:** Foreground notifications work after permission is granted. Reliable phone notifications while
  the app is closed require deploying the included Firebase Cloud Functions and configuring the messaging service worker.
- **Adult moderation:** Updates, comments, roles, and hours are self-service. Add mentor/admin moderation if the team needs
  approved posts, locked roles, or official attendance records.
- **Official attendance:** Planned hours are not the same as checked-in hours. Add check-in/check-out or mentor approval if
  these totals will be used for awards, eligibility, or official records.
