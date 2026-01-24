/**
 * Document Pack 2 (DOC2) - Privacy Policy document manifest
 * Defines privacy policy structure including mobile app specific sections
 */

export const DOC2_TYPES = {
    GLOBAL_MASTER_PRIVACY: 'GLOBAL_MASTER_PRIVACY',
    REGION_ADDENDUM: 'REGION_ADDENDUM',
    COUNTRY_ADDENDUM: 'COUNTRY_ADDENDUM',
} as const;

export type Doc2Type = typeof DOC2_TYPES[keyof typeof DOC2_TYPES];

export interface Doc2Manifest {
    packId: 'DOC2';
    name: 'Privacy Policy';
    description: 'Data collection, processing, and privacy practices';
    requiredDocs: Array<{
        type: Doc2Type;
        description: string;
        required: boolean;
    }>;
}

export const DOC2_MANIFEST: Doc2Manifest = {
    packId: 'DOC2',
    name: 'Privacy Policy',
    description: 'Data collection, processing, and privacy practices',
    requiredDocs: [
        {
            type: 'GLOBAL_MASTER_PRIVACY',
            description: 'Base privacy policy applying to all users worldwide',
            required: true,
        },
        {
            type: 'REGION_ADDENDUM',
            description: 'Region-specific privacy addendum (GDPR, CCPA, etc.)',
            required: false,
        },
        {
            type: 'COUNTRY_ADDENDUM',
            description: 'Country-specific privacy addendum',
            required: false,
        },
    ],
};

/**
 * Get default seed content for initial privacy policy
 */
export function getDefaultGlobalPrivacyPolicy(): { title: string; body: string } {
    return {
        title: 'TradeQuip Privacy Policy',
        body: `
# TradeQuip Privacy Policy

**Effective Date:** [Effective Date]
**Version:** 1.0.0
**Last Updated:** [Last Updated Date]

## 1. Introduction

TradeQuip ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our website and mobile application (collectively, the "Platform").

## 2. Information We Collect

### 2.1 Personal Information

When you register or use our Platform, we may collect:
- **Account Information**: Name, email address, phone number, username
- **Identity Verification**: Government-issued ID, date of birth (where required)
- **Financial Information**: Payment method details, transaction history
- **Profile Data**: Trading preferences, account settings

### 2.2 Technical Information

We automatically collect:
- **Device Information**: Device type, operating system, unique device identifiers
- **Usage Data**: Pages visited, features used, trading activity, session duration
- **Log Data**: IP address, browser type, access times, referring URLs
- **Location Data**: General geographic location based on IP address

### 2.3 Mobile Application Data

When using our mobile app, we may additionally collect:
- **Push Notification Tokens**: To send you alerts and notifications
- **Device Identifiers**: For fraud prevention and analytics
- **App Usage Analytics**: Feature usage patterns, crash reports
- **Biometric Data**: If you enable fingerprint or face unlock (processed locally)

## 3. How We Use Your Information

We use collected information to:
- Provide, maintain, and improve our Platform
- Process transactions and send related information
- Send notifications about your account and trading activity
- Respond to customer service requests
- Detect, prevent, and address fraud and security issues
- Comply with legal and regulatory requirements
- Send marketing communications (with your consent)

## 4. Sharing of Information

We may share your information with:
- **Service Providers**: Third parties that perform services on our behalf
- **Legal Requirements**: When required by law or to protect our rights
- **Business Transfers**: In connection with a merger, acquisition, or sale
- **With Your Consent**: When you authorize us to share information

We do NOT sell your personal information to third parties.

## 5. Data Security

We implement appropriate technical and organizational measures to protect your information, including:
- Encryption of data in transit (TLS/SSL) and at rest
- Regular security assessments and penetration testing
- Access controls and authentication requirements
- Secure development practices

## 6. Data Retention

We retain your information for as long as your account is active or as needed to provide services. We may retain certain information for legal, regulatory, or business purposes after account closure.

## 7. Your Rights

Depending on your jurisdiction, you may have the right to:
- Access your personal information
- Correct inaccurate data
- Request deletion of your data
- Object to or restrict processing
- Data portability
- Withdraw consent

To exercise these rights, contact us at privacy@tradequip.com.

## 8. Cookies and Tracking

We use cookies and similar technologies for:
- Authentication and session management
- Preferences and settings
- Analytics and performance monitoring
- Security and fraud prevention

You can manage cookie preferences through your browser settings.

## 9. Children's Privacy

Our Platform is not intended for individuals under 18 years of age. We do not knowingly collect personal information from children.

## 10. International Data Transfers

Your information may be transferred to and processed in countries other than your own. We ensure appropriate safeguards are in place for such transfers.

## 11. Changes to This Policy

We may update this Privacy Policy from time to time. We will notify you of material changes through the Platform or by email.

## 12. Contact Us

For privacy-related inquiries:
- **Email**: privacy@tradequip.com
- **Address**: [Company Address]

## 13. Regulatory Compliance

### GDPR (EU Users)
For EU users, TradeQuip processes data as a data controller. Legal bases for processing include contract performance, legitimate interests, and consent.

### CCPA (California Users)
California residents have additional rights under CCPA, including the right to know, delete, and opt-out of data sales.

---

*This privacy policy is incorporated into and subject to our Terms of Service.*
    `.trim(),
    };
}

/**
 * Get mobile-specific privacy addendum content
 */
export function getMobileAppPrivacyAddendum(): { title: string; body: string } {
    return {
        title: 'Mobile Application Privacy Addendum',
        body: `
# Mobile Application Privacy Addendum

**Applies to:** TradeQuip Mobile App (Android/iOS)

## Additional Data Collection for Mobile

In addition to the data described in our main Privacy Policy, our mobile application may collect:

### Device Permissions

| Permission | Purpose | Required |
|------------|---------|----------|
| Push Notifications | Trade alerts, price notifications, account updates | Optional |
| Network Access | Platform functionality | Required |
| Biometrics | Quick login (processed locally) | Optional |

### Analytics & Crash Reporting

We use Firebase Analytics and Crashlytics to:
- Monitor app performance and stability
- Identify and fix bugs
- Understand feature usage patterns

### Session Data

- Session tokens are stored securely in the device keychain/keystore
- Session cookies are transmitted securely via HTTPS
- Biometric data never leaves your device

## Your Mobile Privacy Controls

You can control mobile privacy settings by:
- Managing notification preferences in Settings > Notifications
- Revoking device permissions in your device settings
- Logging out to clear session data
- Uninstalling the app to remove all local data

## Third-Party SDKs

Our mobile app includes:
- **Firebase Cloud Messaging**: Push notification delivery
- **Capacitor/WebView**: App framework
- **Analytics**: Usage statistics (anonymized)

## Contact

For mobile-specific privacy questions: mobile-privacy@tradequip.com
    `.trim(),
    };
}
