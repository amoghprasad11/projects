import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteAvailability,
  getAppState,
  getClientPrincipal,
  postComment,
  postUpdate,
  registerNotificationTarget,
  saveAvailability,
  saveMember,
} from "./api";
import { createCalendarEvent, deleteCalendarEvent, getGraphAccessToken, updateCalendarEvent } from "./microsoftGraph";
import {
  ActivityHistoryItem,
  AppState,
  AvailabilityEntry,
  ClientPrincipal,
  Comment,
  Member,
  ROLE_OPTIONS,
  TeamRole,
  TeamUpdate,
} from "./types";

const emptyState: AppState = {
  members: [],
  availability: [],
  history: [],
  updates: [],
  comments: [],
};

const today = () => new Date().toISOString().slice(0, 10);

type AvailabilityForm = {
  editingId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  notes: string;
};

const initialAvailabilityForm: AvailabilityForm = {
  editingId: null,
  date: today(),
  startTime: "15:30",
  endTime: "18:00",
  notes: "",
};

const formatDateTime = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Pending";

const formatShortDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });

const formatHours = (hours: number) => `${hours.toFixed(1)} hr${hours === 1 ? "" : "s"}`;

const toLocalInputDate = (date: Date) => {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 10);
};

const toLocalInputTime = (date: Date) => {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(11, 16);
};

const combineDateAndTime = (date: string, time: string) => new Date(`${date}T${time}`);

const getDurationHours = (entry: AvailabilityEntry) => {
  const start = new Date(entry.start);
  const end = new Date(entry.end);
  return Math.max(0, end.getTime() - start.getTime()) / 3_600_000;
};

const makeCalendarDescription = (memberName: string, notes: string) =>
  [`Raptor Robotics A team planned attendance for ${memberName}.`, notes && `Notes: ${notes}`]
    .filter(Boolean)
    .join("\n\n");

const getDisplayName = (principal: ClientPrincipal | null, member?: Member) =>
  member?.displayName || principal?.userDetails?.split("@")[0] || "Team member";

