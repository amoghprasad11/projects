export const ROLE_OPTIONS = ["Driver", "Builder", "Coder", "Notebooker"] as const;

export type TeamRole = (typeof ROLE_OPTIONS)[number];

export type ClientPrincipal = {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
  claims?: Array<{
    typ: string;
    val: string;
  }>;
};

export type Member = {
  id: string;
  displayName: string;
  email: string;
  roles: TeamRole[];
  updatedAt?: string;
};

export type AvailabilityEntry = {
  id: string;
  uid: string;
  memberName: string;
  start: string;
  end: string;
  notes?: string;
  calendarEventId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ActivityHistoryItem = {
  id: string;
  actorUid: string;
  actorName: string;
  type: "availability_created" | "availability_updated" | "availability_deleted" | "roles_updated";
  summary: string;
  createdAt?: string;
};

export type TeamUpdate = {
  id: string;
  authorUid: string;
  authorName: string;
  body: string;
  createdAt?: string;
};

export type Comment = {
  id: string;
  updateId: string;
  authorUid: string;
  authorName: string;
  body: string;
  createdAt?: string;
};

export type AppState = {
  members: Member[];
  availability: AvailabilityEntry[];
  history: ActivityHistoryItem[];
  updates: TeamUpdate[];
  comments: Comment[];
};
