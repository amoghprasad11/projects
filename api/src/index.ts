import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { TableClient } from "@azure/data-tables";
import { randomUUID } from "node:crypto";

type TeamRole = "Driver" | "Builder" | "Coder" | "Notebooker";

type ClientPrincipal = {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
};

type Member = {
  id: string;
  displayName: string;
  email: string;
  roles: TeamRole[];
  updatedAt: string;
};

type AvailabilityEntry = {
  id: string;
  uid: string;
  memberName: string;
  start: string;
  end: string;
  notes?: string;
  calendarEventId?: string;
  createdAt: string;
  updatedAt: string;
};

type ActivityHistoryItem = {
  id: string;
  actorUid: string;
  actorName: string;
  type: "availability_created" | "availability_updated" | "availability_deleted" | "roles_updated";
  summary: string;
  createdAt: string;
};

type TeamUpdate = {
  id: string;
  authorUid: string;
  authorName: string;
  body: string;
  createdAt: string;
};

type Comment = {
  id: string;
  updateId: string;
  authorUid: string;
  authorName: string;
  body: string;
  createdAt: string;
};

type NotificationTarget = {
  id: string;
  uid: string;
  target: string;
  updatedAt: string;
};

type StoredEntity = {
  partitionKey: string;
  rowKey: string;
  data: string;
};

const tableName = process.env.RAPTOR_TABLE_NAME || "RaptorRobotics";
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const memoryStore = new Map<string, Map<string, unknown>>();
let tableClientPromise: Promise<TableClient | null> | null = null;

const json = (body: unknown, status = 200): HttpResponseInit => ({
  status,
  jsonBody: body,
});

const text = (body: string, status = 400): HttpResponseInit => ({
  status,
  body,
});

const getTableClient = async () => {
  if (!connectionString || connectionString === "UseDevelopmentStorage=true") {
    return null;
  }

  tableClientPromise =
    tableClientPromise ||
    (async () => {
      const client = TableClient.fromConnectionString(connectionString, tableName);
      try {
        await client.createTable();
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode !== 409) {
          throw error;
        }
      }
      return client;
    })();

  return tableClientPromise;
};

const getMemoryCollection = (collection: string) => {
  if (!memoryStore.has(collection)) {
    memoryStore.set(collection, new Map());
  }

  return memoryStore.get(collection)!;
};

const listItems = async <T>(collection: string) => {
  const client = await getTableClient();
  if (!client) {
    return Array.from(getMemoryCollection(collection).values()) as T[];
  }

  const items: T[] = [];
  const entities = client.listEntities<StoredEntity>({
    queryOptions: {
      filter: `PartitionKey eq '${collection}'`,
    },
  });

  for await (const entity of entities) {
    items.push(JSON.parse(entity.data) as T);
  }

  return items;
};

const getItem = async <T extends { id: string }>(collection: string, id: string) => {
  const client = await getTableClient();
  if (!client) {
    return (getMemoryCollection(collection).get(id) as T | undefined) || null;
  }

  try {
    const entity = await client.getEntity<StoredEntity>(collection, id);
    return JSON.parse(entity.data) as T;
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404) {
      return null;
    }
    throw error;
  }
};

const upsertItem = async <T extends { id: string }>(collection: string, item: T) => {
  const client = await getTableClient();
  if (!client) {
    getMemoryCollection(collection).set(item.id, item);
    return item;
  }

  await client.upsertEntity(
    {
      partitionKey: collection,
      rowKey: item.id,
      data: JSON.stringify(item),
    },
    "Replace",
  );
  return item;
};

const deleteItem = async (collection: string, id: string) => {
  const client = await getTableClient();
  if (!client) {
    getMemoryCollection(collection).delete(id);
    return;
  }

  await client.deleteEntity(collection, id);
};

const parsePrincipal = (request: HttpRequest): ClientPrincipal | null => {
  const encoded = request.headers.get("x-ms-client-principal");
  if (encoded) {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as ClientPrincipal;
  }

  if (!process.env.WEBSITE_SITE_NAME) {
    return {
      identityProvider: "dev",
      userId: "local-dev-user",
      userDetails: "student@example.com",
      userRoles: ["anonymous", "authenticated"],
    };
  }

  return null;
};

const requireUser = (request: HttpRequest) => {
  const principal = parsePrincipal(request);
  if (!principal) {
    throw new Error("Sign in with Azure Static Web Apps authentication first.");
  }

  return principal;
};

const getMemberName = async (principal: ClientPrincipal) => {
  const member = await getItem<Member>("members", principal.userId);
  return member?.displayName || principal.userDetails.split("@")[0] || "Team member";
};

const addHistory = async (principal: ClientPrincipal, type: ActivityHistoryItem["type"], summary: string) => {
  const actorName = await getMemberName(principal);
  const item: ActivityHistoryItem = {
    id: randomUUID(),
    actorUid: principal.userId,
    actorName,
    type,
    summary,
    createdAt: new Date().toISOString(),
  };

  await upsertItem("history", item);
};

const getBody = async <T>(request: HttpRequest) => {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
};

const sortByDate = <T>(items: T[], field: keyof T, direction: "asc" | "desc") =>
  items.sort((a, b) => {
    const first = new Date(String(a[field] || 0)).getTime();
    const second = new Date(String(b[field] || 0)).getTime();
    return direction === "asc" ? first - second : second - first;
  });

