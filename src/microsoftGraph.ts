import { PublicClientApplication, type AccountInfo } from "@azure/msal-browser";

type CalendarEventInput = {
  title: string;
  description?: string;
  start: Date;
  end: Date;
};

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID;
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID || "common";
const calendarId = import.meta.env.VITE_MICROSOFT_CALENDAR_ID || "";
const graphScopes = ["Calendars.ReadWrite"];

const msal = clientId
  ? new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: window.location.origin,
      },
      cache: {
        cacheLocation: "localStorage",
      },
    })
  : null;

let initialized = false;

const ensureMsal = async () => {
  if (!msal) {
    throw new Error("Add VITE_AZURE_CLIENT_ID before connecting Microsoft Calendar.");
  }

  if (!initialized) {
    await msal.initialize();
    initialized = true;
  }

  return msal;
};

const getAccount = async () => {
  const instance = await ensureMsal();
  const existingAccount = instance.getAllAccounts()[0];
  if (existingAccount) {
    return existingAccount;
  }

  const result = await instance.loginPopup({ scopes: graphScopes });
  return result.account;
};

export const getGraphAccessToken = async () => {
  const instance = await ensureMsal();
  const account = (await getAccount()) as AccountInfo;

  try {
    const result = await instance.acquireTokenSilent({
      account,
      scopes: graphScopes,
    });
    return result.accessToken;
  } catch {
    const result = await instance.acquireTokenPopup({
      account,
      scopes: graphScopes,
    });
    return result.accessToken;
  }
};

const toGraphEvent = (entry: CalendarEventInput) => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return {
    subject: entry.title,
    body: {
      contentType: "text",
      content: entry.description || "",
    },
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

const graphCalendarPath = () => {
  if (!calendarId) {
    return "/me/events";
  }

  return `/me/calendars/${encodeURIComponent(calendarId)}/events`;
};

const graphRequest = async <T>(path: string, method: "POST" | "PATCH" | "DELETE", accessToken: string, body?: unknown) => {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Microsoft Graph request failed: ${details}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

export const createCalendarEvent = async (accessToken: string, entry: CalendarEventInput) => {
  const event = await graphRequest<{ id: string }>(graphCalendarPath(), "POST", accessToken, toGraphEvent(entry));
  return event.id;
};

export const updateCalendarEvent = (accessToken: string, eventId: string, entry: CalendarEventInput) =>
  graphRequest(`/me/events/${encodeURIComponent(eventId)}`, "PATCH", accessToken, toGraphEvent(entry));

export const deleteCalendarEvent = (accessToken: string, eventId: string) =>
  graphRequest(`/me/events/${encodeURIComponent(eventId)}`, "DELETE", accessToken);
