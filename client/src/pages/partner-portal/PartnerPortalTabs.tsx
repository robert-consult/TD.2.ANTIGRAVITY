import type { Dispatch, RefObject, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PARTNER_ADDRESS_KIND_OPTIONS,
  PARTNER_CONTACT_CHANNEL_OPTIONS,
  PARTNER_EMPLOYEE_COUNT_RANGE_OPTIONS,
  PARTNER_ENTITY_TYPE_OPTIONS,
  type PartnerInstitutionProfile,
} from "@shared/partnerProfile";
import {
  Beaker,
  Building2,
  FileCheck2,
  FolderKanban,
  Globe2,
  Landmark,
  MapPinned,
  MessageSquareLock,
  Scale,
  ShieldCheck,
  TrendingUp,
  WalletCards,
} from "lucide-react";

type MutationLike = {
  isPending?: boolean;
  mutate: (value?: any) => void;
};

type Props = {
  onboardingBlockedReason: string | null;
  openTraderAccessTab: (miniTab?: "data-room" | "simulations" | "allocations" | "comms") => void;
  onboardingPanelTab: "identity" | "legal" | "trader-access";
  setOnboardingPanelTab: (value: "identity" | "legal" | "trader-access") => void;
  profileSectionRef: RefObject<HTMLDivElement | null>;
  legalSectionRef: RefObject<HTMLDivElement | null>;
  profileDraft: any;
  setProfileDraft: Dispatch<SetStateAction<any>>;
  institutionDraft: PartnerInstitutionProfile;
  setInstitutionField: (field: keyof PartnerInstitutionProfile, value: any) => void;
  setInstitutionDraft: Dispatch<SetStateAction<PartnerInstitutionProfile>>;
  countryRows: Array<{ code: string; name: string }>;
  addInstitutionStringListItem: (field: "registrationCountriesIso2" | "generalEmails" | "socialProfiles") => void;
  updateInstitutionStringList: (field: "registrationCountriesIso2" | "generalEmails" | "socialProfiles", index: number, value: string) => void;
  removeInstitutionStringListItem: (field: "registrationCountriesIso2" | "generalEmails" | "socialProfiles", index: number) => void;
  normalizeIso2Input: (value: string) => string;
  addAddressEntry: (countryIso2?: string) => void;
  updateAddressEntry: (index: number, patch: any) => void;
  removeAddressEntry: (index: number) => void;
  addPhoneEntry: (field: "phoneNumbers" | "faxNumbers", countryIso2?: string) => void;
  updatePhoneEntry: (field: "phoneNumbers" | "faxNumbers", index: number, patch: any) => void;
  removePhoneEntry: (field: "phoneNumbers" | "faxNumbers", index: number) => void;
  addPointOfContact: (countryIso2?: string) => void;
  updatePointOfContact: (index: number, patch: any) => void;
  updatePointOfContactPhone: (index: number, field: "phone" | "fax", patch: any) => void;
  removePointOfContact: (index: number) => void;
  addRegulatoryStringListItem: (field: "regulatorNames" | "cikNumbers", initialValue?: string) => void;
  updateRegulatoryStringList: (field: "regulatorNames" | "cikNumbers", index: number, value: string) => void;
  removeRegulatoryStringListItem: (field: "regulatorNames" | "cikNumbers", index: number) => void;
  legalDraft: any;
  setLegalDraft: Dispatch<SetStateAction<any>>;
  keyReady: boolean;
  showOnboardingProfileTabs: boolean;
  saveIdentityDisabled: boolean;
  saveIdentityDisabledReason: string | null;
  submitOnboardingProfile: MutationLike;
  requestContactAccess: MutationLike;
  legalSubmitDisabled: boolean;
  legalSubmitDisabledReason: string | null;
  submitOnboardingLegal: MutationLike;
  showTraderAccessMiniTabs: boolean;
  activeTab: string;
  setActiveTab: Dispatch<SetStateAction<string>>;
  gateViewDataRoom: boolean;
  gateRunSimulations: boolean;
  gateRequestAllocation: boolean;
  gateDirectContact: boolean;
  onboardingState: any;
  dataRoomQuery: { data?: { results?: any[] }; isLoading?: boolean };
  selectedHashId: string;
  setSelectedHashId: Dispatch<SetStateAction<string>>;
  tearSheetQuery: { data?: any; isLoading?: boolean };
  fmtUsd: (value: number | null | undefined) => string;
  fmtPct: (value: number | null | undefined) => string;
  simulationDraft: any;
  setSimulationDraft: Dispatch<SetStateAction<any>>;
  previewSimulation: MutationLike;
  simulationPreviewDisabled: boolean;
  simulationPreviewDisabledReason: string | null;
  simulationPreview: any;
  allocationDraft: any;
  setAllocationDraft: Dispatch<SetStateAction<any>>;
  createAllocation: MutationLike;
  createAllocationDisabled: boolean;
  createAllocationDisabledReason: string | null;
  allocationsQuery: { data?: { rows?: any[] }; isLoading?: boolean };
  updateAllocation: MutationLike;
  inquiryInboxAlias: string;
  inquiryRecipientsQuery: { data?: any; isLoading?: boolean };
  inquiryMissingKeyCount: number;
  inquiryDraft: any;
  setInquiryDraft: Dispatch<SetStateAction<any>>;
  createInquiry: MutationLike;
  inquirySendDisabled: boolean;
  inquirySendDisabledReason: string | null;
  inquiriesQuery: { data?: { rows?: any[] }; isLoading?: boolean };
  fmtWhen: (utcSec: number | null | undefined) => string;
  isPendingApproval: boolean;
  LockedActionButton: any;
};

