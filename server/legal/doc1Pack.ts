/**
 * Document Pack 1 (DOC1) - Terms of Service document manifest
 * Defines the required document types and structure for legal compliance
 */

export const DOC1_TYPES = {
  GLOBAL_MASTER_TERMS: 'GLOBAL_MASTER_TERMS',
  REGION_ADDENDUM: 'REGION_ADDENDUM',
  COUNTRY_ADDENDUM: 'COUNTRY_ADDENDUM',
} as const;

export type Doc1Type = typeof DOC1_TYPES[keyof typeof DOC1_TYPES];

export interface Doc1Manifest {
  packId: 'DOC1';
  name: 'Terms of Service';
  description: 'Platform terms, conditions, and legal agreements';
  requiredDocs: Array<{
    type: Doc1Type;
    description: string;
    required: boolean;
  }>;
}

export const DOC1_MANIFEST: Doc1Manifest = {
  packId: 'DOC1',
  name: 'Terms of Service',
  description: 'Platform terms, conditions, and legal agreements',
  requiredDocs: [
    {
      type: 'GLOBAL_MASTER_TERMS',
      description: 'Base terms applying to all users worldwide',
      required: true,
    },
    {
      type: 'REGION_ADDENDUM',
      description: 'Region-specific legal addendum (EU, UK, APAC, etc.)',
      required: false, // Falls back to global terms if missing
    },
    {
      type: 'COUNTRY_ADDENDUM',
      description: 'Country-specific legal addendum',
      required: false, // Falls back to region or global
    },
  ],
};

/**
 * Get default seed content for initial legal documents
 */
export function getDefaultGlobalTerms(): { title: string; body: string } {
  return {
    title: 'TradeQuip Global Terms of Service',
    body: `
# TradeQuip Global Terms of Service

**Effective Date:** [Effective Date]
**Version:** 1.0.0

## 1. Acceptance of Terms

By accessing or using the TradeQuip platform ("Platform"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not access or use the Platform.

## 2. Eligibility

You must be at least 18 years old and legally capable of entering into binding contracts to use this Platform. By using the Platform, you represent and warrant that you meet these requirements.

## 3. Account Registration

To access certain features, you must register an account. You agree to:
- Provide accurate and complete information
- Maintain the security of your account credentials
- Accept responsibility for all activities under your account
- Notify us immediately of any unauthorized access

## 4. Trading Services

The Platform provides simulated trading services for educational and evaluation purposes. All trades are executed with virtual funds unless explicitly stated otherwise.

## 5. Prohibited Activities

You agree not to:
- Violate any applicable laws or regulations
- Manipulate or abuse the trading system
- Use automated systems without authorization
- Impersonate others or misrepresent your identity

## 6. Intellectual Property

All content, trademarks, and intellectual property on the Platform are owned by TradeQuip or its licensors.

## 7. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, TRADEQUIP SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES.

## 8. Governing Law

These Terms shall be governed by and construed in accordance with the laws of [Jurisdiction].

## 9. Changes to Terms

We reserve the right to modify these Terms at any time. Continued use of the Platform after changes constitutes acceptance.

## 10. Contact

For questions about these Terms, contact us at legal@tradequip.com.
    `.trim(),
  };
}
