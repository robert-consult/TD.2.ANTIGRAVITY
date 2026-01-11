/**
 * Seed Legal Documents: Country and Region Addenda
 * Based on the MAIN-1 Option A pack
 */
const Database = require('better-sqlite3');
const crypto = require('crypto');

const db = new Database('./trading_app.db');

function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

// Country addenda definitions
const COUNTRY_ADDENDA = [
  { key: 'US', name: 'United States', content: `COUNTRY ADDENDUM — UNITED STATES (ADD-US)
Version: 1.0
Applies if you select: United States (US)

1) GOVERNING LAW / FORUM
1.1 Governing law is the law of the U.S. state of your primary residence as selected/recorded at signup, unless the Platform specifies a different state and such choice is enforceable.
1.2 Venue is the competent state or federal courts for your state of residence unless mandatory rules require otherwise.

2) STATE-LAW DEPENDENT RESTRICTION RULE
2.1 If any part of the Global Master is deemed a "non-compete" or otherwise prohibited by your state (including, for example, states that broadly prohibit non-competes), then:
(a) the Agreement will NOT be interpreted to prohibit you from lawful employment generally; and
(b) Opportunity Rights apply only to Platform-Linked Opportunities and TradeQuip-introduced counterparties, and operate as notice + anti-circumvention + confidentiality + non-solicitation to the maximum lawful extent.

2.2 Any standstill is limited to preventing "start-now-paper-later" circumvention for Platform-Linked Opportunities and does not bar independent employment where such restrictions are unlawful.

3) FEES / LIQUIDATED DAMAGES CONSTRUCTION
3.1 The fees in Section 11 are intended as reasonable liquidated damages for circumvention of Platform-Linked Opportunities.
3.2 If a court requires reduction, amounts reduce to the maximum enforceable level without invalidating the remainder.

4) PRIVACY
4.1 TradeQuip processes personal data as described in the Global Master. State privacy laws may apply depending on your location and TradeQuip's processing footprint.

END OF ADD-US` },
  { key: 'AE', name: 'United Arab Emirates', content: `COUNTRY ADDENDUM — UNITED ARAB EMIRATES (ADD-AE)
Version: 1.0
Applies if you select: United Arab Emirates (AE)

1) GOVERNING LAW / FORUM
1.1 Governing law is UAE federal law.
1.2 Venue is the competent UAE courts, unless a specific TradeQuip contracting entity and dispute type requires DIFC/ADGM jurisdiction and such selection is enforceable.

2) ENFORCEABILITY CONSTRUCTION
2.1 Any clause construed as a restraint of trade must be limited to protect legitimate interests and is automatically reduced in time/scope/activity to the maximum enforceable extent.
2.2 The Agreement is primarily intended as notice + ROFR/ROFO + anti-circumvention and not as a blanket employment prohibition.

3) PRIVACY (UAE PDPL)
3.1 Where applicable, TradeQuip will implement UAE Personal Data Protection Law (PDPL) compliant safeguards, including cross-border transfer safeguards as required.

END OF ADD-AE` },
  { key: 'IN', name: 'India', content: `COUNTRY ADDENDUM — INDIA (ADD-IN)
Version: 1.0
Applies if you select: India (IN)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of India.
1.2 Venue is the competent courts in your state of residence in India.

2) RESTRAINT-OF-TRADE ADAPTATION (SECTION 27 PRINCIPLE)
2.1 To the maximum extent permitted, the Agreement will not be interpreted as a post-termination restraint preventing you from earning a livelihood.
2.2 Any portion that could be construed as an unenforceable non-compete automatically converts to:
(a) confidentiality and trade secret protection,
(b) non-circumvention of Platform-Linked Opportunities and introductions,
(c) notice + ROFR/ROFO for Platform-Linked Opportunities only, and
(d) lawful damages/remedies for circumvention.

3) FEES
3.1 Fees are intended as compensation for circumvention of Platform-Linked Opportunities and introductions.
3.2 If a court requires reduction, amounts reduce to the maximum enforceable level.

4) PRIVACY (DPDP ACT)
4.1 TradeQuip will provide notice and implement safeguards consistent with India's Digital Personal Data Protection Act for covered processing.

END OF ADD-IN` },
  { key: 'KE', name: 'Kenya', content: `COUNTRY ADDENDUM — KENYA (ADD-KE)
Version: 1.0
Applies if you select: Kenya (KE)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Kenya.
1.2 Venue is the competent courts of Kenya.

2) ENFORCEABILITY CONSTRUCTION
2.1 Any overbroad restriction automatically reduces to the minimum necessary to protect legitimate interests and remain enforceable.
2.2 Opportunity Rights are primarily notice + ROFR/ROFO + anti-circumvention for Platform-Linked Opportunities.

3) PRIVACY (KENYA DATA PROTECTION ACT)
3.1 TradeQuip will implement safeguards consistent with Kenya's Data Protection Act for covered processing and transfers.

END OF ADD-KE` },
  { key: 'NG', name: 'Nigeria', content: `COUNTRY ADDENDUM — NIGERIA (ADD-NG)
Version: 1.0
Applies if you select: Nigeria (NG)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Nigeria.
1.2 Venue is the competent courts of Nigeria.

2) ENFORCEABILITY CONSTRUCTION
2.1 Any restraint-like clause is interpreted as notice + anti-circumvention + protection of legitimate interests and reduced to the maximum enforceable scope.

3) PRIVACY (NIGERIA DATA PROTECTION ACT)
3.1 TradeQuip will implement safeguards consistent with Nigeria's Data Protection Act for covered processing and transfers.

END OF ADD-NG` },
  { key: 'BD', name: 'Bangladesh', content: `COUNTRY ADDENDUM — BANGLADESH (ADD-BD)
Version: 1.0
Applies if you select: Bangladesh (BD)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Bangladesh.
1.2 Venue is the competent courts of Bangladesh.

2) ENFORCEABILITY CONSTRUCTION
2.1 Opportunity Rights are construed primarily as notice + anti-circumvention for Platform-Linked Opportunities and reduced to the maximum enforceable scope.

3) PRIVACY
3.1 TradeQuip applies the Global Master privacy baseline and implements additional local safeguards as required by applicable law.

END OF ADD-BD` },
  { key: 'TH', name: 'Thailand', content: `COUNTRY ADDENDUM — THAILAND (ADD-TH)
Version: 1.0
Applies if you select: Thailand (TH)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Thailand.
1.2 Venue is the competent courts of Thailand.

2) ENFORCEABILITY CONSTRUCTION
2.1 Any restraint-like clause reduces to what is reasonable and necessary to protect legitimate interests and is enforced primarily as notice + anti-circumvention for Platform-Linked Opportunities.

3) PRIVACY
3.1 TradeQuip implements safeguards consistent with Thailand's PDPA for covered processing and transfers where applicable.

END OF ADD-TH` },
  { key: 'PH', name: 'Philippines', content: `COUNTRY ADDENDUM — PHILIPPINES (ADD-PH)
Version: 1.0
Applies if you select: Philippines (PH)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of the Philippines.
1.2 Venue is the competent courts of the Philippines.

2) ENFORCEABILITY CONSTRUCTION
2.1 Opportunity Rights are enforced to the maximum extent permitted and construed primarily as notice + anti-circumvention for Platform-Linked Opportunities.

3) PRIVACY
3.1 TradeQuip implements safeguards consistent with the Philippines Data Privacy Act and applicable guidance for transfers where required.

END OF ADD-PH` },
  { key: 'SG', name: 'Singapore', content: `COUNTRY ADDENDUM — SINGAPORE (ADD-SG)
Version: 1.0
Applies if you select: Singapore (SG)

1) GOVERNING LAW / FORUM
1.1 Governing law is Singapore law.
1.2 Venue is the courts of Singapore.

2) RESTRAINT-OF-TRADE TEST (LEGITIMATE INTEREST / REASONABLENESS)
2.1 Any restraint-like provision is enforceable only to the extent it protects legitimate proprietary interests and is reasonable in scope and duration.
2.2 Accordingly, any restriction reduces automatically to the minimum enforceable scope and is construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY
3.1 TradeQuip implements safeguards consistent with Singapore's PDPA for covered processing and transfers.

END OF ADD-SG` },
  { key: 'HK', name: 'Hong Kong', content: `COUNTRY ADDENDUM — HONG KONG (ADD-HK)
Version: 1.0
Applies if you select: Hong Kong (HK)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Hong Kong.
1.2 Venue is the courts of Hong Kong.

2) ENFORCEABILITY CONSTRUCTION
2.1 Any restraint-like clause reduces to the minimum necessary to protect legitimate interests and is enforced primarily as notice + anti-circumvention for Platform-Linked Opportunities and introductions.

3) PRIVACY
3.1 TradeQuip implements safeguards consistent with Hong Kong's PDPO for covered processing.

END OF ADD-HK` },
  { key: 'CN', name: 'China', content: `COUNTRY ADDENDUM — CHINA (MAINLAND) (ADD-CN)
Version: 1.0
Applies if you select: China (CN)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of the People's Republic of China.
1.2 Venue is the competent PRC courts or PRC arbitration as mandated by applicable law.

2) PRC COMPLIANCE AND FEATURE LIMITATION
2.1 TradeQuip may limit, localize, or require additional PRC-specific terms/consents for certain Platform features, data flows, or integrations to maintain compliance.
2.2 If additional PRC terms are required, TradeQuip will present them in-app and they will form part of this Agreement.

3) ENFORCEABILITY CONSTRUCTION
3.1 Opportunity Rights are enforced to the maximum extent permitted and construed primarily as notice + anti-circumvention for Platform-Linked Opportunities and introductions, plus confidentiality.

4) PRIVACY
4.1 TradeQuip will implement PRC-compliant safeguards for covered processing and cross-border transfers, including localization where required.

END OF ADD-CN` },
  { key: 'BR', name: 'Brazil', content: `COUNTRY ADDENDUM — BRAZIL (ADD-BR)
Version: 1.0
Applies if you select: Brazil (BR)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Brazil.
1.2 Venue is the competent courts of Brazil.

2) ENFORCEABILITY CONSTRUCTION
2.1 Any restriction reduces automatically to the minimum necessary to protect legitimate interests and remain enforceable.
2.2 Opportunity Rights are construed primarily as notice + anti-circumvention for Platform-Linked Opportunities and introductions.

3) PRIVACY (LGPD)
3.1 TradeQuip implements safeguards consistent with Brazil's LGPD for covered processing and transfers.

END OF ADD-BR` },
  { key: 'AR', name: 'Argentina', content: `COUNTRY ADDENDUM — ARGENTINA (ADD-AR)
Version: 1.0
Applies if you select: Argentina (AR)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Argentina.
1.2 Venue is the competent courts of Argentina.

2) ENFORCEABILITY CONSTRUCTION
2.1 Opportunity Rights are enforced to the maximum extent permitted and construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY
3.1 TradeQuip applies the Global Master privacy baseline and implements additional local safeguards as required.

END OF ADD-AR` },
  { key: 'CO', name: 'Colombia', content: `COUNTRY ADDENDUM — COLOMBIA (ADD-CO)
Version: 1.0
Applies if you select: Colombia (CO)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Colombia.
1.2 Venue is the competent courts of Colombia.

2) ENFORCEABILITY CONSTRUCTION
2.1 Opportunity Rights are enforced to the maximum extent permitted and construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY
3.1 TradeQuip applies the Global Master privacy baseline and implements additional local safeguards as required.

END OF ADD-CO` },
  { key: 'MX', name: 'Mexico', content: `COUNTRY ADDENDUM — MEXICO (ADD-MX)
Version: 1.0
Applies if you select: Mexico (MX)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Mexico.
1.2 Venue is the competent courts of Mexico.

2) ENFORCEABILITY CONSTRUCTION
2.1 Opportunity Rights are enforced to the maximum extent permitted and construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY
3.1 TradeQuip implements safeguards consistent with Mexico's applicable personal data law framework for covered processing and transfers.

END OF ADD-MX` },
  { key: 'ET', name: 'Ethiopia', content: `COUNTRY ADDENDUM — ETHIOPIA (ADD-ET)
Version: 1.0
Applies if you select: Ethiopia (ET)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Ethiopia.
1.2 Venue is the competent courts of Ethiopia.

2) ENFORCEABILITY CONSTRUCTION
2.1 Opportunity Rights are enforced to the maximum extent permitted and construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY
3.1 TradeQuip implements safeguards consistent with Ethiopia's applicable personal data protection framework for covered processing and transfers where required.

END OF ADD-ET` },
  { key: 'GH', name: 'Ghana', content: `COUNTRY ADDENDUM — GHANA (ADD-GH)
Version: 1.0
Applies if you select: Ghana (GH)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Ghana.
1.2 Venue is the competent courts of Ghana.

2) ENFORCEABILITY CONSTRUCTION
2.1 Opportunity Rights are enforced to the maximum extent permitted and construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY
3.1 TradeQuip implements safeguards consistent with Ghana's applicable personal data protection framework.

END OF ADD-GH` },
  { key: 'AO', name: 'Angola', content: `COUNTRY ADDENDUM — ANGOLA (ADD-AO)
Version: 1.0
Applies if you select: Angola (AO)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Angola.
1.2 Venue is the competent courts of Angola.

2) ENFORCEABILITY CONSTRUCTION
2.1 Opportunity Rights are enforced to the maximum extent permitted and construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY
3.1 TradeQuip implements safeguards consistent with Angola's applicable personal data protection framework where required.

END OF ADD-AO` },
  { key: 'ZA', name: 'South Africa', content: `COUNTRY ADDENDUM — SOUTH AFRICA (ADD-ZA)
Version: 1.0
Applies if you select: South Africa (ZA)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of South Africa.
1.2 Venue is the competent courts of South Africa.

2) ENFORCEABILITY CONSTRUCTION
2.1 Any restraint-like clause reduces to the minimum necessary to protect legitimate interests and remain enforceable.
2.2 Opportunity Rights are construed primarily as notice + anti-circumvention for Platform-Linked Opportunities and introductions, plus confidentiality.

3) PRIVACY (POPIA)
3.1 TradeQuip implements safeguards consistent with POPIA for covered processing and transfers.

END OF ADD-ZA` },
  { key: 'UG', name: 'Uganda', content: `COUNTRY ADDENDUM — UGANDA (ADD-UG)
Version: 1.0
Applies if you select: Uganda (UG)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Uganda.
1.2 Venue is the competent courts of Uganda.

2) ENFORCEABILITY CONSTRUCTION
2.1 Opportunity Rights are enforced to the maximum extent permitted and construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY
3.1 TradeQuip implements safeguards consistent with Uganda's applicable data protection framework where required.

END OF ADD-UG` },
  { key: 'TZ', name: 'Tanzania', content: `COUNTRY ADDENDUM — TANZANIA (ADD-TZ)
Version: 1.0
Applies if you select: Tanzania (TZ)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Tanzania.
1.2 Venue is the competent courts of Tanzania.

2) ENFORCEABILITY CONSTRUCTION
2.1 Opportunity Rights are enforced to the maximum extent permitted and construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY
3.1 TradeQuip implements safeguards consistent with Tanzania's applicable data protection framework where required.

END OF ADD-TZ` },
  { key: 'RU', name: 'Russia', content: `COUNTRY ADDENDUM — RUSSIA (ADD-RU)
Version: 1.0
Applies if you select: Russia (RU)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of the Russian Federation.
1.2 Venue is the competent courts of the Russian Federation.

2) DATA LOCALIZATION / FEATURE LIMITATION
2.1 TradeQuip may implement local storage/processing requirements and/or limit Platform features for Russian residents until compliant with applicable localization rules.

3) ENFORCEABILITY CONSTRUCTION
3.1 Opportunity Rights are enforced to the maximum extent permitted and construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

END OF ADD-RU` },
  { key: 'UA', name: 'Ukraine', content: `COUNTRY ADDENDUM — UKRAINE (ADD-UA)
Version: 1.0
Applies if you select: Ukraine (UA)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Ukraine.
1.2 Venue is the competent courts of Ukraine.

2) ENFORCEABILITY CONSTRUCTION
2.1 Opportunity Rights are enforced to the maximum extent permitted and construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY
3.1 TradeQuip implements the Global Master privacy baseline and additional safeguards as required by applicable law.

END OF ADD-UA` },
  { key: 'GB', name: 'United Kingdom', content: `COUNTRY ADDENDUM — UNITED KINGDOM (ADD-UK)
Version: 1.0
Applies if you select: United Kingdom (GB)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of England and Wales, unless mandatory local rules apply.
1.2 Venue is the courts of England and Wales, unless mandatory rules require otherwise.

2) ENFORCEABILITY CONSTRUCTION
2.1 Any restraint-like clause reduces to the minimum necessary to protect legitimate interests and remain enforceable, and is construed primarily as notice + anti-circumvention for Platform-Linked Opportunities.

3) PRIVACY (UK GDPR)
3.1 TradeQuip will implement UK GDPR-aligned safeguards for covered processing and restricted transfers.

END OF ADD-UK` },
  { key: 'JP', name: 'Japan', content: `COUNTRY ADDENDUM — JAPAN (ADD-JP)
Version: 1.0
Applies if you select: Japan (JP)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Japan.
1.2 Venue is the competent courts of Japan.

2) ENFORCEABILITY CONSTRUCTION
2.1 Restrictions limited to legitimate interests; construed primarily as notice + anti-circumvention for Platform-Linked Opportunities; confidentiality.

3) PRIVACY
3.1 TradeQuip implements safeguards consistent with Japan's APPI for covered processing.

END OF ADD-JP` },
  { key: 'KR', name: 'South Korea', content: `COUNTRY ADDENDUM — SOUTH KOREA (ADD-KR)
Version: 1.0
Applies if you select: South Korea (KR)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of South Korea.
1.2 Venue is the competent courts of South Korea.

2) ENFORCEABILITY CONSTRUCTION
2.1 Opportunity Rights are enforced to the maximum extent permitted and construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY (PIPA)
3.1 TradeQuip implements safeguards consistent with Korea's PIPA for covered processing and transfers.

END OF ADD-KR` },
  { key: 'PK', name: 'Pakistan', content: `COUNTRY ADDENDUM — PAKISTAN (ADD-PK)
Version: 1.0
Applies if you select: Pakistan (PK)

1) GOVERNING LAW / FORUM
1.1 Governing law is the laws of Pakistan.
1.2 Venue is the competent courts of Pakistan.

2) ENFORCEABILITY CONSTRUCTION
2.1 Opportunity Rights are enforced to the maximum extent permitted and construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY
3.1 TradeQuip implements the Global Master privacy baseline and additional safeguards as required.

END OF ADD-PK` }
];

