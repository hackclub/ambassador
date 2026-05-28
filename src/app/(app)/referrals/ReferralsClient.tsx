"use client";

import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  StardanceReferralCode,
  StardanceReferral,
  StardanceReferralVerificationStatus,
} from "@/lib/stardance-referrals";
import { cn } from "@/lib/utils";

type ReferralsClientProps = {
  referralCodes: StardanceReferralCode[];
  archivedReferralCodes: StardanceReferralCode[];
  referrals: StardanceReferral[];
};

const VERIFICATION_TONES: Record<StardanceReferralVerificationStatus, string> = {
  rsvp: "text-muted-foreground",
  verified: "text-acceptance",
  pending: "text-accent",
  unverified: "text-muted-foreground",
  rejected: "text-primary",
};

function formatPosterCode(code: string | null) {
  if (code === null) return null;
  return code;
}

function isReferralCode(value: unknown): value is StardanceReferralCode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.code === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.shareUrl === "string" &&
    typeof candidate.usesCount === "number" &&
    (candidate.kind === "primary" || candidate.kind === "secondary")
  );
}

export function ReferralsClient({
  referralCodes,
  archivedReferralCodes,
  referrals,
}: ReferralsClientProps) {
  const t = useTranslations("referrals");
  const [codes, setCodes] = useState(referralCodes);
  const [archivedCodes, setArchivedCodes] = useState(archivedReferralCodes);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [referralFilter, setReferralFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | StardanceReferralVerificationStatus>("all");
  const [codesOpen, setCodesOpen] = useState(true);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filteredReferrals = useMemo(() => {
    const trimmed = referralFilter.trim().toLowerCase();
    return referrals.filter((referral) => {
      if (statusFilter !== "all" && referral.verificationStatus !== statusFilter) {
        return false;
      }
      if (trimmed === "") return true;
      return (
        referral.referralCodeLabel.toLowerCase().includes(trimmed) ||
        (referral.posterName?.toLowerCase().includes(trimmed) ?? false) ||
        (referral.posterReferralCode?.toLowerCase().includes(trimmed) ?? false) ||
        referral.name.toLowerCase().includes(trimmed) ||
        referral.email.toLowerCase().includes(trimmed)
      );
    });
  }, [referrals, referralFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredReferrals.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedReferrals = useMemo(
    () => filteredReferrals.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredReferrals, currentPage],
  );

  useEffect(() => {
    setPage(1);
  }, [referralFilter, statusFilter]);

  async function createCode() {
    const trimmedLabel = label.trim();

    if (trimmedLabel === "") {
      setError(t("errors.label-required"));
      return;
    }

    setCreating(true);
    setError("");

    try {
      const response = await fetch("/api/referrals/codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: trimmedLabel }),
      });

      const data = await response.json().catch(() => null);
      const payload: Record<string, unknown> | null =
        typeof data === "object" && data !== null && !Array.isArray(data)
          ? Object.fromEntries(Object.entries(data))
          : null;

      if (!response.ok) {
        setError(typeof payload?.error === "string" ? payload.error : t("errors.create-failed"));
        return;
      }

      const created = payload?.referralCode;

      if (!isReferralCode(created)) {
        setError(t("errors.create-failed"));
        return;
      }

      setCodes((current) => [...current, created]);
      setLabel("");
    } catch {
      setError(t("errors.create-failed"));
    } finally {
      setCreating(false);
    }
  }

  function handleRenamed(updated: StardanceReferralCode) {
    setCodes((current) => current.map((code) => (code.id === updated.id ? updated : code)));
    setArchivedCodes((current) =>
      current.map((code) => (code.id === updated.id ? updated : code)),
    );
  }

  function handleArchived(archived: StardanceReferralCode) {
    setCodes((current) => current.filter((code) => code.id !== archived.id));
    setArchivedCodes((current) => [archived, ...current.filter((c) => c.id !== archived.id)]);
  }

  function handleRestored(restored: StardanceReferralCode) {
    setArchivedCodes((current) => current.filter((code) => code.id !== restored.id));
    setCodes((current) => [...current.filter((c) => c.id !== restored.id), restored]);
  }

  return (
    <div className="space-y-12">
      <section className="space-y-3">
        <button
          type="button"
          data-slot="open-link"
          onClick={() => setCodesOpen((open) => !open)}
          aria-expanded={codesOpen}
          className="group inline-flex items-center gap-2 bg-transparent p-0 text-left"
        >
          <h2 className="font-sub text-2xl leading-none text-white md:text-3xl">{t("codes.heading")}</h2>
          <span className="font-body text-sm leading-none text-muted-foreground">({codes.length})</span>
          <ChevronDown
            size={20}
            aria-hidden
            className={cn(
              "text-muted-foreground transition-transform duration-150 group-hover:text-foreground",
              codesOpen && "rotate-180",
            )}
          />
        </button>

        {codesOpen && (
          <>
            <p className="max-w-2xl font-body text-sm text-muted-foreground md:text-base">
              {t("codes.description")}
            </p>
            <ul className="divide-y divide-white/10 border-t border-white/10">
              {codes.map((referralCode) => (
                <ReferralCodeRow
                  key={referralCode.id}
                  referralCode={referralCode}
                  onRenamed={handleRenamed}
                  onArchived={handleArchived}
                />
              ))}
            </ul>

            <div className="space-y-2 pt-4">
              <label
                htmlFor="referral-code-label"
                className="block font-body text-sm text-muted-foreground md:text-base"
              >
                {t("creator.description")}
              </label>
              <div className="flex max-w-xl items-stretch gap-2">
                <Input
                  id="referral-code-label"
                  type="text"
                  value={label}
                  onChange={(event) => setLabel(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void createCode();
                    }
                  }}
                  placeholder={t("creator.placeholder")}
                  aria-label={t("creator.label")}
                  className="h-11 flex-1 rounded-md border border-white/10 bg-background px-3 text-base"
                />
                <button
                  type="button"
                  data-slot="icon-link"
                  onClick={() => void createCode()}
                  disabled={creating || label.trim() === ""}
                  aria-label={t("creator.action")}
                  title={creating ? t("creator.creating") : t("creator.action")}
                  className="inline-flex size-11 shrink-0 items-center justify-center bg-transparent text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creating ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <ArrowRight size={20} />
                  )}
                </button>
              </div>
              {error ? (
                <p className="font-body text-sm text-primary">{error}</p>
              ) : null}
            </div>
          </>
        )}
      </section>

      {archivedCodes.length > 0 && (
        <section className="space-y-3">
          <button
            type="button"
            data-slot="open-link"
            onClick={() => setArchiveOpen((open) => !open)}
            aria-expanded={archiveOpen}
            className="group inline-flex items-center gap-2 bg-transparent p-0 text-left"
          >
            <h2 className="font-sub text-2xl leading-none text-white md:text-3xl">
              {t("archive.heading")}
            </h2>
            <span className="font-body text-sm leading-none text-muted-foreground">
              ({archivedCodes.length})
            </span>
            <ChevronDown
              size={20}
              aria-hidden
              className={cn(
                "text-muted-foreground transition-transform duration-150 group-hover:text-foreground",
                archiveOpen && "rotate-180",
              )}
            />
          </button>

          {archiveOpen && (
            <>
              <p className="max-w-2xl font-body text-sm text-muted-foreground md:text-base">
                {t("archive.description")}
              </p>
              <ul className="divide-y divide-white/10 border-t border-white/10">
                {archivedCodes.map((referralCode) => (
                  <ArchivedReferralCodeRow
                    key={referralCode.id}
                    referralCode={referralCode}
                    onRestored={handleRestored}
                  />
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="space-y-4 border-t border-white/10 pt-6">
        {referrals.length === 0 ? (
          <div className="max-w-2xl">
            <h2 className="font-sub text-2xl text-white md:text-3xl">{t("empty.title")}</h2>
            <p className="mt-2 font-body text-sm text-muted-foreground md:text-base">
              {t("empty.body")}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full max-w-[calc(36rem-3.25rem)]">
                <Search
                  size={16}
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  value={referralFilter}
                  onChange={(event) => setReferralFilter(event.currentTarget.value)}
                  placeholder={t("table.filter-placeholder")}
                  aria-label={t("table.filter-label")}
                  className="h-10 w-full rounded-md border border-white/10 bg-background pl-9 pr-3 text-sm"
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(value) =>
                  setStatusFilter(
                    value as "all" | StardanceReferralVerificationStatus,
                  )
                }
              >
                <SelectTrigger
                  aria-label={t("table.status-filter-label")}
                  className="h-10 w-full rounded-none border border-white/10 bg-muted px-3 text-sm sm:ml-auto sm:w-48"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="all">{t("table.status-filter-all")}</SelectItem>
                  <SelectItem value="verified">{t("table.status.verified")}</SelectItem>
                  <SelectItem value="rsvp">{t("table.status.rsvp")}</SelectItem>
                  <SelectItem value="pending">{t("table.status.pending")}</SelectItem>
                  <SelectItem value="unverified">{t("table.status.unverified")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="overflow-x-auto border border-white/10 bg-card">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/10">
                    <Th>{t("table.name")}</Th>
                    <Th>{t("table.code")}</Th>
                    <Th>{t("table.type")}</Th>
                    <Th>{t("table.slack")}</Th>
                    <Th>{t("table.email")}</Th>
                    <Th>{t("table.hours-logged")}</Th>
                    <Th>{t("table.verification")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReferrals.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-6 font-body text-sm text-muted-foreground">
                        {t("table.no-results")}
                      </td>
                    </tr>
                  ) : (
                    pagedReferrals.map((referral) => (
                      <tr
                        key={referral.id}
                        className="border-b border-white/5 last:border-b-0"
                      >
                        <Td>{referral.name}</Td>
                        <Td>
                          {referral.kind === "poster" ? (
                            referral.posterName ??
                            formatPosterCode(referral.posterReferralCode) ??
                            referral.referralCodeLabel
                          ) : (
                            referral.referralCodeLabel
                          )}
                        </Td>
                        <Td>
                          {referral.kind === "poster"
                            ? t("table.type-poster")
                            : t("table.type-referral")}
                        </Td>
                        <Td>{referral.slackId || "-"}</Td>
                        <Td>{referral.email || "-"}</Td>
                        <Td>{referral.hoursLogged}</Td>
                        <Td>
                          <span
                            className={cn(
                              "font-body text-sm",
                              VERIFICATION_TONES[referral.verificationStatus],
                            )}
                          >
                            {t(`table.status.${referral.verificationStatus}`)}
                          </span>
                        </Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {filteredReferrals.length > pageSize && (
              <div className="flex items-center justify-between gap-3 font-body text-sm text-muted-foreground">
                <span>
                  {t("table.pagination-range", {
                    from: (currentPage - 1) * pageSize + 1,
                    to: Math.min(currentPage * pageSize, filteredReferrals.length),
                    total: filteredReferrals.length,
                  })}
                </span>
                <div className="flex items-center gap-1">
                  <IconButton
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label={t("table.pagination-prev")}
                    title={t("table.pagination-prev")}
                    disabled={currentPage <= 1}
                  >
                    <ChevronLeft size={18} />
                  </IconButton>
                  <span className="px-2 font-mono text-xs tabular-nums">
                    {currentPage} / {totalPages}
                  </span>
                  <IconButton
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-label={t("table.pagination-next")}
                    title={t("table.pagination-next")}
                    disabled={currentPage >= totalPages}
                  >
                    <ChevronRight size={18} />
                  </IconButton>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function ReferralCodeRow({
  referralCode,
  onRenamed,
  onArchived,
}: {
  referralCode: StardanceReferralCode;
  onRenamed: (updated: StardanceReferralCode) => void;
  onArchived: (archived: StardanceReferralCode) => void;
}) {
  const t = useTranslations("referrals");
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(referralCode.label);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState("");
  const resetCopyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    return () => {
      if (resetCopyRef.current !== null) {
        clearTimeout(resetCopyRef.current);
      }
    };
  }, []);

  async function copyShareUrl() {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(referralCode.shareUrl);
      setCopied(true);
      if (resetCopyRef.current !== null) {
        clearTimeout(resetCopyRef.current);
      }
      resetCopyRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  async function commitRename() {
    const next = draftLabel.trim();

    if (next === "") {
      setRowError(t("errors.label-required"));
      return;
    }

    if (next === referralCode.label) {
      setEditing(false);
      setRowError("");
      return;
    }

    setBusy(true);
    setRowError("");

    try {
      const response = await fetch(`/api/referrals/codes/${referralCode.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: next }),
      });

      const data = await response.json().catch(() => null);
      const payload: Record<string, unknown> | null =
        typeof data === "object" && data !== null && !Array.isArray(data)
          ? Object.fromEntries(Object.entries(data))
          : null;

      if (!response.ok) {
        setRowError(typeof payload?.error === "string" ? payload.error : t("errors.rename-failed"));
        return;
      }

      const updated = payload?.referralCode;

      if (!isReferralCode(updated)) {
        setRowError(t("errors.rename-failed"));
        return;
      }

      onRenamed(updated);
      setEditing(false);
    } catch {
      setRowError(t("errors.rename-failed"));
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (typeof window !== "undefined" && !window.confirm(t("codes.delete-confirm"))) {
      return;
    }

    setBusy(true);
    setRowError("");

    try {
      const response = await fetch(`/api/referrals/codes/${referralCode.id}`, {
        method: "DELETE",
      });

      const data = await response.json().catch(() => null);
      const payload: Record<string, unknown> | null =
        typeof data === "object" && data !== null && !Array.isArray(data)
          ? Object.fromEntries(Object.entries(data))
          : null;

      if (!response.ok) {
        setRowError(
          typeof payload?.error === "string" ? payload.error : t("errors.delete-failed"),
        );
        return;
      }

      const archived = payload?.referralCode;
      if (!isReferralCode(archived)) {
        setRowError(t("errors.delete-failed"));
        return;
      }

      onArchived(archived);
    } catch {
      setRowError(t("errors.delete-failed"));
    } finally {
      setBusy(false);
    }
  }

  const isPrimary = referralCode.kind === "primary";
  const heading = isPrimary ? t("codes.primary-heading") : referralCode.label;

  return (
    <li className="py-4 first:pt-5 last:pb-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1 space-y-1">
          {editing ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                ref={inputRef}
                type="text"
                value={draftLabel}
                onChange={(event) => setDraftLabel(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void commitRename();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setEditing(false);
                    setDraftLabel(referralCode.label);
                    setRowError("");
                  }
                }}
                disabled={busy}
                className="h-10 w-full max-w-sm rounded-md border border-white/10 bg-background px-3 text-base"
              />
              <div className="flex gap-2">
                <Button type="button" size="app-sm" onClick={() => void commitRename()} disabled={busy}>
                  {t("codes.rename-save")}
                </Button>
                <button
                  type="button"
                  data-slot="icon-link"
                  onClick={() => {
                    setEditing(false);
                    setDraftLabel(referralCode.label);
                    setRowError("");
                  }}
                  className="rounded-md px-3 py-1 font-body text-sm text-muted-foreground hover:text-foreground"
                  disabled={busy}
                >
                  {t("codes.rename-cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className={cn("font-body text-base text-white", isPrimary && "font-bold")}>
                {heading}
              </span>
              <span className="font-body text-base text-white">
                <span>{referralCode.code.toLowerCase()}</span>
              </span>
              <span className="font-body text-sm text-muted-foreground">
                {t("codes.uses", { count: referralCode.usesCount })}
              </span>
            </div>
          )}

          {!editing && (
            <p className="break-all font-mono text-xs text-muted-foreground">
              {referralCode.shareUrl}
            </p>
          )}

          {rowError && (
            <p className="font-body text-sm text-primary">{rowError}</p>
          )}
        </div>

        {!editing && (
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              onClick={() => void copyShareUrl()}
              aria-label={t("codes.copy-aria")}
              title={copied ? t("codes.copied") : t("codes.copy")}
              tone={copied ? "success" : "default"}
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </IconButton>
            <IconButton
              onClick={() => {
                setDraftLabel(referralCode.label);
                setEditing(true);
              }}
              aria-label={t("codes.rename-aria")}
              title={t("codes.rename-aria")}
              disabled={busy}
            >
              <Pencil size={18} />
            </IconButton>
            {!isPrimary && (
              <IconButton
                onClick={() => void archive()}
                aria-label={t("codes.delete-aria")}
                title={t("codes.delete-aria")}
                tone="danger"
                disabled={busy}
              >
                <Trash2 size={18} />
              </IconButton>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function ArchivedReferralCodeRow({
  referralCode,
  onRestored,
}: {
  referralCode: StardanceReferralCode;
  onRestored: (restored: StardanceReferralCode) => void;
}) {
  const t = useTranslations("referrals");
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState("");

  async function restore() {
    setBusy(true);
    setRowError("");

    try {
      const response = await fetch(`/api/referrals/codes/${referralCode.id}/restore`, {
        method: "POST",
      });

      const data = await response.json().catch(() => null);
      const payload: Record<string, unknown> | null =
        typeof data === "object" && data !== null && !Array.isArray(data)
          ? Object.fromEntries(Object.entries(data))
          : null;

      if (!response.ok) {
        setRowError(
          typeof payload?.error === "string" ? payload.error : t("errors.restore-failed"),
        );
        return;
      }

      const restored = payload?.referralCode;
      if (!isReferralCode(restored)) {
        setRowError(t("errors.restore-failed"));
        return;
      }

      onRestored(restored);
    } catch {
      setRowError(t("errors.restore-failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-4 first:pt-5 last:pb-5 opacity-70">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="font-body text-base text-white">{referralCode.label}</span>
            <span className="font-body text-base text-white">
              <span aria-hidden>a-</span>
              <span>{referralCode.code.toLowerCase()}</span>
            </span>
            <span className="font-body text-sm text-muted-foreground">
              {t("codes.uses", { count: referralCode.usesCount })}
            </span>
          </div>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {referralCode.shareUrl}
          </p>
          {rowError && (
            <p className="font-body text-sm text-primary">{rowError}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            onClick={() => void restore()}
            aria-label={t("archive.restore-aria")}
            title={t("archive.restore-aria")}
            tone="restore"
            disabled={busy}
          >
            <RotateCcw size={18} />
          </IconButton>
        </div>
      </div>
    </li>
  );
}

function IconButton({
  onClick,
  tone = "default",
  disabled,
  children,
  ...rest
}: {
  onClick: () => void;
  tone?: "default" | "success" | "danger" | "restore";
  disabled?: boolean;
  children: React.ReactNode;
} & Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title">) {
  const toneClass =
    tone === "success"
      ? "text-acceptance"
      : tone === "danger"
        ? "text-muted-foreground hover:text-primary"
        : tone === "restore"
          ? "text-muted-foreground hover:text-acceptance"
          : "text-muted-foreground hover:text-foreground";

  return (
    <button
      type="button"
      data-slot="icon-link"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md bg-transparent transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50",
        toneClass,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-5 py-4 font-body text-xs text-muted-foreground">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-5 py-4 font-body text-sm text-white">
      {children}
    </td>
  );
}
