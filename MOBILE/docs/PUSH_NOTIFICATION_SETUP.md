# Firebase Push Notification Setup Guide

## Prerequisites

1. **Firebase Project**: Create a project at [Firebase Console](https://console.firebase.google.com)
2. **Android App**: Register your Android app with package name `com.tradequip.app`

---

## Step 1: Download google-services.json

1. Go to Firebase Console → Project Settings → Your Apps
2. Download `google-services.json`
3. Copy to: `MOBILE/android/app/google-services.json`

---

## Step 2: Update Gradle Configuration

### android/build.gradle (Project level)
```gradle
buildscript {
    dependencies {
        classpath 'com.google.gms:google-services:4.4.0'
    }
}
```

### android/app/build.gradle (App level)
```gradle
apply plugin: 'com.google.gms.google-services'

dependencies {
    implementation platform('com.google.firebase:firebase-bom:32.7.0')
    implementation 'com.google.firebase:firebase-messaging'
}
```

---

## Step 3: Update AndroidManifest.xml

Add to `android/app/src/main/AndroidManifest.xml`:

```xml
<manifest>
    <application>
        <!-- Firebase Messaging Service -->
        <service
            android:name="com.google.firebase.messaging.FirebaseMessagingService"
            android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>
        
        <!-- Notification Icon -->
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_icon"
            android:resource="@drawable/ic_notification" />
        
        <!-- Notification Color -->
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_color"
            android:resource="@color/brand_blue" />
    </application>
</manifest>
```

---

## Step 4: Backend Integration

Create endpoint to store FCM tokens:

```typescript
// server/routes/push.ts
app.post('/api/push/register', ensureAuth, async (req, res) => {
  const { token, platform } = req.body;
  const userId = req.session.userId;
  
  await db.insert(pushTokens).values({
    userId,
    token,
    platform,
    createdAt: new Date(),
  });
  
  res.json({ success: true });
});
```

---

## Step 5: Send Notifications (Server)

```typescript
import admin from 'firebase-admin';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function sendPushNotification(token: string, title: string, body: string, data?: object) {
  await admin.messaging().send({
    token,
    notification: { title, body },
    data: data as { [key: string]: string },
    android: {
      priority: 'high',
      notification: {
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        channelId: 'tradequip_trades',
      },
    },
  });
}
```

---

## Notification Types for TradeQuip

| Type | When | Priority |
|------|------|----------|
| `trade_executed` | Trade opens/closes | High |
| `price_alert` | Price target hit | High |
| `margin_warning` | Low margin | Critical |
| `account_update` | Balance change | Normal |
| `news_alert` | Market news | Low |

---

## Testing

```bash
# Test FCM with curl
curl -X POST \
  https://fcm.googleapis.com/fcm/send \
  -H 'Authorization: key=YOUR_SERVER_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "to": "DEVICE_FCM_TOKEN",
    "notification": {
      "title": "Trade Executed",
      "body": "Your USDJPY buy order has been filled"
    }
  }'
```
