/* eslint-disable no-undef */
// Replace this config with the same Firebase web config values from your .env file
// before deploying Cloud Messaging background notifications.
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Raptor Robotics A team";
  const options = {
    body: payload.notification?.body || "New team activity.",
    icon: "/icon.svg",
  };

  self.registration.showNotification(title, options);
});
