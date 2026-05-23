# Raptor Robotics A team

An Azure-hosted React app for a high school robotics team. Members can sign in through Microsoft Entra / Azure Static
Web Apps authentication, add planned attendance that can sync to Microsoft Outlook Calendar, choose one or more team
roles, post updates, comment on collaboration threads, and keep an audit history of role and schedule changes.

## Features

- Azure Static Web Apps hosting and authentication.
- Microsoft Entra External ID / Entra ID sign-in for email-authenticated accounts.
- Microsoft Graph Calendar integration for creating, updating, and deleting Outlook calendar attendance events.
- Azure Functions API for team data.
- Azure Table Storage persistence for members, planned attendance, history, updates, comments, and notification targets.
- Planned attendance dashboard with total upcoming team hours and per-member planned hours.
- Self-selected roles: Driver, Builder, Coder, and Notebooker. Multiple people can choose the same role.
- History feed for attendance additions, edits, deletes, and role changes.
- Team updates and collaboration comments.
- Notification target capture so you can connect Azure Communication Services, Notification Hubs, Teams, or another phone
  notification provider.

## Project structure

```text
.
├── api/                         # Azure Functions API
├── src/                         # React frontend
├── staticwebapp.config.json     # Azure Static Web Apps auth/routes
├── .env.example                 # Frontend Microsoft Graph env values
└── package.json
```

## Local setup

Install frontend dependencies:

```bash
npm install
```

Install API dependencies:

```bash
cd api
npm install
cd ..
```

Copy environment examples:

```bash
cp .env.example .env
cp api/local.settings.example.json api/local.settings.json
```

Fill `.env`:

```text
VITE_AZURE_CLIENT_ID=<your Microsoft Entra app client ID>
VITE_AZURE_TENANT_ID=<tenant ID, or common while testing>
VITE_MICROSOFT_CALENDAR_ID=<optional calendar ID; leave blank to use the signed-in user's default calendar>
```

For local API persistence, either:

- Run Azurite and set `AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true`, or
- Put an Azure Storage account connection string in `api/local.settings.json`.

If `AZURE_STORAGE_CONNECTION_STRING` is blank, the API falls back to in-memory data for local development only.

## Run locally

Terminal 1, start the frontend:

```bash
npm run dev
```

Terminal 2, start the Azure Functions API:

```bash
cd api
npm start
```

Open the Vite URL, usually:

```text
http://localhost:5173
```

Local Vite development uses a dev-only signed-in user because Azure Static Web Apps auth only exists when deployed or when
using the Static Web Apps CLI.

## Build

Frontend:

```bash
npm run build
```

API:

```bash
npm run build:api
```

## Deploy to Microsoft Azure

1. Create an Azure Storage account for Table Storage.
2. Create an Azure Static Web App and connect it to this repository.
3. Configure the Static Web App build:
   - App location: `/`
   - API location: `api`
   - Output location: `dist`
4. Add app settings to the Static Web App API:
   - `AZURE_STORAGE_CONNECTION_STRING`
   - `RAPTOR_TABLE_NAME` (optional, defaults to `RaptorRobotics`)
5. Configure authentication:
   - Use Microsoft Entra ID for basic Microsoft sign-in, or
   - Use Microsoft Entra External ID if you need student self-registration with email verification and password rules.
6. Register a Microsoft Entra app for Microsoft Graph Calendar:
   - Add SPA redirect URI for your deployed Static Web Apps URL.
   - Add delegated permission `Calendars.ReadWrite`.
   - Put the client ID and tenant ID in the Static Web App frontend environment variables.

## About the original password request

The app is now Azure-based, so passwords are managed by Microsoft Entra rather than by this React app. That is the safer
Azure pattern because the app never stores or sees student passwords. To enforce "unique password up to 8 characters,"
configure that in Microsoft Entra External ID custom policies or user flows. Note that an 8-character maximum is weaker
than modern security recommendations; a minimum length with no short maximum is safer.

## Missing functionality or decisions before real team use

- **Account approval:** Decide whether any verified Microsoft account can join, or whether mentors should approve accounts
  or restrict sign-up to school/team email domains.
- **Email verification and password policy:** Configure these in Microsoft Entra External ID. They are not hard-coded in
  the frontend.
- **Calendar ownership:** The current Microsoft Graph integration writes to the signed-in user's calendar, or to a calendar
  ID in `VITE_MICROSOFT_CALENDAR_ID` if that user has access.
- **Phone notifications:** The app saves notification targets. Real phone notifications require wiring Azure Communication
  Services SMS, Azure Notification Hubs, Teams webhooks, or another provider from the API.
- **Official attendance:** Planned hours are not the same as checked-in hours. Add check-in/check-out or mentor approval if
  these totals will be used for awards, eligibility, or official records.
