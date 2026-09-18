// PLACEHOLDER — FCM push registration (H8). DISABLED.
//
// api.md §4 defines `POST /me/devices` (register FCM push token) and
// `DELETE /me/devices/{id}`. Registering needs a Firebase project owned by the
// team, which does not exist yet, plus a development build (push tokens are
// not available in Expo Go on Android). Until then the app receives alerts by
// polling `GET /me/inbox` (InboxService).
//
// When a Firebase project exists: add expo-notifications, obtain the device
// token, and POST `{ platform: "ANDROID", push_token, app_version }` here.
// The request body above is an assumption to confirm with the backend owner:
// api.md does not freeze the body of `POST /me/devices`.

export const PUSH_REGISTRATION_ENABLED = false;

export type PushRegistrationStatus = 'NOT_CONNECTED';

export function pushRegistrationStatus(): PushRegistrationStatus {
  return 'NOT_CONNECTED';
}

/** Always a no-op while PUSH_REGISTRATION_ENABLED is false. Never sends a request. */
export async function registerForPush(): Promise<{ registered: false; reason: string }> {
  return {
    registered: false,
    reason: 'Push notifications are not connected (no Firebase project). Alerts arrive by inbox polling.',
  };
}