// Region addenda definitions
const REGION_ADDENDA = [
  { key: 'WEST_EUROPE', name: 'West Europe', content: `REGION ADDENDUM — WEST EUROPE (ADD-WEST_EUROPE)
Version: 1.0
Applies if your selected country is classified by the Platform as West Europe and no dedicated country Addendum is available.

1) GOVERNING LAW / FORUM
1.1 Governing law is the law of your country of habitual residence.
1.2 Venue is the competent courts of your country of habitual residence, subject to mandatory rules.

2) ENFORCEABILITY (PROPORTIONALITY / LEGITIMATE INTEREST)
2.1 Any restraint-like clause reduces to the minimum necessary to protect legitimate interests and remain enforceable.
2.2 Opportunity Rights are construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY (GDPR WHERE APPLICABLE)
3.1 Where GDPR applies, TradeQuip will implement GDPR-aligned lawful bases, transparency, security safeguards, and cross-border transfer safeguards as required.

END OF ADD-WEST_EUROPE` },
  { key: 'EAST_EUROPE', name: 'East Europe', content: `REGION ADDENDUM — EAST EUROPE (ADD-EAST_EUROPE)
Version: 1.0
Applies if your selected country is classified by the Platform as East Europe and no dedicated country Addendum is available.

1) GOVERNING LAW / FORUM
1.1 Governing law is the law of your country of habitual residence.
1.2 Venue is the competent courts of your country of habitual residence.

2) ENFORCEABILITY
2.1 Restrictions reduce to the maximum enforceable scope and are construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY
3.1 TradeQuip implements safeguards as required by applicable local law and GDPR where applicable.

END OF ADD-EAST_EUROPE` },
  { key: 'SE_ASIA', name: 'Southeast Asia', content: `REGION ADDENDUM — SOUTHEAST ASIA (ADD-SE_ASIA)
Version: 1.0
Applies if your selected country is classified as SE Asia (excluding dedicated addenda) and no dedicated country Addendum is available.

1) GOVERNING LAW / FORUM
Law and venue: your country of habitual residence.

2) ENFORCEABILITY
Opportunity Rights reduce to maximum enforceable scope and are construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY
TradeQuip implements local data protection safeguards and cross-border transfer safeguards as required.

END OF ADD-SE_ASIA` },
  { key: 'MIDDLE_EAST', name: 'Middle East', content: `REGION ADDENDUM — MIDDLE EAST (ADD-MIDDLE_EAST)
Version: 1.0
Applies if your selected country is classified as Middle East (excluding UAE) and no dedicated country Addendum is available.

1) GOVERNING LAW / FORUM
Law and venue: your country of habitual residence.

2) ENFORCEABILITY
Restrictions reduce to maximum enforceable scope and are construed primarily as notice + anti-circumvention for Platform-Linked Opportunities, plus confidentiality.

3) PRIVACY
TradeQuip implements local data protection safeguards and cross-border transfer safeguards as required.

END OF ADD-MIDDLE_EAST` },
  { key: 'WEST_AFRICA', name: 'West Africa', content: `REGION ADDENDUM — WEST AFRICA (ADD-WEST_AFRICA)
Version: 1.0
Applies if your selected country is classified as West Africa (excluding Nigeria) and no dedicated country Addendum is available.

Law/venue: your country of habitual residence.
Enforceability: maximum enforceable scope; construed as notice + anti-circumvention for Platform-Linked Opportunities; confidentiality.
Privacy: local data protection safeguards as required.

END OF ADD-WEST_AFRICA` },
  { key: 'EAST_AFRICA', name: 'East Africa', content: `REGION ADDENDUM — EAST AFRICA (ADD-EAST_AFRICA)
Version: 1.0
Applies if your selected country is classified as East Africa (excluding Kenya/Uganda/Tanzania/Ethiopia if dedicated) and no dedicated country Addendum is available.

Law/venue: your country of habitual residence.
Enforceability: maximum enforceable scope; construed as notice + anti-circumvention for Platform-Linked Opportunities; confidentiality.
Privacy: local data protection safeguards as required.

END OF ADD-EAST_AFRICA` },
  { key: 'SOUTHERN_AFRICA', name: 'Southern Africa', content: `REGION ADDENDUM — SOUTHERN AFRICA (ADD-SOUTHERN_AFRICA)
Version: 1.0
Applies if your selected country is classified as Southern Africa (excluding South Africa) and no dedicated country Addendum is available.

Law/venue: your country of habitual residence.
Enforceability: maximum enforceable scope; construed as notice + anti-circumvention for Platform-Linked Opportunities; confidentiality.
Privacy: local data protection safeguards as required.

END OF ADD-SOUTHERN_AFRICA` },
  { key: 'CENTRAL_AFRICA', name: 'Central Africa', content: `REGION ADDENDUM — CENTRAL AFRICA (ADD-CENTRAL_AFRICA)
Version: 1.0
Applies if your selected country is classified as Central Africa and no dedicated country Addendum is available.

Law/venue: your country of habitual residence.
Enforceability: maximum enforceable scope; construed as notice + anti-circumvention for Platform-Linked Opportunities; confidentiality.
Privacy: local data protection safeguards as required.

END OF ADD-CENTRAL_AFRICA` },
  { key: 'NORTH_AFRICA', name: 'North Africa', content: `REGION ADDENDUM — NORTH AFRICA (ADD-NORTH_AFRICA)
Version: 1.0
Applies if your selected country is classified as North Africa and no dedicated country Addendum is available.

Law/venue: your country of habitual residence.
Enforceability: maximum enforceable scope; construed as notice + anti-circumvention for Platform-Linked Opportunities; confidentiality.
Privacy: local data protection safeguards as required.

END OF ADD-NORTH_AFRICA` },
  { key: 'SOUTH_AMERICA', name: 'South America', content: `REGION ADDENDUM — SOUTH AMERICA (ADD-SOUTH_AMERICA)
Version: 1.0
Applies if your selected country is classified as South America (excluding dedicated addenda) and no dedicated country Addendum is available.

Law/venue: your country of habitual residence.
Enforceability: maximum enforceable scope; construed as notice + anti-circumvention for Platform-Linked Opportunities; confidentiality.
Privacy: local data protection safeguards as required.

END OF ADD-SOUTH_AMERICA` },
  { key: 'NORTH_AMERICA', name: 'North America', content: `REGION ADDENDUM — NORTH AMERICA (ADD-NORTH_AMERICA)
Version: 1.0
Applies if your selected country is classified as North America (excluding US) and no dedicated country Addendum is available.

Law/venue: your country of habitual residence.
Enforceability: maximum enforceable scope; construed as notice + anti-circumvention for Platform-Linked Opportunities; confidentiality.
Privacy: local privacy safeguards as required.

END OF ADD-NORTH_AMERICA` },
  { key: 'CENTRAL_AMERICA', name: 'Central America', content: `REGION ADDENDUM — CENTRAL AMERICA (ADD-CENTRAL_AMERICA)
Version: 1.0
Applies if your selected country is classified as Central America and no dedicated country Addendum is available.

Law/venue: your country of habitual residence.
Enforceability: maximum enforceable scope; construed as notice + anti-circumvention for Platform-Linked Opportunities; confidentiality.
Privacy: local privacy safeguards as required.

END OF ADD-CENTRAL_AMERICA` },
  { key: 'CENTRAL_ASIA', name: 'Central Asia', content: `REGION ADDENDUM — CENTRAL ASIA (ADD-CENTRAL_ASIA)
Version: 1.0
Applies if your selected country is classified as Central Asia and no dedicated country Addendum is available.

Law/venue: your country of habitual residence.
Enforceability: maximum enforceable scope; construed as notice + anti-circumvention for Platform-Linked Opportunities; confidentiality.
Privacy: local privacy and potential localization safeguards as required; TradeQuip may limit features pending compliance.

END OF ADD-CENTRAL_ASIA` },
  { key: 'AUSTRALASIA', name: 'Australasia', content: `REGION ADDENDUM — AUSTRALASIA (ADD-AUSTRALASIA)
Version: 1.0
Applies if your selected country is classified as Australasia and no dedicated country Addendum is available.

Law/venue: your country of habitual residence.
Enforceability: maximum enforceable scope; construed as notice + anti-circumvention for Platform-Linked Opportunities; confidentiality.
Privacy: local privacy safeguards as required.

END OF ADD-AUSTRALASIA` },
  { key: 'PACIFIC_ISLANDS', name: 'Pacific Islands', content: `REGION ADDENDUM — PACIFIC ISLANDS (ADD-PACIFIC_ISLANDS)
Version: 1.0
Applies if your selected country is classified as Pacific Islands and no dedicated country Addendum is available.

Law/venue: your country of habitual residence.
Enforceability: maximum enforceable scope; construed as notice + anti-circumvention for Platform-Linked Opportunities; confidentiality.
Privacy: local privacy safeguards as required.

END OF ADD-PACIFIC_ISLANDS` },
  { key: 'INDIAN_OCEAN_ISLANDS', name: 'Indian Ocean Islands', content: `REGION ADDENDUM — INDIAN OCEAN ISLANDS (ADD-INDIAN_OCEAN_ISLANDS)
Version: 1.0
Applies if your selected country is classified as Indian Ocean Islands and no dedicated country Addendum is available.

Law/venue: your country of habitual residence.
Enforceability: maximum enforceable scope; construed as notice + anti-circumvention for Platform-Linked Opportunities; confidentiality.
Privacy: local privacy safeguards as required.

END OF ADD-INDIAN_OCEAN_ISLANDS` },
  { key: 'ROW', name: 'Rest of World', content: `REGION ADDENDUM — REST OF WORLD (ADD-ROW)
Version: 1.0
Applies if no dedicated Country or Region Addendum is available for your jurisdiction.

Law/venue: your country of habitual residence, or if unenforceable, the laws of [TradeQuip's principal jurisdiction].
Enforceability: maximum enforceable scope; construed as notice + anti-circumvention for Platform-Linked Opportunities; confidentiality.
Privacy: local privacy safeguards as required.

END OF ADD-ROW` }
];

