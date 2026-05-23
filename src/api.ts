import type { AppState, AvailabilityEntry, ClientPrincipal, Member, TeamRole } from "./types";

export type AvailabilityInput = {
  id?: string;
  start: string;
  end: string;
  notes: string;
  calendarEventId?: string;
};

const jsonHeaders = {
  "Content-Type": "application/json",
};

const request = async <T>(path: string, options: RequestInit = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...jsonHeaders,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

export const getClientPrincipal = async () => {
  try {
    const response = await fetch("/.auth/me");
    if (!response.ok) {
      throw new Error("Not running behind Azure Static Web Apps auth.");
    }

    const data = (await response.json()) as { clientPrincipal: ClientPrincipal | null };
    if (data.clientPrincipal) {
      return data.clientPrincipal;
    }
  } catch {
    // Local Vite dev server does not provide /.auth/me. Use a dev-only account so the UI can be tested locally.
  }

  if (import.meta.env.DEV) {
    return {
      identityProvider: "dev",
      userId: "local-dev-user",
      userDetails: "student@example.com",
      userRoles: ["anonymous", "authenticated"],
    } satisfies ClientPrincipal;
  }

  return null;
};

export const getAppState = () => request<AppState>("/api/state");

export const saveMember = (displayName: string, roles: TeamRole[]) =>
  request<Member>("/api/member", {
    method: "PUT",
    body: JSON.stringify({ displayName, roles }),
  });

export const saveAvailability = (input: AvailabilityInput) =>
  request<AvailabilityEntry>(input.id ? `/api/availability/${input.id}` : "/api/availability", {
    method: input.id ? "PUT" : "POST",
    body: JSON.stringify(input),
  });

export const deleteAvailability = (id: string) =>
  request<void>(`/api/availability/${id}`, {
    method: "DELETE",
  });

export const postUpdate = (body: string) =>
  request("/api/updates", {
    method: "POST",
    body: JSON.stringify({ body }),
  });

export const postComment = (updateId: string, body: string) =>
  request("/api/comments", {
    method: "POST",
    body: JSON.stringify({ updateId, body }),
  });

export const registerNotificationTarget = (target: string) =>
  request("/api/notification-target", {
    method: "PUT",
    body: JSON.stringify({ target }),
  });
