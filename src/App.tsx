import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  DocumentData,
  QuerySnapshot,
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getToken, onMessage } from "firebase/messaging";
import { auth, db, getAppMessaging, isFirebaseConfigured } from "./firebase";
import { createCalendarEvent, getCalendarAccessToken, updateCalendarEvent } from "./googleCalendar";
import {
  ActivityHistoryItem,
  AvailabilityEntry,
  Comment,
  Member,
  ROLE_OPTIONS,
  TeamRole,
  TeamUpdate,
} from "./types";

const today = () => new Date().toISOString().slice(0, 10);
const calendarId = import.meta.env.VITE_TEAM_CALENDAR_ID || "primary";

type AuthMode = "register" | "login";

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

const snapshotToList = <T extends { id: string }>(snapshot: QuerySnapshot<DocumentData>) =>
  snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as T);

const timestampToDate = (timestamp?: Timestamp) => timestamp?.toDate() ?? new Date(0);

const formatDateTime = (timestamp?: Timestamp) =>
  timestamp
    ? timestamp.toDate().toLocaleString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Pending";

const formatShortDate = (timestamp?: Timestamp) =>
  timestamp
    ? timestamp.toDate().toLocaleDateString([], {
        month: "short",
        day: "numeric",
      })
    : "Pending";

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
  const start = timestampToDate(entry.start);
  const end = timestampToDate(entry.end);
  return Math.max(0, end.getTime() - start.getTime()) / 3_600_000;
};

const makeCalendarDescription = (memberName: string, notes: string) =>
  [`Raptor Robotics A team planned attendance for ${memberName}.`, notes && `Notes: ${notes}`]
    .filter(Boolean)
    .join("\n\n");

