import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

initializeApp();

const db = getFirestore();
const messaging = getMessaging();

type NotificationToken = {
  uid?: string;
  token?: string;
};

const getRecipientTokens = async (authorUid?: string) => {
  const snapshot = await db.collection("notificationTokens").get();
  const tokens: string[] = [];

  snapshot.forEach((doc) => {
    const data = doc.data() as NotificationToken;
    if (data.token && data.uid !== authorUid) {
      tokens.push(data.token);
    }
  });

  return tokens;
};

const sendTeamNotification = async (authorUid: string | undefined, title: string, body: string) => {
  const tokens = await getRecipientTokens(authorUid);
  if (tokens.length === 0) {
    return;
  }

  await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title,
      body,
    },
    webpush: {
      notification: {
        icon: "/icon.svg",
      },
    },
  });
};

export const notifyOnUpdate = onDocumentCreated("updates/{updateId}", async (event) => {
  const data = event.data?.data();
  if (!data) {
    return;
  }

  await sendTeamNotification(
    data.authorUid,
    "New Raptor Robotics update",
    `${data.authorName || "A teammate"}: ${String(data.body || "").slice(0, 120)}`,
  );
});

export const notifyOnComment = onDocumentCreated("comments/{commentId}", async (event) => {
  const data = event.data?.data();
  if (!data) {
    return;
  }

  await sendTeamNotification(
    data.authorUid,
    "New Raptor Robotics comment",
    `${data.authorName || "A teammate"}: ${String(data.body || "").slice(0, 120)}`,
  );
});
