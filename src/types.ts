import type { Timestamp } from "firebase/firestore";

export const ROLE_OPTIONS = ["Driver", "Builder", "Coder", "Notebooker"] as const;

export type TeamRole = (typeof ROLE_OPTIONS)[number];

export type Member = {
  id: string;
  displayName: string;
  email: string;
  roles: TeamRole[];
  updatedAt?: Timestamp;
};

export type AvailabilityEntry = {
  id: string;
  uid: string;
  memberName: string;
  start: Timestamp;
  end: Timestamp;
  notes?: string;
  calendarEventId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type ActivityHistoryItem = {
  id: string;
  actorUid: string;
  actorName: string;
  type: "availability_created" | "availability_updated" | "availability_deleted" | "roles_updated";
  summary: string;
  createdAt?: Timestamp;
};

export type TeamUpdate = {
  id: string;
  authorUid: string;
  authorName: string;
  body: string;
  createdAt?: Timestamp;
};

export type Comment = {
  id: string;
  updateId: string;
  authorUid: string;
  authorName: string;
  body: string;
  createdAt?: Timestamp;
};
