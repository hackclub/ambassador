"use client";

import { Lock } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  resolveAmbassadorRegion,
  SUPPORTED_AMBASSADOR_REGIONS,
  type AmbassadorRegion,
} from "@/lib/settings";

export default function SettingsClient({
  displayName,
  email,
  firstName,
  lastName,
  slackName,
  verificationStatus,
  currentRegion,
  detectedRegions,
}: {
  displayName: string;
  email: string;
  firstName: string;
  lastName: string;
  slackName: string;
  verificationStatus: string;
  currentRegion: string | null;
  detectedRegions: Array<string | null>;
}) {
  const t = useTranslations("settings.form");
  const [region, setRegion] = useState<AmbassadorRegion>(() =>
    resolveAmbassadorRegion(currentRegion, ...detectedRegions),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const surfaceClass = cn(
    "ui-input-surface h-14 w-full !rounded-none border-0 px-4 text-base focus-visible:ring-1 focus-visible:ring-foreground/15",
    "disabled:cursor-not-allowed disabled:text-foreground/50",
  );
  const readOnlySurfaceClass = cn(
    surfaceClass,
    "text-foreground disabled:opacity-100 disabled:text-foreground disabled:[-webkit-text-fill-color:var(--foreground)]",
  );
  const selectContentClass = "!rounded-none border-foreground/10 bg-background text-foreground !duration-0 !data-open:animate-none !data-closed:animate-none !data-[side=bottom]:translate-y-0 !data-[side=top]:translate-y-0 !data-[side=left]:translate-x-0 !data-[side=right]:translate-x-0";

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ambassadorRegion: region,
        }),
      });
      if (res.ok) {
        setSaved(true);
      } else {
        const data = await res.json().catch(() => null);
        const payload: Record<string, unknown> | null =
          typeof data === "object" && data !== null && !Array.isArray(data)
            ? Object.fromEntries(Object.entries(data))
            : null;
        setError(
          payload?.error === "invalid_region"
            ? t("errors.invalid-region")
            : payload?.error === "unauthorized"
              ? t("errors.unauthorized")
              : t("errors.generic"),
        );
      }
    } catch {
      setError(t("errors.generic"));
    } finally {
      setSaving(false);
    }
  };

  const authHint = t("labels.auth-hint");

  return (
    <div className="mt-8 space-y-6">
      <div>
        <LockedLabel text={t("labels.name")} hint={authHint} />
        <Input
          type="text"
          disabled
          value={displayName}
          className={readOnlySurfaceClass}
        />
      </div>

      {(firstName || lastName) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <LockedLabel text={t("labels.first-name")} hint={authHint} />
            <Input
              type="text"
              disabled
              value={firstName}
              className={readOnlySurfaceClass}
            />
          </div>
          <div>
            <LockedLabel text={t("labels.last-name")} hint={authHint} />
            <Input
              type="text"
              disabled
              value={lastName}
              className={readOnlySurfaceClass}
            />
          </div>
        </div>
      )}

      <div>
        <LockedLabel text={t("labels.email")} hint={authHint} />
        <Input
          type="email"
          disabled
          value={email}
          className={readOnlySurfaceClass}
        />
      </div>

      {slackName && (
        <div>
          <LockedLabel text={t("labels.slack")} hint={authHint} />
          <Input
            type="text"
            disabled
            value={slackName}
            className={readOnlySurfaceClass}
          />
        </div>
      )}

      {verificationStatus && (
        <div>
          <LockedLabel text={t("labels.verification-status")} hint={authHint} />
          <Input
            type="text"
            disabled
            value={verificationStatus}
            className={readOnlySurfaceClass}
          />
        </div>
      )}

      <hr className="border-foreground/10" />

      <div>
        <label className="mb-2 block font-body text-base tracking-wide text-foreground">
          {t("labels.region")}
        </label>
        <Select value={region} onValueChange={(value) => setRegion(resolveAmbassadorRegion(value))}>
          <SelectTrigger
            className={cn(
              surfaceClass,
              "!h-14 !bg-muted data-[state=open]:!bg-muted/80",
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            position="popper"
            side="top"
            sideOffset={0}
            avoidCollisions={false}
            className={cn("max-h-72", selectContentClass)}
          >
            {SUPPORTED_AMBASSADOR_REGIONS.map((regionName) => (
              <SelectItem
                key={regionName}
                value={regionName}
                className="focus:bg-card focus:text-foreground"
              >
                {regionName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <p className="font-body text-base text-primary">{error}</p>
      )}

      <div className="border-t border-foreground/10 pt-5">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={buttonVariants({ size: "app" })}
        >
          {saving ? t("actions.saving") : saved ? t("actions.saved") : t("actions.save")}
        </button>
      </div>
    </div>
  );
}

function LockedLabel({ text, hint }: { text: string; hint: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="mb-2 flex items-center gap-1.5 font-body text-base tracking-wide text-foreground">
      {text}
      <span className="relative inline-flex">
        {/* A real button (not just hover) so the hint is reachable by tap/focus on touch devices, not only mouse hover. */}
        <button
          type="button"
          onMouseEnter={() => setShow(true)}
          onMouseLeave={() => setShow(false)}
          onFocus={() => setShow(true)}
          onBlur={() => setShow(false)}
          onClick={() => setShow((prev) => !prev)}
          aria-label={hint}
          className="-m-1.5 inline-flex cursor-help items-center justify-center p-1.5"
        >
          <Lock size={14} className="text-foreground/40" />
        </button>
        {show && (
          <span
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-56 max-w-[80vw] -translate-x-1/2 !rounded-none px-3 py-2 font-body text-xs"
            style={{ backgroundColor: "#000", color: "#fff" }}
          >
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}