// Insert document into legal_documents
const insertDoc = db.prepare(`
  INSERT INTO legal_documents (doc_set, doc_type, jurisdiction_type, jurisdiction_key, version, sha256, content, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

// Check if document exists
const checkDoc = db.prepare(`
  SELECT id FROM legal_documents 
  WHERE doc_set = ? AND doc_type = ? AND jurisdiction_type = ? AND jurisdiction_key = ?
  LIMIT 1
`);

// Insert pointer
const insertPointer = db.prepare(`
  INSERT INTO legal_doc_pointers (doc_set, doc_type, jurisdiction_type, jurisdiction_key, active_document_id)
  VALUES (?, ?, ?, ?, ?)
`);

// Check if pointer exists
const checkPointer = db.prepare(`
  SELECT id FROM legal_doc_pointers 
  WHERE doc_set = ? AND doc_type = ? AND jurisdiction_type = ? AND jurisdiction_key = ?
  LIMIT 1
`);

let countryAdded = 0;
let regionAdded = 0;
let skipped = 0;

// Insert country addenda
for (const addendum of COUNTRY_ADDENDA) {
  const existing = checkDoc.get('DOC1', 'ADDENDUM', 'COUNTRY', addendum.key);
  if (existing) {
    skipped++;
    continue;
  }
  
  const hash = sha256(addendum.content);
  const result = insertDoc.run('DOC1', 'ADDENDUM', 'COUNTRY', addendum.key, '1.0.0', hash, addendum.content, `SEED: ${addendum.name} country addendum`);
  const docId = Number(result.lastInsertRowid);
  
  // Create pointer if not exists
  const existingPointer = checkPointer.get('DOC1', 'ADDENDUM', 'COUNTRY', addendum.key);
  if (!existingPointer) {
    insertPointer.run('DOC1', 'ADDENDUM', 'COUNTRY', addendum.key, docId);
  }
  
  countryAdded++;
  console.log(`Added country addendum: ${addendum.key} (${addendum.name})`);
}

// Insert region addenda
for (const addendum of REGION_ADDENDA) {
  const existing = checkDoc.get('DOC1', 'ADDENDUM', 'REGION', addendum.key);
  if (existing) {
    skipped++;
    continue;
  }
  
  const hash = sha256(addendum.content);
  const result = insertDoc.run('DOC1', 'ADDENDUM', 'REGION', addendum.key, '1.0.0', hash, addendum.content, `SEED: ${addendum.name} region addendum`);
  const docId = Number(result.lastInsertRowid);
  
  // Create pointer if not exists
  const existingPointer = checkPointer.get('DOC1', 'ADDENDUM', 'REGION', addendum.key);
  if (!existingPointer) {
    insertPointer.run('DOC1', 'ADDENDUM', 'REGION', addendum.key, docId);
  }
  
  regionAdded++;
  console.log(`Added region addendum: ${addendum.key} (${addendum.name})`);
}

console.log('\n=== Summary ===');
console.log(`Country addenda added: ${countryAdded}`);
console.log(`Region addenda added: ${regionAdded}`);
console.log(`Skipped (already exist): ${skipped}`);

db.close();
console.log('\nLegal addenda seeding complete!');