function App() {
  const [principal, setPrincipal] = useState<ClientPrincipal | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [state, setState] = useState<AppState>(emptyState);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState("");
  const [profileName, setProfileName] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<TeamRole[]>([]);
  const [availabilityForm, setAvailabilityForm] = useState(initialAvailabilityForm);
  const [updateText, setUpdateText] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [graphAccessToken, setGraphAccessToken] = useState("");
  const [calendarStatus, setCalendarStatus] = useState("Microsoft Calendar is not connected yet.");
  const [notificationTarget, setNotificationTarget] = useState("");
  const [notificationStatus, setNotificationStatus] = useState("Phone notification target is not saved yet.");
  const [actionMessage, setActionMessage] = useState("");

  const currentMember = useMemo(
    () => state.members.find((member) => member.id === principal?.userId),
    [state.members, principal?.userId],
  );

  const loadState = useCallback(async () => {
    if (!principal) {
      return;
    }

    try {
      setDataLoading(true);
      setDataError("");
      const nextState = await getAppState();
      setState(nextState);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Could not load team data.");
    } finally {
      setDataLoading(false);
    }
  }, [principal]);

  useEffect(() => {
    const loadPrincipal = async () => {
      const nextPrincipal = await getClientPrincipal();
      setPrincipal(nextPrincipal);
      setAuthLoading(false);
    };

    void loadPrincipal();
  }, []);

  useEffect(() => {
    void loadState();
    const interval = window.setInterval(() => void loadState(), 15_000);
    return () => window.clearInterval(interval);
  }, [loadState]);

  useEffect(() => {
    if (!principal) {
      return;
    }

    setProfileName(getDisplayName(principal, currentMember));
    setSelectedRoles(currentMember?.roles || []);
  }, [currentMember, principal]);

  const upcomingAvailability = useMemo(() => {
    const now = new Date();
    return state.availability.filter((entry) => new Date(entry.end) >= now);
  }, [state.availability]);

  const plannedHours = useMemo(() => {
    const totals = new Map<string, number>();
    let teamTotal = 0;

    upcomingAvailability.forEach((entry) => {
      const hours = getDurationHours(entry);
      teamTotal += hours;
      totals.set(entry.uid, (totals.get(entry.uid) || 0) + hours);
    });

    return { teamTotal, totals };
  }, [upcomingAvailability]);

  const membersByRole = useMemo(
    () =>
      ROLE_OPTIONS.map((role) => ({
        role,
        members: state.members.filter((member) => member.roles?.includes(role)),
      })),
    [state.members],
  );

  const commentsByUpdate = useMemo(() => {
    const grouped: Record<string, Comment[]> = {};

    state.comments.forEach((comment) => {
      grouped[comment.updateId] = [...(grouped[comment.updateId] || []), comment];
    });

    return grouped;
  }, [state.comments]);

  const userName = getDisplayName(principal, currentMember);

  const handleRoleToggle = (role: TeamRole) => {
    setSelectedRoles((roles) => (roles.includes(role) ? roles.filter((item) => item !== role) : [...roles, role]));
  };

  const handleSaveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setActionMessage("");

    try {
      await saveMember(profileName.trim() || userName, selectedRoles);
      await loadState();
      setActionMessage("Profile and roles saved.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Could not save profile.");
    }
  };

  const handleConnectCalendar = async () => {
    try {
      const token = await getGraphAccessToken();
      setGraphAccessToken(token);
      setCalendarStatus("Connected to Microsoft Calendar. New attendance plans will create Outlook calendar events.");
    } catch (error) {
      setCalendarStatus(error instanceof Error ? error.message : "Could not connect Microsoft Calendar.");
    }
  };

  const handleSaveAvailability = async (event: FormEvent) => {
    event.preventDefault();
    setActionMessage("");

    const start = combineDateAndTime(availabilityForm.date, availabilityForm.startTime);
    const end = combineDateAndTime(availabilityForm.date, availabilityForm.endTime);
    if (end <= start) {
      setActionMessage("End time must be after start time.");
      return;
    }

    const memberName = profileName || userName;
    const calendarPayload = {
      title: `${memberName} - robotics attendance`,
      description: makeCalendarDescription(memberName, availabilityForm.notes),
      start,
      end,
    };

    try {
      let calendarEventId = "";
      const existingEntry = state.availability.find((entry) => entry.id === availabilityForm.editingId);

      if (graphAccessToken) {
        if (existingEntry?.calendarEventId) {
          await updateCalendarEvent(graphAccessToken, existingEntry.calendarEventId, calendarPayload);
          calendarEventId = existingEntry.calendarEventId;
        } else {
          calendarEventId = await createCalendarEvent(graphAccessToken, calendarPayload);
        }
      }

      await saveAvailability({
        id: availabilityForm.editingId || undefined,
        start: start.toISOString(),
        end: end.toISOString(),
        notes: availabilityForm.notes.trim(),
        calendarEventId: calendarEventId || existingEntry?.calendarEventId,
      });
      await loadState();
      setAvailabilityForm(initialAvailabilityForm);
      setActionMessage(
        calendarEventId
          ? "Attendance plan saved and synced to Microsoft Calendar."
          : "Attendance plan saved. Connect Microsoft Calendar if you also want an Outlook event.",
      );
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Could not save attendance.");
    }
  };

  const handleEditAvailability = (entry: AvailabilityEntry) => {
    const start = new Date(entry.start);
    const end = new Date(entry.end);
    setAvailabilityForm({
      editingId: entry.id,
      date: toLocalInputDate(start),
      startTime: toLocalInputTime(start),
      endTime: toLocalInputTime(end),
      notes: entry.notes || "",
    });
  };

  const handleDeleteAvailability = async (entry: AvailabilityEntry) => {
    if (entry.uid !== principal?.userId) {
      return;
    }

    try {
      if (graphAccessToken && entry.calendarEventId) {
        await deleteCalendarEvent(graphAccessToken, entry.calendarEventId);
      }
      await deleteAvailability(entry.id);
      await loadState();
      setActionMessage("Attendance plan deleted.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Could not delete attendance.");
    }
  };

  const handlePostUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (!updateText.trim()) {
      return;
    }

    try {
      await postUpdate(updateText.trim());
      setUpdateText("");
      await loadState();
      setActionMessage("Team update posted.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Could not post update.");
    }
  };

  const handlePostComment = async (event: FormEvent, updateId: string) => {
    event.preventDefault();
    const body = commentDrafts[updateId]?.trim();
    if (!body) {
      return;
    }

    try {
      await postComment(updateId, body);
      setCommentDrafts((drafts) => ({ ...drafts, [updateId]: "" }));
      await loadState();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Could not post comment.");
    }
  };

  const handleSaveNotificationTarget = async (event: FormEvent) => {
    event.preventDefault();

    try {
      await registerNotificationTarget(notificationTarget.trim());
      setNotificationStatus("Notification target saved. Wire Azure Communication Services or Notification Hubs to send.");
    } catch (error) {
      setNotificationStatus(error instanceof Error ? error.message : "Could not save notification target.");
    }
  };

  if (authLoading) {
    return <main className="centered">Loading Raptor Robotics A team...</main>;
  }

  if (!principal) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="eyebrow">Azure-hosted robotics team portal</p>
          <h1>Raptor Robotics A team</h1>
          <p className="muted">
            Sign in or register through Microsoft Entra External ID / Azure Static Web Apps authentication.
          </p>
          <div className="notice warning">
            Configure Azure Static Web Apps authentication with Microsoft Entra External ID for email verification and the
            requested password policy.
          </div>
          <div className="button-row">
            <a className="button-link" href="/.auth/login/aad?post_login_redirect_uri=/">
              Sign in with Microsoft
            </a>
            <a className="button-link secondary-link" href="/.auth/login/aad?post_login_redirect_uri=/">
              Register account
            </a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main>
      <header className="hero">
        <nav>
          <strong>Raptor Robotics A team</strong>
          <a className="logout-link" href="/.auth/logout?post_logout_redirect_uri=/">
            Sign out
          </a>
        </nav>
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Azure team operations dashboard</p>
            <h1>Plan meetings, track roles, and keep everyone in sync.</h1>
            <p>
              Members can add planned attendance, sync plans to Microsoft Calendar, update role choices, post team
              updates, and comment from any device.
            </p>
          </div>
          <div className="stats-card">
            <span>Total planned hours</span>
            <strong>{formatHours(plannedHours.teamTotal)}</strong>
            <small>{upcomingAvailability.length} upcoming attendance plans</small>
          </div>
        </div>
      </header>

      <section className="status-strip">
        <div>
          <strong>Microsoft Calendar</strong>
          <span>{calendarStatus}</span>
        </div>
        <button onClick={handleConnectCalendar}>Connect Calendar</button>
        <div>
          <strong>Phone notifications</strong>
          <span>{notificationStatus}</span>
        </div>
        <form onSubmit={handleSaveNotificationTarget} className="inline-form">
          <input
            value={notificationTarget}
            onChange={(event) => setNotificationTarget(event.target.value)}
            placeholder="phone, email, or Teams webhook"
            aria-label="Notification target"
          />
          <button>Save</button>
        </form>
      </section>

      {(dataError || actionMessage || dataLoading) && (
        <div className="page-notice">{dataLoading ? "Refreshing team data..." : dataError || actionMessage}</div>
      )}

      <section className="dashboard-grid">
        <article className="card">
          <h2>Your account and roles</h2>
          <p className="muted">Signed in as {principal.userDetails}</p>
          <form onSubmit={handleSaveProfile} className="stacked-form">
            <label>
              Display name
              <input value={profileName} onChange={(event) => setProfileName(event.target.value)} required />
            </label>
            <div>
              <span className="label-text">Choose any roles you help with</span>
              <div className="role-picker">
                {ROLE_OPTIONS.map((role) => (
                  <label key={role} className="check-card">
                    <input
                      type="checkbox"
                      checked={selectedRoles.includes(role)}
                      onChange={() => handleRoleToggle(role)}
                    />
                    {role}
                  </label>
                ))}
              </div>
            </div>
            <button>Save roles</button>
          </form>
        </article>

        <article className="card">
          <h2>Plan when you are coming in</h2>
          <form onSubmit={handleSaveAvailability} className="stacked-form">
            <div className="form-grid">
              <label>
                Day
                <input
                  type="date"
                  value={availabilityForm.date}
                  onChange={(event) => setAvailabilityForm({ ...availabilityForm, date: event.target.value })}
                  required
                />
              </label>
              <label>
                Start
                <input
                  type="time"
                  value={availabilityForm.startTime}
                  onChange={(event) => setAvailabilityForm({ ...availabilityForm, startTime: event.target.value })}
                  required
                />
              </label>
              <label>
                End
                <input
                  type="time"
                  value={availabilityForm.endTime}
                  onChange={(event) => setAvailabilityForm({ ...availabilityForm, endTime: event.target.value })}
                  required
                />
              </label>
            </div>
            <label>
              Notes
              <textarea
                value={availabilityForm.notes}
                onChange={(event) => setAvailabilityForm({ ...availabilityForm, notes: event.target.value })}
                placeholder="Example: drivetrain work, autonomous testing, notebook photos..."
              />
            </label>
            <div className="button-row">
              <button>{availabilityForm.editingId ? "Update plan" : "Add plan"}</button>
              {availabilityForm.editingId && (
                <button className="secondary" type="button" onClick={() => setAvailabilityForm(initialAvailabilityForm)}>
                  Cancel edit
                </button>
              )}
            </div>
          </form>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="card wide">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Upcoming plan</p>
              <h2>Attendance schedule</h2>
            </div>
            <strong>{formatHours(plannedHours.teamTotal)} total</strong>
          </div>
          <div className="schedule-list">
            {upcomingAvailability.length === 0 && <p className="muted">No one has added upcoming attendance yet.</p>}
            {upcomingAvailability.map((entry) => (
              <div key={entry.id} className="schedule-item">
                <div>
                  <strong>{entry.memberName}</strong>
                  <span>
                    {formatDateTime(entry.start)} - {formatDateTime(entry.end)}
                  </span>
                  {entry.notes && <small>{entry.notes}</small>}
                </div>
                <div className="item-actions">
                  <strong>{formatHours(getDurationHours(entry))}</strong>
                  {entry.uid === principal.userId && (
                    <>
                      <button className="secondary small" onClick={() => handleEditAvailability(entry)}>
                        Edit
                      </button>
                      <button className="danger small" onClick={() => handleDeleteAvailability(entry)}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <p className="eyebrow">Hours by member</p>
          <h2>Planned totals</h2>
          <div className="totals-list">
            {state.members.map((member) => (
              <div key={member.id}>
                <span>{member.displayName}</span>
                <strong>{formatHours(plannedHours.totals.get(member.id) || 0)}</strong>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="card">
        <p className="eyebrow">Team roles</p>
        <h2>Role groups</h2>
        <div className="role-grid">
          {membersByRole.map(({ role, members }) => (
            <div key={role} className="role-column">
              <h3>{role}</h3>
              {members.length === 0 ? (
                <p className="muted">No one has chosen this role yet.</p>
              ) : (
                members.map((member) => <span key={member.id}>{member.displayName}</span>)
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="dashboard-grid align-start">
        <article className="card wide">
          <p className="eyebrow">Collaboration page</p>
          <h2>Team updates and comments</h2>
          <form onSubmit={handlePostUpdate} className="update-form">
            <textarea
              value={updateText}
              onChange={(event) => setUpdateText(event.target.value)}
              placeholder="Post an update: meeting goals, parts needed, match scouting, notebook reminders..."
              required
            />
            <button>Post update</button>
          </form>

          <div className="updates-list">
            {state.updates.length === 0 && <p className="muted">No updates yet. Start the first thread.</p>}
            {state.updates.map((update: TeamUpdate) => (
              <div key={update.id} className="update-card">
                <div className="update-meta">
                  <strong>{update.authorName}</strong>
                  <span>{formatDateTime(update.createdAt)}</span>
                </div>
                <p>{update.body}</p>
                <div className="comments">
                  {(commentsByUpdate[update.id] || []).map((comment) => (
                    <div key={comment.id} className="comment">
                      <strong>{comment.authorName}</strong>
                      <span>{comment.body}</span>
                    </div>
                  ))}
                </div>
                <form onSubmit={(event) => handlePostComment(event, update.id)} className="comment-form">
                  <input
                    value={commentDrafts[update.id] || ""}
                    onChange={(event) => setCommentDrafts((drafts) => ({ ...drafts, [update.id]: event.target.value }))}
                    placeholder="Add a comment"
                  />
                  <button className="secondary">Comment</button>
                </form>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <p className="eyebrow">Audit trail</p>
          <h2>Recent history</h2>
          <div className="history-list">
            {state.history.length === 0 && <p className="muted">Role and attendance changes will show here.</p>}
            {state.history.slice(0, 20).map((item: ActivityHistoryItem) => (
              <div key={item.id}>
                <strong>{item.actorName}</strong>
                <span>{item.summary}</span>
                <small>{formatDateTime(item.createdAt)}</small>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="card setup-card">
        <p className="eyebrow">Azure setup checklist</p>
        <h2>What still needs real Microsoft Azure configuration</h2>
        <ul>
          <li>Create an Azure Static Web App with API location set to <code>api</code>.</li>
          <li>Configure Microsoft Entra External ID or Entra ID auth for registration and email verification.</li>
          <li>Set up Azure Table Storage and provide <code>AZURE_STORAGE_CONNECTION_STRING</code> for the API.</li>
          <li>Register a Microsoft Graph app and add <code>Calendars.ReadWrite</code> delegated permission.</li>
          <li>Connect Azure Communication Services, Notification Hubs, or Teams webhooks for real phone notifications.</li>
        </ul>
      </section>
    </main>
  );
}

export default App;