export function PartnerPortalTabs(props: Props) {
  const { onboardingBlockedReason, openTraderAccessTab, onboardingPanelTab, setOnboardingPanelTab, profileSectionRef, legalSectionRef, profileDraft, setProfileDraft, institutionDraft, setInstitutionField, setInstitutionDraft, countryRows, addInstitutionStringListItem, updateInstitutionStringList, removeInstitutionStringListItem, normalizeIso2Input, addAddressEntry, updateAddressEntry, removeAddressEntry, addPhoneEntry, updatePhoneEntry, removePhoneEntry, addPointOfContact, updatePointOfContact, updatePointOfContactPhone, removePointOfContact, addRegulatoryStringListItem, updateRegulatoryStringList, removeRegulatoryStringListItem, legalDraft, setLegalDraft, keyReady, showOnboardingProfileTabs, saveIdentityDisabled, saveIdentityDisabledReason, submitOnboardingProfile, requestContactAccess, legalSubmitDisabled, legalSubmitDisabledReason, submitOnboardingLegal, showTraderAccessMiniTabs, activeTab, setActiveTab, gateViewDataRoom, gateRunSimulations, gateRequestAllocation, gateDirectContact, onboardingState, dataRoomQuery, selectedHashId, setSelectedHashId, tearSheetQuery, fmtUsd, fmtPct, simulationDraft, setSimulationDraft, previewSimulation, simulationPreviewDisabled, simulationPreviewDisabledReason, simulationPreview, allocationDraft, setAllocationDraft, createAllocation, createAllocationDisabled, createAllocationDisabledReason, allocationsQuery, updateAllocation, inquiryInboxAlias, inquiryRecipientsQuery, inquiryMissingKeyCount, inquiryDraft, setInquiryDraft, createInquiry, inquirySendDisabled, inquirySendDisabledReason, inquiriesQuery, fmtWhen, isPendingApproval, LockedActionButton } = props;
  return (
    <>
      {showOnboardingProfileTabs && (
        <>
            {onboardingBlockedReason ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2">
                <span>Gating: {onboardingBlockedReason}. Complete onboarding steps to unlock restricted actions.</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-300/40"
                  onClick={() => openTraderAccessTab("comms")}
                >
                  Inquire with Admin
                </Button>
              </div>
            ) : null}

            <Tabs
              value={onboardingPanelTab}
              onValueChange={(value) => {
                if (value === "identity" || value === "legal" || value === "trader-access") {
                  setOnboardingPanelTab(value);
                }
              }}
              className="space-y-0"
            >
              <TabsList className="grid grid-cols-3 h-auto w-full border border-neutral-700 bg-neutral-950/90 p-1">
                <TabsTrigger
                  value="identity"
                  className="gap-1.5 py-2 text-xs text-slate-200 data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-100 data-[state=active]:shadow-none sm:text-sm"
                >
                  <Building2 className="h-3.5 w-3.5" />
                  Identity & Institutional Profile
                </TabsTrigger>
                <TabsTrigger
                  value="legal"
                  className="gap-1.5 py-2 text-xs text-slate-200 data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-100 data-[state=active]:shadow-none sm:text-sm"
                >
                  <Scale className="h-3.5 w-3.5" />
                  Legal & Approval
                </TabsTrigger>
                <TabsTrigger
                  value="trader-access"
                  className="gap-1.5 py-2 text-xs text-slate-200 data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-100 data-[state=active]:shadow-none sm:text-sm"
                >
                  <FolderKanban className="h-3.5 w-3.5" />
                  Trader Access
                </TabsTrigger>
              </TabsList>

              <TabsContent value="identity" className="mt-3">
                <div
                  ref={profileSectionRef}
                  className="max-h-[72vh] space-y-4 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-950/60 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-blue-200">
                        Identity & Institutional Profile
                      </div>
                      <div className="text-[11px] text-neutral-400">
                        Complete all profile zones for legal, access, and allocation gating.
                      </div>
                    </div>
                  </div>

                  <section className="relative overflow-hidden rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 pl-5">
                    <div className="absolute bottom-0 left-0 top-0 w-1 bg-blue-500" />
                    <div className="mb-3 flex items-center gap-2">
                      <div className="rounded border border-blue-400/30 bg-blue-500/10 p-1 text-blue-200">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-blue-100">Core Identity</div>
                        <div className="text-[11px] text-blue-200/80">Who the institution is.</div>
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Input
                        placeholder="Fund name"
                        value={profileDraft.fundName}
                        onChange={(e) => setProfileDraft((prev: any) => ({ ...prev, fundName: e.target.value }))}
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <Input
                        placeholder="Fund logo URL (optional)"
                        value={profileDraft.fundLogoUrl}
                        onChange={(e) => setProfileDraft((prev: any) => ({ ...prev, fundLogoUrl: e.target.value }))}
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <Input
                        placeholder="Legal entity name"
                        value={institutionDraft.legalEntityName || ""}
                        onChange={(e) => setInstitutionField("legalEntityName", e.target.value || null)}
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <Input
                        placeholder="Trading name / DBA"
                        value={institutionDraft.tradingName || ""}
                        onChange={(e) => setInstitutionField("tradingName", e.target.value || null)}
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <select
                        value={institutionDraft.entityType || ""}
                        onChange={(e) => setInstitutionField("entityType", e.target.value || null)}
                        className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                      >
                        <option value="">Entity type</option>
                        {PARTNER_ENTITY_TYPE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  </section>

                  <section className="relative overflow-hidden rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 pl-5">
                    <div className="absolute bottom-0 left-0 top-0 w-1 bg-amber-500" />
                    <div className="mb-3 flex items-center gap-2">
                      <div className="rounded border border-amber-400/30 bg-amber-500/10 p-1 text-amber-200">
                        <TrendingUp className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-amber-100">Operations & Strategy</div>
                        <div className="text-[11px] text-amber-200/80">Mandate, scale, and operating profile.</div>
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Input
                        placeholder="AUM range (e.g. $10M-$50M)"
                        value={profileDraft.aumRange}
                        onChange={(e) => setProfileDraft((prev: any) => ({ ...prev, aumRange: e.target.value }))}
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <Input
                        placeholder="Strategy tags CSV"
                        value={profileDraft.strategyTagsCsv}
                        onChange={(e) => setProfileDraft((prev: any) => ({ ...prev, strategyTagsCsv: e.target.value }))}
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <Input
                        placeholder="Base currency (e.g. USD)"
                        value={institutionDraft.baseCurrency || ""}
                        onChange={(e) => setInstitutionField("baseCurrency", e.target.value.toUpperCase())}
                        className="border-neutral-600 bg-neutral-900"
                        maxLength={3}
                      />
                      <Input
                        placeholder="Primary timezone (IANA)"
                        value={institutionDraft.primaryTimezone || ""}
                        onChange={(e) => setInstitutionField("primaryTimezone", e.target.value || null)}
                        className="border-neutral-600 bg-neutral-900"
                      />
                    </div>
                    <Textarea
                      placeholder="Business description, mandate, and operating scope"
                      value={institutionDraft.businessDescription || ""}
                      onChange={(e) => setInstitutionField("businessDescription", e.target.value || null)}
                      className="mt-2 min-h-[88px] border-neutral-600 bg-neutral-900"
                    />
                    <div className="mt-2 grid gap-2 rounded border border-amber-500/20 bg-neutral-900/70 p-2 md:grid-cols-4">
                      <Input
                        placeholder="Inception year"
                        value={institutionDraft.operations.inceptionYear?.toString() || ""}
                        onChange={(e) =>
                          setInstitutionDraft((prev) => ({
                            ...prev,
                            operations: {
                              ...prev.operations,
                              inceptionYear: e.target.value ? Number(e.target.value) : null,
                            },
                          }))
                        }
                        className="border-neutral-600 bg-neutral-900"
                        inputMode="numeric"
                      />
                      <select
                        value={institutionDraft.operations.employeeCountRange || ""}
                        onChange={(e) =>
                          setInstitutionDraft((prev) => ({
                            ...prev,
                            operations: { ...prev.operations, employeeCountRange: e.target.value || null },
                          }))
                        }
                        className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                      >
                        <option value="">Employee count range</option>
                        {PARTNER_EMPLOYEE_COUNT_RANGE_OPTIONS.map((option) => (
                          <option key={`emp-${option}`} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <Input
                        placeholder="Business days (e.g. Mon-Fri)"
                        value={institutionDraft.operations.businessDays || ""}
                        onChange={(e) =>
                          setInstitutionDraft((prev) => ({
                            ...prev,
                            operations: { ...prev.operations, businessDays: e.target.value || null },
                          }))
                        }
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <Input
                        placeholder="Business hours (e.g. 09:00-17:00 ET)"
                        value={institutionDraft.operations.businessHours || ""}
                        onChange={(e) =>
                          setInstitutionDraft((prev) => ({
                            ...prev,
                            operations: { ...prev.operations, businessHours: e.target.value || null },
                          }))
                        }
                        className="border-neutral-600 bg-neutral-900"
                      />
                    </div>
                  </section>

                  <section className="relative overflow-hidden rounded-lg border border-teal-500/30 bg-teal-500/5 p-3 pl-5">
                    <div className="absolute bottom-0 left-0 top-0 w-1 bg-teal-500" />
                    <div className="mb-3 flex items-center gap-2">
                      <div className="rounded border border-teal-400/30 bg-teal-500/10 p-1 text-teal-200">
                        <MapPinned className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-teal-100">Location & Jurisdiction</div>
                        <div className="text-[11px] text-teal-200/80">Domicile, registration footprint, and addresses.</div>
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-3">
                      <Input
                        placeholder="HQ location"
                        value={profileDraft.hqLocation}
                        onChange={(e) => setProfileDraft((prev: any) => ({ ...prev, hqLocation: e.target.value }))}
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <select
                        value={institutionDraft.domicileCountryIso2 || ""}
                        onChange={(e) => setInstitutionField("domicileCountryIso2", e.target.value || null)}
                        className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                      >
                        <option value="">Domicile country</option>
                        {countryRows.map((row) => (
                          <option key={`dom-${row.code}`} value={row.code}>
                            {row.name} ({row.code})
                          </option>
                        ))}
                      </select>
                      <select
                        value={institutionDraft.incorporationCountryIso2 || ""}
                        onChange={(e) => setInstitutionField("incorporationCountryIso2", e.target.value || null)}
                        className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                      >
                        <option value="">Incorporation country</option>
                        {countryRows.map((row) => (
                          <option key={`inc-${row.code}`} value={row.code}>
                            {row.name} ({row.code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="mt-2 space-y-2 rounded border border-teal-500/20 bg-neutral-900/70 p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-teal-100">Registration countries (ISO2)</div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-teal-400/30 text-teal-100 hover:bg-teal-500/10"
                          onClick={() => addInstitutionStringListItem("registrationCountriesIso2")}
                        >
                          Add Country
                        </Button>
                      </div>
                      {(institutionDraft.registrationCountriesIso2 || []).map((code, index) => (
                        <div key={`reg-country-${index}`} className="flex gap-2">
                          <select
                            value={code || ""}
                            onChange={(e) =>
                              updateInstitutionStringList(
                                "registrationCountriesIso2",
                                index,
                                normalizeIso2Input(e.target.value),
                              )
                            }
                            className="h-10 flex-1 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                          >
                            <option value="">Select country</option>
                            {countryRows.map((row) => (
                              <option key={`reg-iso2-${row.code}`} value={row.code}>
                                {row.name} ({row.code})
                              </option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-neutral-600"
                            onClick={() => removeInstitutionStringListItem("registrationCountriesIso2", index)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                      {(institutionDraft.registrationCountriesIso2 || []).length === 0 && (
                        <div className="text-[11px] text-neutral-400">
                          Add all jurisdictions where this entity is registered.
                        </div>
                      )}
                    </div>

                    <div className="mt-2 space-y-2 rounded border border-teal-500/20 bg-neutral-900/70 p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-teal-100">Addresses</div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-teal-400/30 text-teal-100 hover:bg-teal-500/10"
                          onClick={() => addAddressEntry(institutionDraft.domicileCountryIso2 || "US")}
                        >
                          Add Address
                        </Button>
                      </div>
                      {(institutionDraft.addresses || []).map((entry, index) => (
                        <div key={`address-${index}`} className="space-y-2 rounded border border-neutral-700 p-2">
                          <div className="grid gap-2 md:grid-cols-4">
                            <select
                              value={entry.kind}
                              onChange={(e) =>
                                updateAddressEntry(index, {
                                  kind: (e.target.value as (typeof PARTNER_ADDRESS_KIND_OPTIONS)[number]) || "OTHER",
                                })
                              }
                              className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                            >
                              {PARTNER_ADDRESS_KIND_OPTIONS.map((kind) => (
                                <option key={`addr-kind-${kind}`} value={kind}>
                                  {kind}
                                </option>
                              ))}
                            </select>
                            <Input
                              placeholder="Line 1"
                              value={entry.line1}
                              onChange={(e) => updateAddressEntry(index, { line1: e.target.value })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Input
                              placeholder="Line 2"
                              value={entry.line2 || ""}
                              onChange={(e) => updateAddressEntry(index, { line2: e.target.value || null })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-neutral-600"
                              onClick={() => removeAddressEntry(index)}
                            >
                              Remove
                            </Button>
                          </div>
                          <div className="grid gap-2 md:grid-cols-4">
                            <Input
                              placeholder="City"
                              value={entry.city}
                              onChange={(e) => updateAddressEntry(index, { city: e.target.value })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Input
                              placeholder="State / Region"
                              value={entry.stateRegion || ""}
                              onChange={(e) => updateAddressEntry(index, { stateRegion: e.target.value || null })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Input
                              placeholder="Postal code"
                              value={entry.postalCode || ""}
                              onChange={(e) => updateAddressEntry(index, { postalCode: e.target.value || null })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <select
                              value={entry.countryIso2 || ""}
                              onChange={(e) => updateAddressEntry(index, { countryIso2: e.target.value })}
                              className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                            >
                              <option value="">Country</option>
                              {countryRows.map((row) => (
                                <option key={`addr-country-${row.code}`} value={row.code}>
                                  {row.name} ({row.code})
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="relative overflow-hidden rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 pl-5">
                    <div className="absolute bottom-0 left-0 top-0 w-1 bg-indigo-500" />
                    <div className="mb-3 flex items-center gap-2">
                      <div className="rounded border border-indigo-400/30 bg-indigo-500/10 p-1 text-indigo-200">
                        <Globe2 className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-indigo-100">Digital & Communication</div>
                        <div className="text-[11px] text-indigo-200/80">
                          Website, contact channels, and operational points of contact.
                        </div>
                      </div>
                    </div>
                    <Input
                      placeholder="Website URL"
                      value={institutionDraft.websiteUrl || ""}
                      onChange={(e) => setInstitutionField("websiteUrl", e.target.value || null)}
                      className="mb-2 border-neutral-600 bg-neutral-900"
                    />

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2 rounded border border-indigo-500/20 bg-neutral-900/70 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-indigo-100">General email addresses</div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-indigo-400/30 text-indigo-100 hover:bg-indigo-500/10"
                            onClick={() => addInstitutionStringListItem("generalEmails")}
                          >
                            Add Email
                          </Button>
                        </div>
                        {(institutionDraft.generalEmails || []).map((email, index) => (
                          <div key={`gen-email-${index}`} className="flex gap-2">
                            <Input
                              placeholder="ops@fund.com"
                              value={email}
                              onChange={(e) => updateInstitutionStringList("generalEmails", index, e.target.value)}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-neutral-600"
                              onClick={() => removeInstitutionStringListItem("generalEmails", index)}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        {(institutionDraft.generalEmails || []).length === 0 && (
                          <div className="text-[11px] text-neutral-400">
                            Capture operations, compliance, and treasury mailboxes.
                          </div>
                        )}
                      </div>

                      <div className="space-y-2 rounded border border-indigo-500/20 bg-neutral-900/70 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-indigo-100">Social / web profiles</div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-indigo-400/30 text-indigo-100 hover:bg-indigo-500/10"
                            onClick={() => addInstitutionStringListItem("socialProfiles")}
                          >
                            Add URL
                          </Button>
                        </div>
                        {(institutionDraft.socialProfiles || []).map((url, index) => (
                          <div key={`social-${index}`} className="flex gap-2">
                            <Input
                              placeholder="https://www.linkedin.com/company/..."
                              value={url}
                              onChange={(e) => updateInstitutionStringList("socialProfiles", index, e.target.value)}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-neutral-600"
                              onClick={() => removeInstitutionStringListItem("socialProfiles", index)}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        {(institutionDraft.socialProfiles || []).length === 0 && (
                          <div className="text-[11px] text-neutral-400">
                            Optional public profiles for due diligence cross-checks.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                      {(["phoneNumbers", "faxNumbers"] as const).map((field) => (
                        <div key={field} className="space-y-2 rounded border border-indigo-500/20 bg-neutral-900/70 p-2">
                          <div className="flex items-center justify-between">
                            <div className="text-xs text-indigo-100">
                              {field === "phoneNumbers" ? "Phone numbers" : "Fax numbers"}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-indigo-400/30 text-indigo-100 hover:bg-indigo-500/10"
                              onClick={() => addPhoneEntry(field, institutionDraft.domicileCountryIso2 || "US")}
                            >
                              Add {field === "phoneNumbers" ? "Phone" : "Fax"}
                            </Button>
                          </div>
                          {(institutionDraft[field] || []).map((entry, index) => (
                            <div
                              key={`${field}-${index}`}
                              className="grid gap-2 rounded border border-neutral-700 p-2 md:grid-cols-4"
                            >
                              <Input
                                placeholder="Label"
                                value={entry.label || ""}
                                onChange={(e) => updatePhoneEntry(field, index, { label: e.target.value || null })}
                                className="border-neutral-600 bg-neutral-900"
                              />
                              <select
                                value={entry.countryIso2 || ""}
                                onChange={(e) => updatePhoneEntry(field, index, { countryIso2: e.target.value })}
                                className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                              >
                                <option value="">ISO2</option>
                                {countryRows.map((row) => (
                                  <option key={`${field}-iso2-${row.code}`} value={row.code}>
                                    {row.code}
                                  </option>
                                ))}
                              </select>
                              <Input
                                placeholder="+12125550111"
                                value={entry.numberE164 || ""}
                                onChange={(e) => updatePhoneEntry(field, index, { numberE164: e.target.value })}
                                className="border-neutral-600 bg-neutral-900"
                              />
                              <div className="flex gap-2">
                                <Input
                                  placeholder="Ext"
                                  value={entry.extension || ""}
                                  onChange={(e) => updatePhoneEntry(field, index, { extension: e.target.value || null })}
                                  className="border-neutral-600 bg-neutral-900"
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-neutral-600"
                                  onClick={() => removePhoneEntry(field, index)}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 space-y-2 rounded border border-indigo-500/20 bg-neutral-900/70 p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-indigo-100">Points of contact</div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-indigo-400/30 text-indigo-100 hover:bg-indigo-500/10"
                          onClick={() => addPointOfContact(institutionDraft.domicileCountryIso2 || "US")}
                        >
                          Add Contact
                        </Button>
                      </div>
                      {(institutionDraft.pointsOfContact || []).map((entry, index) => (
                        <div key={`poc-${index}`} className="space-y-2 rounded border border-neutral-700 p-2">
                          <div className="grid gap-2 md:grid-cols-4">
                            <Input
                              placeholder="Full name"
                              value={entry.fullName}
                              onChange={(e) => updatePointOfContact(index, { fullName: e.target.value })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Input
                              placeholder="Title"
                              value={entry.title || ""}
                              onChange={(e) => updatePointOfContact(index, { title: e.target.value || null })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Input
                              placeholder="Department"
                              value={entry.department || ""}
                              onChange={(e) => updatePointOfContact(index, { department: e.target.value || null })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1 text-xs text-indigo-100">
                                <input
                                  type="checkbox"
                                  checked={Boolean(entry.isPrimary)}
                                  onChange={(e) => updatePointOfContact(index, { isPrimary: e.target.checked })}
                                />
                                Primary
                              </label>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-neutral-600"
                                onClick={() => removePointOfContact(index)}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                          <div className="grid gap-2 md:grid-cols-4">
                            <Input
                              type="email"
                              placeholder="Email"
                              value={entry.email || ""}
                              onChange={(e) => updatePointOfContact(index, { email: e.target.value || null })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Input
                              placeholder="Location"
                              value={entry.location || ""}
                              onChange={(e) => updatePointOfContact(index, { location: e.target.value || null })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <select
                              value={entry.preferredChannel || "EMAIL"}
                              onChange={(e) =>
                                updatePointOfContact(index, {
                                  preferredChannel:
                                    (e.target.value as (typeof PARTNER_CONTACT_CHANNEL_OPTIONS)[number]) || "EMAIL",
                                })
                              }
                              className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                            >
                              {PARTNER_CONTACT_CHANNEL_OPTIONS.map((channel) => (
                                <option key={`poc-channel-${channel}`} value={channel}>
                                  {channel}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            <div className="grid gap-2 rounded border border-neutral-700 p-2 md:grid-cols-4">
                              <Input
                                placeholder="Phone label"
                                value={entry.phone?.label || ""}
                                onChange={(e) =>
                                  updatePointOfContactPhone(index, "phone", { label: e.target.value || null })
                                }
                                className="border-neutral-600 bg-neutral-900"
                              />
                              <select
                                value={entry.phone?.countryIso2 || ""}
                                onChange={(e) => updatePointOfContactPhone(index, "phone", { countryIso2: e.target.value })}
                                className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                              >
                                <option value="">ISO2</option>
                                {countryRows.map((row) => (
                                  <option key={`poc-phone-country-${row.code}`} value={row.code}>
                                    {row.code}
                                  </option>
                                ))}
                              </select>
                              <Input
                                placeholder="+12125550111"
                                value={entry.phone?.numberE164 || ""}
                                onChange={(e) => updatePointOfContactPhone(index, "phone", { numberE164: e.target.value })}
                                className="border-neutral-600 bg-neutral-900"
                              />
                              <Input
                                placeholder="Ext"
                                value={entry.phone?.extension || ""}
                                onChange={(e) =>
                                  updatePointOfContactPhone(index, "phone", { extension: e.target.value || null })
                                }
                                className="border-neutral-600 bg-neutral-900"
                              />
                            </div>
                            <div className="grid gap-2 rounded border border-neutral-700 p-2 md:grid-cols-4">
                              <Input
                                placeholder="Fax label"
                                value={entry.fax?.label || ""}
                                onChange={(e) =>
                                  updatePointOfContactPhone(index, "fax", { label: e.target.value || null })
                                }
                                className="border-neutral-600 bg-neutral-900"
                              />
                              <select
                                value={entry.fax?.countryIso2 || ""}
                                onChange={(e) => updatePointOfContactPhone(index, "fax", { countryIso2: e.target.value })}
                                className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                              >
                                <option value="">ISO2</option>
                                {countryRows.map((row) => (
                                  <option key={`poc-fax-country-${row.code}`} value={row.code}>
                                    {row.code}
                                  </option>
                                ))}
                              </select>
                              <Input
                                placeholder="+12125550111"
                                value={entry.fax?.numberE164 || ""}
                                onChange={(e) => updatePointOfContactPhone(index, "fax", { numberE164: e.target.value })}
                                className="border-neutral-600 bg-neutral-900"
                              />
                              <Input
                                placeholder="Ext"
                                value={entry.fax?.extension || ""}
                                onChange={(e) =>
                                  updatePointOfContactPhone(index, "fax", { extension: e.target.value || null })
                                }
                                className="border-neutral-600 bg-neutral-900"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="relative overflow-hidden rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 pl-5">
                    <div className="absolute bottom-0 left-0 top-0 w-1 bg-rose-500" />
                    <div className="mb-3 flex items-center gap-2">
                      <div className="rounded border border-rose-400/30 bg-rose-500/10 p-1 text-rose-200">
                        <ShieldCheck className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-rose-100">Regulatory & Service Providers</div>
                        <div className="text-[11px] text-rose-200/80">Compliance lineage and institutional trust data.</div>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2 rounded border border-rose-500/20 bg-neutral-900/70 p-2">
                        <div className="flex items-center gap-1.5 text-xs text-rose-100">
                          <Landmark className="h-3.5 w-3.5" />
                          Service providers
                        </div>
                        <Input
                          placeholder="Prime broker"
                          value={institutionDraft.serviceProviders.primeBroker || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              serviceProviders: { ...prev.serviceProviders, primeBroker: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="Fund administrator"
                          value={institutionDraft.serviceProviders.fundAdministrator || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              serviceProviders: { ...prev.serviceProviders, fundAdministrator: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="Auditor"
                          value={institutionDraft.serviceProviders.auditor || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              serviceProviders: { ...prev.serviceProviders, auditor: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="Custodian"
                          value={institutionDraft.serviceProviders.custodian || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              serviceProviders: { ...prev.serviceProviders, custodian: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="Legal counsel"
                          value={institutionDraft.serviceProviders.legalCounsel || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              serviceProviders: { ...prev.serviceProviders, legalCounsel: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="Banking partner"
                          value={institutionDraft.serviceProviders.bankingPartner || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              serviceProviders: { ...prev.serviceProviders, bankingPartner: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                      </div>

                      <div className="space-y-2 rounded border border-rose-500/20 bg-neutral-900/70 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-rose-100">Regulators</div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-rose-400/30 text-rose-100 hover:bg-rose-500/10"
                            onClick={() => addRegulatoryStringListItem("regulatorNames")}
                          >
                            Add Regulator
                          </Button>
                        </div>
                        {(institutionDraft.regulatory.regulatorNames || []).map((name, index) => (
                          <div key={`regulator-${index}`} className="flex gap-2">
                            <Input
                              placeholder="SEC, FCA, CFTC..."
                              value={name}
                              onChange={(e) => updateRegulatoryStringList("regulatorNames", index, e.target.value)}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-neutral-600"
                              onClick={() => removeRegulatoryStringListItem("regulatorNames", index)}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        <Input
                          placeholder="SEC file number"
                          value={institutionDraft.regulatory.secFileNumber || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              regulatory: { ...prev.regulatory, secFileNumber: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="SEC exempt file number"
                          value={institutionDraft.regulatory.secExemptFileNumber || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              regulatory: { ...prev.regulatory, secExemptFileNumber: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="CRD number"
                          value={institutionDraft.regulatory.crdNumber || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              regulatory: { ...prev.regulatory, crdNumber: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-rose-100">CIK numbers</div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-rose-400/30 text-rose-100 hover:bg-rose-500/10"
                            onClick={() => addRegulatoryStringListItem("cikNumbers")}
                          >
                            Add CIK
                          </Button>
                        </div>
                        {(institutionDraft.regulatory.cikNumbers || []).map((cik, index) => (
                          <div key={`cik-${index}`} className="flex gap-2">
                            <Input
                              placeholder="0001234567"
                              value={cik}
                              onChange={(e) => updateRegulatoryStringList("cikNumbers", index, e.target.value)}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-neutral-600"
                              onClick={() => removeRegulatoryStringListItem("cikNumbers", index)}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        <Input
                          placeholder="NFA ID"
                          value={institutionDraft.regulatory.nfaId || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              regulatory: { ...prev.regulatory, nfaId: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="Registration number"
                          value={institutionDraft.regulatory.registrationNumber || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              regulatory: { ...prev.regulatory, registrationNumber: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="Tax ID / EIN"
                          value={institutionDraft.regulatory.taxId || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              regulatory: { ...prev.regulatory, taxId: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="LEI"
                          value={institutionDraft.regulatory.lei || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              regulatory: { ...prev.regulatory, lei: e.target.value.toUpperCase() || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                      </div>
                    </div>
                  </section>

                  <div className="flex justify-end">
                    <LockedActionButton
                      size="sm"
                      className="border border-blue-400/50 bg-blue-500/20 text-blue-50 hover:bg-blue-500/30"
                      onClick={() => submitOnboardingProfile.mutate()}
                      disabled={saveIdentityDisabled}
                      lockReason={saveIdentityDisabledReason}
                    >
                      {submitOnboardingProfile.isPending ? "Saving..." : "Save Identity"}
                    </LockedActionButton>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="legal" className="mt-3">
                <div
                  ref={legalSectionRef}
                  className="relative space-y-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 pl-5"
                >
                  <div className="absolute bottom-0 left-0 top-0 w-1 bg-rose-500" />
                  <div className="flex items-center gap-2">
                    <div className="rounded border border-rose-400/30 bg-rose-500/10 p-1 text-rose-200">
                      <FileCheck2 className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-rose-100">Legal & Approval</div>
                      <div className="text-[11px] text-rose-200/80">KYB package and binding attestations.</div>
                    </div>
                  </div>

                  <div className="space-y-2 rounded border border-rose-500/20 bg-neutral-900/70 p-2">
                    <div className="text-xs text-rose-100">Compliance document</div>
                    <Input
                      placeholder="KYB document URL"
                      value={legalDraft.kybDocUrl}
                      onChange={(e) => setLegalDraft((prev: any) => ({ ...prev, kybDocUrl: e.target.value }))}
                      className="border-neutral-600 bg-neutral-900"
                    />
                  </div>

                  <div className="space-y-2 rounded border border-rose-500/20 bg-rose-500/10 p-2">
                    <div className="text-xs text-rose-100">Attestations</div>
                    <label className="flex items-center gap-2 text-xs text-rose-100">
                      <input
                        type="checkbox"
                        checked={legalDraft.agreedToAllocation}
                        onChange={(e) => setLegalDraft((prev: any) => ({ ...prev, agreedToAllocation: e.target.checked }))}
                      />
                      I agree to Master Allocation Agreement
                    </label>
                    <label className="flex items-center gap-2 text-xs text-rose-100">
                      <input
                        type="checkbox"
                        checked={legalDraft.agreedToNda}
                        onChange={(e) => setLegalDraft((prev: any) => ({ ...prev, agreedToNda: e.target.checked }))}
                      />
                      I agree to NDA terms
                    </label>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2 pt-1">
                    <LockedActionButton
                      size="sm"
                      variant="outline"
                      className="border-rose-300/40 text-rose-100 hover:bg-rose-500/10"
                      onClick={() => requestContactAccess.mutate()}
                      disabled={!keyReady || requestContactAccess.isPending}
                      lockReason={
                        !keyReady
                          ? "Connect with a valid partner API key before requesting direct contact access."
                          : requestContactAccess.isPending
                            ? "Contact request is in progress."
                            : null
                      }
                    >
                      {requestContactAccess.isPending ? "Requesting..." : "Request Contact Access"}
                    </LockedActionButton>
                    <LockedActionButton
                      size="sm"
                      className="border border-rose-300/40 bg-rose-500/20 text-rose-50 hover:bg-rose-500/30"
                      onClick={() => submitOnboardingLegal.mutate()}
                      disabled={legalSubmitDisabled}
                      lockReason={legalSubmitDisabledReason}
                    >
                      {submitOnboardingLegal.isPending ? "Submitting..." : "Submit Legal"}
                    </LockedActionButton>
                  </div>
                  {isPendingApproval ? (
                    <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
                      Pending admin approval: allocations/direct contact remain locked until approved.
                    </div>
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent value="trader-access" className="mt-3">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-100">
                  Trader access controls are below as mini-tabs. Select Data Room, Simulations, Allocations, or
                  Comms to continue.
                </div>
              </TabsContent>
            </Tabs>
        </>
      )}

        {showTraderAccessMiniTabs && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid h-auto w-full grid-cols-4 border border-neutral-700 bg-neutral-950/90 p-1">
              <TabsTrigger
                value="data-room"
                className="gap-1.5 py-2 text-xs text-slate-200 data-[state=active]:bg-sky-500/15 data-[state=active]:text-sky-100 data-[state=active]:shadow-none sm:text-sm"
              >
                <FolderKanban className="h-3.5 w-3.5" />
                Data Room
              </TabsTrigger>
              <TabsTrigger
                value="simulations"
                className="gap-1.5 py-2 text-xs text-slate-200 data-[state=active]:bg-violet-500/15 data-[state=active]:text-violet-100 data-[state=active]:shadow-none sm:text-sm"
              >
                <Beaker className="h-3.5 w-3.5" />
                Simulations
              </TabsTrigger>
              <TabsTrigger
                value="allocations"
                className="gap-1.5 py-2 text-xs text-slate-200 data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-100 data-[state=active]:shadow-none sm:text-sm"
              >
                <WalletCards className="h-3.5 w-3.5" />
                Allocations
              </TabsTrigger>
              <TabsTrigger
                value="comms"
                className="gap-1.5 py-2 text-xs text-slate-200 data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-100 data-[state=active]:shadow-none sm:text-sm"
              >
                <MessageSquareLock className="h-3.5 w-3.5" />
                Comms
              </TabsTrigger>
            </TabsList>

          <TabsContent value="data-room" className="mt-3">
            {!gateViewDataRoom ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Data room access is currently gated. Complete onboarding requirements to unlock this section.</span>
                  <Button size="sm" variant="outline" className="border-amber-300/40" onClick={() => openTraderAccessTab("comms")}>
                    Inquire with Admin
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                <div
                  className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3"
                  data-testid="partner-data-room-table"
                >
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-sky-100">
                    <FolderKanban className="h-4 w-4" />
                    Anonymized Candidates
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="border-b border-sky-500/20 text-sky-100">
                        <tr>
                          <th className="py-2 text-left">Trader</th>
                          <th className="py-2 text-right">Score</th>
                          <th className="py-2 text-right">Sharpe</th>
                          <th className="py-2 text-right">P/L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(dataRoomQuery.data?.results ?? []).map((row) => (
                          <tr
                            key={row.hashId}
                            className={`cursor-pointer border-b border-neutral-800 ${
                              selectedHashId === row.hashId ? "bg-sky-500/15" : "hover:bg-sky-500/10"
                            }`}
                            onClick={() => setSelectedHashId(row.hashId)}
                          >
                            <td className="py-2">
                              <div className="font-medium">{row.hashId}</div>
                              <div className="text-[11px] text-gray-400">{row.styleCluster || "Unclassified"}</div>
                            </td>
                            <td className="py-2 text-right">{row.metrics.compositeScore?.toFixed(2) ?? "-"}</td>
                            <td className="py-2 text-right">{row.metrics.sharpeRatio?.toFixed(2) ?? "-"}</td>
                            <td className="py-2 text-right">
                              <span className={row.performance.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}>
                                {row.performance.netProfit >= 0 ? "+" : "-"}${fmtUsd(Math.abs(row.performance.netProfit))}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {!dataRoomQuery.isLoading && (dataRoomQuery.data?.results ?? []).length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-gray-400">
                              No candidates visible for this partner key.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div
                  className="rounded-lg border border-sky-500/30 bg-neutral-900/80 p-3"
                  data-testid="partner-tear-sheet"
                >
                  <div className="mb-2 text-sm font-semibold text-sky-100">Tear Sheet</div>
                  {!selectedHashId ? (
                    <div className="text-xs text-gray-400">Select a candidate to load the tear sheet.</div>
                  ) : tearSheetQuery.isLoading ? (
                    <div className="text-xs text-gray-400">Loading tear sheet…</div>
                  ) : tearSheetQuery.data ? (
                    <div className="space-y-3 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded border border-sky-500/20 p-2">
                          <div className="text-gray-400">Trades</div>
                          <div className="text-white">{tearSheetQuery.data.summary.trades}</div>
                        </div>
                        <div className="rounded border border-sky-500/20 p-2">
                          <div className="text-gray-400">Win Rate</div>
                          <div className="text-white">{fmtPct(tearSheetQuery.data.summary.winRate)}</div>
                        </div>
                        <div className="rounded border border-sky-500/20 p-2">
                          <div className="text-gray-400">Net Profit</div>
                          <div className={tearSheetQuery.data.summary.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}>
                            {tearSheetQuery.data.summary.netProfit >= 0 ? "+" : "-"}$
                            {fmtUsd(Math.abs(tearSheetQuery.data.summary.netProfit))}
                          </div>
                        </div>
                        <div className="rounded border border-sky-500/20 p-2">
                          <div className="text-gray-400">Composite</div>
                          <div className="text-white">{tearSheetQuery.data.metrics?.compositeScore?.toFixed(2) ?? "-"}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded border border-sky-500/20 p-2">
                          <div className="text-gray-400 mb-1">Top Trades</div>
                          <div className="space-y-1">
                            {(tearSheetQuery.data.topTrades ?? []).slice(0, 5).map((t: any) => (
                              <div key={t.id} className="flex items-center justify-between">
                                <span>{t.symbol || "?"}</span>
                                <span className="text-emerald-400">+${fmtUsd(t.pnlUsd)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded border border-sky-500/20 p-2">
                          <div className="text-gray-400 mb-1">Bottom Trades</div>
                          <div className="space-y-1">
                            {(tearSheetQuery.data.bottomTrades ?? []).slice(0, 5).map((t: any) => (
                              <div key={t.id} className="flex items-center justify-between">
                                <span>{t.symbol || "?"}</span>
                                <span className="text-red-400">-${fmtUsd(Math.abs(t.pnlUsd))}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400">No tear sheet loaded.</div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="simulations" className="mt-3 space-y-3">
            {!gateRunSimulations ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Simulation actions are locked until the required onboarding gate is reached. Current reason:{" "}
                    {onboardingState?.gateEval?.runSimulations?.reason || "PARTNER_GATE_BLOCKED"}.
                  </span>
                  <Button size="sm" variant="outline" className="border-amber-300/40" onClick={() => openTraderAccessTab("comms")}>
                    Inquire with Admin
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-100">
                <Beaker className="h-4 w-4" />
                Run Simulation Preview
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                <Input
                  placeholder="User hashId"
                  value={simulationDraft.userHashId}
                  onChange={(e) => setSimulationDraft((prev: any) => ({ ...prev, userHashId: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <Input
                  placeholder="Notional USD"
                  value={simulationDraft.notionalUsd}
                  onChange={(e) => setSimulationDraft((prev: any) => ({ ...prev, notionalUsd: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                  inputMode="decimal"
                />
                <Input
                  placeholder="Horizon days"
                  value={simulationDraft.horizonDays}
                  onChange={(e) => setSimulationDraft((prev: any) => ({ ...prev, horizonDays: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                  inputMode="numeric"
                />
                <LockedActionButton
                  className="border border-violet-300/40 bg-violet-500/20 text-violet-50 hover:bg-violet-500/30"
                  onClick={() => previewSimulation.mutate()}
                  disabled={simulationPreviewDisabled}
                  lockReason={simulationPreviewDisabledReason}
                >
                  {previewSimulation.isPending ? "Simulating..." : "Run Preview"}
                </LockedActionButton>
              </div>
            </div>

            <div className="rounded-lg border border-violet-500/30 bg-gradient-to-br from-violet-500/10 to-emerald-500/5 p-3">
              <div className="mb-2 text-sm font-semibold text-violet-100">Simulation Result</div>
              {simulationPreview ? (
                <div className="grid gap-3 md:grid-cols-3 text-xs">
                  <div className="rounded border border-violet-500/20 p-2">
                    <div className="text-gray-400">Projected P/L</div>
                    <div className={simulationPreview.scenario.projectedPnlUsd >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {simulationPreview.scenario.projectedPnlUsd >= 0 ? "+" : "-"}$
                      {Math.abs(simulationPreview.scenario.projectedPnlUsd).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                    <div className="text-gray-400">{fmtPct(simulationPreview.scenario.projectedPnlPct)}</div>
                  </div>
                  <div className="rounded border border-violet-500/20 p-2">
                    <div className="text-gray-400">Risk / Confidence</div>
                    <div className="text-white">
                      {simulationPreview.scenario.riskBand} /{" "}
                      {(simulationPreview.scenario.confidence * 100).toFixed(0)}%
                    </div>
                    <div className="text-gray-400">{simulationPreview.scenario.modelVersion}</div>
                  </div>
                  <div className="rounded border border-violet-500/20 p-2">
                    <div className="text-gray-400">Historical Basis</div>
                    <div className="text-white">
                      {simulationPreview.historical.trades} trades | win {fmtPct(simulationPreview.historical.winRate)}
                    </div>
                    <div className="text-gray-400">
                      Sharpe:{" "}
                      {simulationPreview.historical.sharpeRatio == null
                        ? "-"
                        : simulationPreview.historical.sharpeRatio.toFixed(2)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-400">
                  Select a candidate and run preview to generate simulated P/L and risk profile.
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="allocations" className="mt-3 space-y-3">
            {!gateRequestAllocation ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Allocation actions are locked until compliance/legal onboarding is completed and approved.</span>
                  <Button size="sm" variant="outline" className="border-amber-300/40" onClick={() => openTraderAccessTab("comms")}>
                    Inquire with Admin
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-100">
                <WalletCards className="h-4 w-4" />
                Create Allocation
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                <Input
                  placeholder="User hashId"
                  value={allocationDraft.userHashId}
                  onChange={(e) => setAllocationDraft((prev: any) => ({ ...prev, userHashId: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <Input
                  placeholder="Capital USD"
                  value={allocationDraft.capitalUsd}
                  onChange={(e) => setAllocationDraft((prev: any) => ({ ...prev, capitalUsd: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <Input
                  placeholder="Shadow stop (0.03)"
                  value={allocationDraft.shadowStopPct}
                  onChange={(e) => setAllocationDraft((prev: any) => ({ ...prev, shadowStopPct: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <LockedActionButton
                  className="border border-emerald-300/40 bg-emerald-500/20 text-emerald-50 hover:bg-emerald-500/30"
                  onClick={() => createAllocation.mutate()}
                  disabled={createAllocationDisabled}
                  lockReason={createAllocationDisabledReason}
                >
                  {createAllocation.isPending ? "Submitting..." : "Allocate"}
                </LockedActionButton>
              </div>
            </div>

            <div
              className="rounded-lg border border-emerald-500/30 bg-neutral-900/80 p-3"
              data-testid="partner-allocations-table"
            >
              <div className="mb-2 text-sm font-semibold text-emerald-100">Allocations</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-emerald-500/20 text-emerald-100">
                    <tr>
                      <th className="py-2 text-left">Trader</th>
                      <th className="py-2 text-right">Capital</th>
                      <th className="py-2 text-right">PnL</th>
                      <th className="py-2 text-right">Status</th>
                      <th className="py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(allocationsQuery.data?.rows ?? []).map((row) => {
                      const nextStatus = row.status === "ACTIVE" ? "STOPPED" : "ACTIVE";
                      return (
                        <tr key={row.id} className="border-b border-neutral-800">
                          <td className="py-2">{row.userHashId}</td>
                          <td className="py-2 text-right">${fmtUsd(row.capitalUsd)}</td>
                          <td className="py-2 text-right">${fmtUsd(row.currentPnlUsd ?? 0)}</td>
                          <td className="py-2 text-right">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${
                                row.status === "ACTIVE"
                                  ? "border border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
                                  : row.status === "STOPPED"
                                    ? "border border-amber-400/40 bg-amber-500/20 text-amber-100"
                                    : "border border-neutral-500/40 bg-neutral-700/40 text-neutral-200"
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="py-2 text-right">
                            <LockedActionButton
                              size="sm"
                              variant="outline"
                              className="border-neutral-600"
                              onClick={() => updateAllocation.mutate({ id: row.id, status: nextStatus })}
                              disabled={!keyReady || updateAllocation.isPending || !gateRequestAllocation}
                              lockReason={
                                !keyReady
                                  ? "Connect with a valid partner API key before updating allocations."
                                  : !gateRequestAllocation
                                    ? `Allocation gate is locked (${onboardingState?.gateEval?.requestAllocation?.reason || "PARTNER_GATE_BLOCKED"}).`
                                    : updateAllocation.isPending
                                      ? "Allocation status update is in progress."
                                      : null
                              }
                            >
                              Set {nextStatus}
                            </LockedActionButton>
                          </td>
                        </tr>
                      );
                    })}
                    {!allocationsQuery.isLoading && (allocationsQuery.data?.rows ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-gray-400">
                          No allocations for this partner key.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="comms" className="mt-3 space-y-3">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-100">
                <MessageSquareLock className="h-4 w-4" />
                Submit Inquiry
              </div>
              <div className="mb-2 rounded border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                Inbox: <span className="font-semibold">{inquiryInboxAlias}</span> | recipients:{" "}
                {inquiryRecipientsQuery.data?.participantCount ?? 0} | route:{" "}
                {inquiryRecipientsQuery.data?.routeAdminCount ?? 0} | viewers:{" "}
                {inquiryRecipientsQuery.data?.viewerAdminCount ?? 0}
                {inquiryMissingKeyCount > 0 ? (
                  <span className="text-amber-200">
                    {" "}
                    | missing mailbox keys: {inquiryMissingKeyCount} (ask admins to open Communications and complete
                    E2EE bootstrap)
                  </span>
                ) : null}
              </div>
              {!gateDirectContact ? (
                <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Direct trader contact remains locked until admin approval. This inquiry channel is the secure
                      fallback and uses client-side E2EE envelopes over HTTPS transport.
                    </span>
                    <Button size="sm" variant="outline" className="border-amber-300/40" onClick={() => openTraderAccessTab("comms")}>
                      Inquire with Admin
                    </Button>
                  </div>
                </div>
              ) : null}
              <div className="grid gap-2">
                <Input
                  placeholder="Optional hashId (User-...)"
                  value={inquiryDraft.userHashId}
                  onChange={(e) => setInquiryDraft((prev: any) => ({ ...prev, userHashId: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <Input
                  placeholder="Sender name (optional)"
                  value={inquiryDraft.senderName}
                  onChange={(e) => setInquiryDraft((prev: any) => ({ ...prev, senderName: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <Input
                  type="email"
                  placeholder="Sender email"
                  value={inquiryDraft.senderEmail}
                  onChange={(e) => setInquiryDraft((prev: any) => ({ ...prev, senderEmail: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <Input
                  placeholder="Subject"
                  value={inquiryDraft.subject}
                  onChange={(e) => setInquiryDraft((prev: any) => ({ ...prev, subject: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <Textarea
                  placeholder="Inquiry body"
                  value={inquiryDraft.body}
                  onChange={(e) => setInquiryDraft((prev: any) => ({ ...prev, body: e.target.value }))}
                  className="min-h-[120px] border-neutral-600 bg-neutral-900"
                />
                <div className="flex justify-end">
                  <LockedActionButton
                    className="border border-amber-300/40 bg-amber-500/20 text-amber-50 hover:bg-amber-500/30"
                    onClick={() => createInquiry.mutate()}
                    disabled={inquirySendDisabled}
                    lockReason={inquirySendDisabledReason}
                  >
                    {createInquiry.isPending ? "Submitting..." : "Send Inquiry"}
                  </LockedActionButton>
                </div>
              </div>
            </div>

            <div
              className="rounded-lg border border-amber-500/30 bg-neutral-900/80 p-3"
              data-testid="partner-inquiries-table"
            >
              <div className="mb-2 text-sm font-semibold text-amber-100">Inquiry History</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-amber-500/20 text-amber-100">
                    <tr>
                      <th className="py-2 text-left">Subject</th>
                      <th className="py-2 text-left">Hash</th>
                      <th className="py-2 text-right">Status</th>
                      <th className="py-2 text-right">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(inquiriesQuery.data?.rows ?? []).map((row) => (
                      <tr key={row.id} className="border-b border-neutral-800">
                        <td className="py-2">
                          <div className="font-medium">{row.subject}</div>
                          <div className="text-[11px] text-gray-400 line-clamp-2">{row.body}</div>
                          <div className="text-[11px] text-gray-500 mt-1">
                            {row.senderName || "Sender"} {row.senderEmail ? `(${row.senderEmail})` : ""}
                          </div>
                        </td>
                        <td className="py-2">{row.userHashId || "-"}</td>
                        <td className="py-2 text-right">{row.status}</td>
                        <td className="py-2 text-right">{fmtWhen(row.createdAt)}</td>
                      </tr>
                    ))}
                    {!inquiriesQuery.isLoading && (inquiriesQuery.data?.rows ?? []).length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-gray-400">
                          No inquiries yet for this partner key.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