function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("register");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [members, setMembers] = useState<Member[]>([]);
  const [availability, setAvailability] = useState<AvailabilityEntry[]>([]);
  const [history, setHistory] = useState<ActivityHistoryItem[]>([]);
  const [updates, setUpdates] = useState<TeamUpdate[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [dataError, setDataError] = useState("");

  const [profileName, setProfileName] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<TeamRole[]>([]);
  const [availabilityForm, setAvailabilityForm] = useState(initialAvailabilityForm);
  const [updateText, setUpdateText] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [calendarAccessToken, setCalendarAccessToken] = useState("");
  const [calendarStatus, setCalendarStatus] = useState("Calendar not connected yet.");
  const [notificationStatus, setNotificationStatus] = useState("Phone notifications are off.");
  const [actionMessage, setActionMessage] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user?.emailVerified) {
      setMembers([]);
      setAvailability([]);
      setHistory([]);
      setUpdates([]);
      setComments([]);
      return;
    }

    const fallbackName = user.displayName || user.email?.split("@")[0] || "Team member";
    void setDoc(
      doc(db, "members", user.uid),
      {
        displayName: fallbackName,
        email: user.email || "",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    const unsubscribers = [
      onSnapshot(
        query(collection(db, "members"), orderBy("displayName", "asc")),
        (snapshot) => setMembers(snapshotToList<Member>(snapshot)),
        (error) => setDataError(error.message),
      ),
      onSnapshot(
        query(collection(db, "availability"), orderBy("start", "asc")),
        (snapshot) => setAvailability(snapshotToList<AvailabilityEntry>(snapshot)),
        (error) => setDataError(error.message),
      ),
      onSnapshot(
        query(collection(db, "activityHistory"), orderBy("createdAt", "desc")),
        (snapshot) => setHistory(snapshotToList<ActivityHistoryItem>(snapshot)),
        (error) => setDataError(error.message),
      ),
      onSnapshot(
        query(collection(db, "updates"), orderBy("createdAt", "desc")),
        (snapshot) => setUpdates(snapshotToList<TeamUpdate>(snapshot)),
        (error) => setDataError(error.message),
      ),
      onSnapshot(
        query(collection(db, "comments"), orderBy("createdAt", "asc")),
        (snapshot) => setComments(snapshotToList<Comment>(snapshot)),
        (error) => setDataError(error.message),
      ),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [user]);

  const currentMember = useMemo(() => members.find((member) => member.id === user?.uid), [members, user?.uid]);

  useEffect(() => {
    if (!currentMember) {
      return;
    }

    setProfileName(currentMember.displayName);
    setSelectedRoles(currentMember.roles || []);
  }, [currentMember]);

  const upcomingAvailability = useMemo(() => {
    const now = new Date();
    return availability.filter((entry) => timestampToDate(entry.end) >= now);
  }, [availability]);

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
        members: members.filter((member) => member.roles?.includes(role)),
      })),
    [members],
  );

  const commentsByUpdate = useMemo(() => {
    const grouped: Record<string, Comment[]> = {};

    comments.forEach((comment) => {
      grouped[comment.updateId] = [...(grouped[comment.updateId] || []), comment];
    });

    return grouped;
  }, [comments]);

  const handleAuthSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthMessage("");

    try {
      if (authPassword.length > 8) {
        throw new Error("Passwords must be 8 characters or fewer.");
      }

      if (authPassword.length < 6) {
        throw new Error("Firebase email/password accounts require at least 6 characters.");
      }

      if (authMode === "register") {
        const credential = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        await updateProfile(credential.user, { displayName: authName.trim() });
        await sendEmailVerification(credential.user);
        setAuthMessage("Account created. Check your email and verify it before using the team app.");
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      }
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleRefreshVerification = async () => {
    if (!user) {
      return;
    }

    await user.reload();
    setUser(auth.currentUser);
  };

  const handleResendVerification = async () => {
    if (!user) {
      return;
    }

    await sendEmailVerification(user);
    setAuthMessage("Verification email sent again.");
  };

  const addHistory = async (type: ActivityHistoryItem["type"], summary: string) => {
    if (!user) {
      return;
    }

    await addDoc(collection(db, "activityHistory"), {
      actorUid: user.uid,
      actorName: profileName || user.displayName || user.email || "Team member",
      type,
      summary,
      createdAt: serverTimestamp(),
    });
  };

  const handleRoleToggle = (role: TeamRole) => {
    setSelectedRoles((roles) => (roles.includes(role) ? roles.filter((item) => item !== role) : [...roles, role]));
  };

  const handleSaveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) {
      return;
    }

    const displayName = profileName.trim() || user.email?.split("@")[0] || "Team member";
    await updateProfile(user, { displayName });
    await setDoc(
      doc(db, "members", user.uid),
      {
        displayName,
        email: user.email || "",
        roles: selectedRoles,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    await addHistory("roles_updated", `Updated roles to ${selectedRoles.join(", ") || "no roles selected"}.`);
    setActionMessage("Profile and roles saved.");
  };

  const handleConnectCalendar = async () => {
    try {
      const token = await getCalendarAccessToken();
      setCalendarAccessToken(token);
      setCalendarStatus(`Connected to Google Calendar (${calendarId}). New attendance plans will create events.`);
    } catch (error) {
      setCalendarStatus(error instanceof Error ? error.message : "Could not connect Google Calendar.");
    }
  };

  const handleSaveAvailability = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) {
      return;
    }

    const start = combineDateAndTime(availabilityForm.date, availabilityForm.startTime);
    const end = combineDateAndTime(availabilityForm.date, availabilityForm.endTime);
    if (end <= start) {
      setActionMessage("End time must be after start time.");
      return;
    }

    const memberName = profileName || user.displayName || user.email || "Team member";
    const title = `${memberName} - robotics attendance`;
    const calendarPayload = {
      title,
      description: makeCalendarDescription(memberName, availabilityForm.notes),
      start,
      end,
    };

    try {
      let calendarEventId = "";
      const existingEntry = availability.find((entry) => entry.id === availabilityForm.editingId);

      if (calendarAccessToken) {
        if (existingEntry?.calendarEventId) {
          await updateCalendarEvent(calendarAccessToken, calendarId, existingEntry.calendarEventId, calendarPayload);
          calendarEventId = existingEntry.calendarEventId;
        } else {
          calendarEventId = await createCalendarEvent(calendarAccessToken, calendarId, calendarPayload);
        }
      }

      if (availabilityForm.editingId) {
        await updateDoc(doc(db, "availability", availabilityForm.editingId), {
          memberName,
          start: Timestamp.fromDate(start),
          end: Timestamp.fromDate(end),
          notes: availabilityForm.notes.trim(),
          ...(calendarEventId ? { calendarEventId } : {}),
          updatedAt: serverTimestamp(),
        });
        await addHistory("availability_updated", `Updated planned attendance for ${formatShortDate(Timestamp.fromDate(start))}.`);
        setActionMessage("Attendance plan updated.");
      } else {
        await addDoc(collection(db, "availability"), {
          uid: user.uid,
          memberName,
          start: Timestamp.fromDate(start),
          end: Timestamp.fromDate(end),
          notes: availabilityForm.notes.trim(),
          ...(calendarEventId ? { calendarEventId } : {}),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await addHistory("availability_created", `Added planned attendance for ${formatShortDate(Timestamp.fromDate(start))}.`);
        setActionMessage(calendarEventId ? "Attendance plan saved and added to Google Calendar." : "Attendance plan saved.");
      }

      setAvailabilityForm(initialAvailabilityForm);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Could not save attendance.");
    }
  };

  const handleEditAvailability = (entry: AvailabilityEntry) => {
    const start = timestampToDate(entry.start);
    const end = timestampToDate(entry.end);
    setAvailabilityForm({
      editingId: entry.id,
      date: toLocalInputDate(start),
      startTime: toLocalInputTime(start),
      endTime: toLocalInputTime(end),
      notes: entry.notes || "",
    });
  };

  const handleDeleteAvailability = async (entry: AvailabilityEntry) => {
    if (entry.uid !== user?.uid) {
      return;
    }

    await deleteDoc(doc(db, "availability", entry.id));
    await addHistory("availability_deleted", `Deleted planned attendance for ${formatShortDate(entry.start)}.`);
    setActionMessage("Attendance plan deleted from the app. Remove the Calendar event manually if one was created.");
  };

  const handlePostUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !updateText.trim()) {
      return;
    }

    await addDoc(collection(db, "updates"), {
      authorUid: user.uid,
      authorName: profileName || user.displayName || user.email || "Team member",
      body: updateText.trim(),
      createdAt: serverTimestamp(),
    });
    setUpdateText("");
    setActionMessage("Team update posted.");
  };

  const handlePostComment = async (event: FormEvent, updateId: string) => {
    event.preventDefault();
    const body = commentDrafts[updateId]?.trim();
    if (!user || !body) {
      return;
    }

    await addDoc(collection(db, "comments"), {
      updateId,
      authorUid: user.uid,
      authorName: profileName || user.displayName || user.email || "Team member",
      body,
      createdAt: serverTimestamp(),
    });
    setCommentDrafts((drafts) => ({ ...drafts, [updateId]: "" }));
  };

  const handleEnableNotifications = async () => {
    if (!user) {
      return;
    }

    try {
      if (!("Notification" in window)) {
        throw new Error("This browser does not support push notifications.");
      }

      if (!import.meta.env.VITE_FIREBASE_VAPID_KEY) {
        throw new Error("Add VITE_FIREBASE_VAPID_KEY before enabling phone notifications.");
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notifications were not allowed on this device.");
      }

      const messaging = await getAppMessaging();
      if (!messaging) {
        throw new Error("Firebase Messaging is not supported by this browser.");
      }

      const serviceWorkerRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      const token = await getToken(messaging, {
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
        serviceWorkerRegistration,
      });

      await setDoc(
        doc(db, "notificationTokens", user.uid),
        {
          uid: user.uid,
          email: user.email || "",
          token,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      onMessage(messaging, (payload) => {
        const title = payload.notification?.title || "Raptor Robotics A team";
        const body = payload.notification?.body || "New team activity.";
        new Notification(title, { body });
      });

      setNotificationStatus("Phone notifications are on for this device.");
    } catch (error) {
      setNotificationStatus(error instanceof Error ? error.message : "Could not enable notifications.");
    }
  };

  if (authLoading) {
    return <main className="centered">Loading Raptor Robotics A team...</main>;
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="eyebrow">High school robotics team portal</p>
          <h1>Raptor Robotics A team</h1>
          <p className="muted">
            Plan build room attendance, sync plans to Google Calendar, choose team roles, and collaborate in one place.
          </p>

          {!isFirebaseConfigured && (
            <div className="notice warning">
              Add Firebase values in <code>.env</code> before sign up, login, and deployment will work.
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="stacked-form">
            {authMode === "register" && (
              <label>
                Full name
                <input value={authName} onChange={(event) => setAuthName(event.target.value)} required />
              </label>
            )}
            <label>
              Email
              <input
                type="email"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                autoComplete={authMode === "register" ? "new-password" : "current-password"}
                minLength={6}
                maxLength={8}
                required
              />
              <span className="hint">Use 6-8 characters. Firebase stores passwords securely and never exposes them.</span>
            </label>
            <button disabled={authBusy}>{authBusy ? "Working..." : authMode === "register" ? "Create account" : "Log in"}</button>
          </form>

          <button className="link-button" onClick={() => setAuthMode(authMode === "register" ? "login" : "register")}>
            {authMode === "register" ? "Already registered? Log in" : "Need an account? Register"}
          </button>

          {authMessage && <div className="notice">{authMessage}</div>}
        </section>
      </main>
    );
  }

  if (!user.emailVerified) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="eyebrow">Verify your account</p>
          <h1>Check your email</h1>
          <p className="muted">
            Your Raptor Robotics A team account is created, but the app unlocks after email verification.
          </p>
          <div className="button-row">
            <button onClick={handleRefreshVerification}>I verified my email</button>
            <button className="secondary" onClick={handleResendVerification}>
              Resend email
            </button>
            <button className="ghost" onClick={() => signOut(auth)}>
              Sign out
            </button>
          </div>
          {authMessage && <div className="notice">{authMessage}</div>}
        </section>
      </main>
    );
  }

  return (
    <main>
      <header className="hero">
        <nav>
          <strong>Raptor Robotics A team</strong>
          <button className="ghost light" onClick={() => signOut(auth)}>
            Sign out
          </button>
        </nav>
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Team operations dashboard</p>
            <h1>Plan meetings, track roles, and keep everyone in sync.</h1>
            <p>
              Members can add planned attendance, update their role choices, post team updates, and comment from any
              device.
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
          <strong>Google Calendar</strong>
          <span>{calendarStatus}</span>
        </div>
        <button onClick={handleConnectCalendar}>Connect Calendar</button>
        <div>
          <strong>Notifications</strong>
          <span>{notificationStatus}</span>
        </div>
        <button onClick={handleEnableNotifications}>Enable phone notifications</button>
      </section>

      {(dataError || actionMessage) && <div className="page-notice">{dataError || actionMessage}</div>}

      <section className="dashboard-grid">
        <article className="card">
          <h2>Your account and roles</h2>
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
                  {entry.uid === user.uid && (
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
            {members.map((member) => (
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
          {membersByRole.map(({ role, members: roleMembers }) => (
            <div key={role} className="role-column">
              <h3>{role}</h3>
              {roleMembers.length === 0 ? (
                <p className="muted">No one has chosen this role yet.</p>
              ) : (
                roleMembers.map((member) => <span key={member.id}>{member.displayName}</span>)
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
            {updates.length === 0 && <p className="muted">No updates yet. Start the first thread.</p>}
            {updates.map((update) => (
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
            {history.length === 0 && <p className="muted">Role and attendance changes will show here.</p>}
            {history.slice(0, 20).map((item) => (
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
        <p className="eyebrow">Deployment checklist</p>
        <h2>What still needs real Google project setup</h2>
        <ul>
          <li>Create a Firebase project, enable Email/Password auth, Firestore, Hosting, and Cloud Messaging.</li>
          <li>Create an OAuth client in Google Cloud and add the Calendar API for team calendar events.</li>
          <li>Deploy the included Cloud Function if closed-app phone notifications are required.</li>
          <li>Invite team members and decide whether an adult mentor should approve accounts or roles.</li>
        </ul>
      </section>
    </main>
  );
}

export default App;
