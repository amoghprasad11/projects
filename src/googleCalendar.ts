type TokenResponse = {
  access_token?: string;
  error?: string;
};

type TokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void;
  callback?: (response: TokenResponse) => void;
};

type CalendarEventInput = {
  title: string;
  description?: string;
  start: Date;
  end: Date;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

const GOOGLE_SCRIPT_ID = "google-identity-services";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

let tokenClient: TokenClient | null = null;
let cachedAccessToken = "";

const loadGoogleIdentityServices = () =>
  new Promise<void>((resolve, reject) => {
    if (window.google?.accounts.oauth2) {
      resolve();
      return;
    }

    const existingScript = document.getElementById(GOOGLE_SCRIPT_ID);
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve());
      existingScript.addEventListener("error", () => reject(new Error("Google sign-in script failed to load.")));
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_SCRIPT_ID;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google sign-in script failed to load."));
    document.head.appendChild(script);
  });

export const getCalendarAccessToken = async () => {
  if (cachedAccessToken) {
    return cachedAccessToken;
  }

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("Add VITE_GOOGLE_CLIENT_ID to connect Google Calendar.");
  }

  await loadGoogleIdentityServices();

  return new Promise<string>((resolve, reject) => {
    tokenClient =
      tokenClient ||
      window.google!.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: CALENDAR_SCOPE,
        callback: () => undefined,
      });

    tokenClient.callback = (response) => {
      if (response.error || !response.access_token) {
        reject(new Error(response.error || "Google Calendar authorization was cancelled."));
        return;
      }

      cachedAccessToken = response.access_token;
      resolve(cachedAccessToken);
    };

    tokenClient.requestAccessToken({ prompt: cachedAccessToken ? "" : "consent" });
  });
};

const toGoogleCalendarEvent = (entry: CalendarEventInput) => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return {
    summary: entry.title,
    description: entry.description || "",
    start: {
      dateTime: entry.start.toISOString(),
      timeZone,
    },
    end: {
      dateTime: entry.end.toISOString(),
      timeZone,
    },
  };
};

const calendarRequest = async <T>(path: string, method: "POST" | "PATCH", accessToken: string, body: unknown) => {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Google Calendar request failed: ${details}`);
  }

  return (await response.json()) as T;
};

export const createCalendarEvent = async (accessToken: string, calendarId: string, entry: CalendarEventInput) => {
  const event = await calendarRequest<{ id: string }>(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    "POST",
    accessToken,
    toGoogleCalendarEvent(entry),
  );

  return event.id;
};

export const updateCalendarEvent = async (
  accessToken: string,
  calendarId: string,
  eventId: string,
  entry: CalendarEventInput,
) =>
  calendarRequest(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    "PATCH",
    accessToken,
    toGoogleCalendarEvent(entry),
  );