app.http("state", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "state",
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const principal = requireUser(request);
    const existingMember = await getItem<Member>("members", principal.userId);
    if (!existingMember) {
      await upsertItem<Member>("members", {
        id: principal.userId,
        displayName: principal.userDetails.split("@")[0] || "Team member",
        email: principal.userDetails,
        roles: [],
        updatedAt: new Date().toISOString(),
      });
    }

    const [members, availability, history, updates, comments] = await Promise.all([
      listItems<Member>("members"),
      listItems<AvailabilityEntry>("availability"),
      listItems<ActivityHistoryItem>("history"),
      listItems<TeamUpdate>("updates"),
      listItems<Comment>("comments"),
    ]);

    return json({
      members: members.sort((a, b) => a.displayName.localeCompare(b.displayName)),
      availability: sortByDate(availability, "start", "asc"),
      history: sortByDate(history, "createdAt", "desc"),
      updates: sortByDate(updates, "createdAt", "desc"),
      comments: sortByDate(comments, "createdAt", "asc"),
    });
  },
});

app.http("saveMember", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "member",
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const principal = requireUser(request);
    const body = await getBody<{ displayName?: string; roles?: TeamRole[] }>(request);
    const displayName = body.displayName?.trim() || principal.userDetails.split("@")[0] || "Team member";
    const roles = Array.isArray(body.roles) ? body.roles : [];
    const member: Member = {
      id: principal.userId,
      displayName,
      email: principal.userDetails,
      roles,
      updatedAt: new Date().toISOString(),
    };

    await upsertItem("members", member);
    await addHistory(principal, "roles_updated", `Updated roles to ${roles.join(", ") || "no roles selected"}.`);
    return json(member);
  },
});

app.http("createAvailability", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "availability",
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const principal = requireUser(request);
    const body = await getBody<{ start?: string; end?: string; notes?: string; calendarEventId?: string }>(request);
    if (!body.start || !body.end || new Date(body.end) <= new Date(body.start)) {
      return text("Start and end times are required, and end must be after start.");
    }

    const memberName = await getMemberName(principal);
    const now = new Date().toISOString();
    const item: AvailabilityEntry = {
      id: randomUUID(),
      uid: principal.userId,
      memberName,
      start: body.start,
      end: body.end,
      notes: body.notes || "",
      calendarEventId: body.calendarEventId,
      createdAt: now,
      updatedAt: now,
    };

    await upsertItem("availability", item);
    await addHistory(principal, "availability_created", `Added planned attendance for ${new Date(body.start).toLocaleDateString()}.`);
    return json(item, 201);
  },
});

app.http("updateAvailability", {
  methods: ["PUT", "DELETE"],
  authLevel: "anonymous",
  route: "availability/{id}",
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const principal = requireUser(request);
    const id = String(request.params.id || "");
    const existing = await getItem<AvailabilityEntry>("availability", id);
    if (!existing) {
      return text("Attendance plan not found.", 404);
    }
    if (existing.uid !== principal.userId) {
      return text("You can only change your own attendance plans.", 403);
    }

    if (request.method === "DELETE") {
      await deleteItem("availability", id);
      await addHistory(principal, "availability_deleted", `Deleted planned attendance for ${new Date(existing.start).toLocaleDateString()}.`);
      context.log(`Deleted availability ${id}`);
      return { status: 204 };
    }

    const body = await getBody<{ start?: string; end?: string; notes?: string; calendarEventId?: string }>(request);
    if (!body.start || !body.end || new Date(body.end) <= new Date(body.start)) {
      return text("Start and end times are required, and end must be after start.");
    }

    const updated: AvailabilityEntry = {
      ...existing,
      memberName: await getMemberName(principal),
      start: body.start,
      end: body.end,
      notes: body.notes || "",
      calendarEventId: body.calendarEventId || existing.calendarEventId,
      updatedAt: new Date().toISOString(),
    };

    await upsertItem("availability", updated);
    await addHistory(principal, "availability_updated", `Updated planned attendance for ${new Date(body.start).toLocaleDateString()}.`);
    return json(updated);
  },
});

app.http("postUpdate", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "updates",
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const principal = requireUser(request);
    const body = await getBody<{ body?: string }>(request);
    if (!body.body?.trim()) {
      return text("Update text is required.");
    }

    const item: TeamUpdate = {
      id: randomUUID(),
      authorUid: principal.userId,
      authorName: await getMemberName(principal),
      body: body.body.trim(),
      createdAt: new Date().toISOString(),
    };

    await upsertItem("updates", item);
    return json(item, 201);
  },
});

app.http("postComment", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "comments",
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const principal = requireUser(request);
    const body = await getBody<{ updateId?: string; body?: string }>(request);
    if (!body.updateId || !body.body?.trim()) {
      return text("Update ID and comment text are required.");
    }

    const item: Comment = {
      id: randomUUID(),
      updateId: body.updateId,
      authorUid: principal.userId,
      authorName: await getMemberName(principal),
      body: body.body.trim(),
      createdAt: new Date().toISOString(),
    };

    await upsertItem("comments", item);
    return json(item, 201);
  },
});

app.http("notificationTarget", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "notification-target",
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const principal = requireUser(request);
    const body = await getBody<{ target?: string }>(request);
    const item: NotificationTarget = {
      id: principal.userId,
      uid: principal.userId,
      target: body.target?.trim() || "",
      updatedAt: new Date().toISOString(),
    };

    await upsertItem("notificationTargets", item);
    return json(item);
  },
});
