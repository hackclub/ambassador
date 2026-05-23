"use client";

import Icon from "@hackclub/icons";
import { Check, ChevronDown, Pencil, Search, SwitchCamera, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PosterCampaignSummary } from "@/lib/posters/config";
import {
  formatPosterStyle,
  parsePosterStyle,
  type PosterStyle,
  type PosterStyleBase,
  type PosterVerificationStatus,
} from "@/lib/posters/types";
import { cn } from "@/lib/utils";

type PaperSize = "letter" | "a4";
type ColorMode = "color" | "bw";

const REGION_DEFAULT_VALUE = "__default__";

function toPosterStyleBase(size: PaperSize, color: ColorMode): PosterStyleBase {
  if (size === "a4" && color === "bw") return "a4_bw";
  if (size === "a4") return "a4";
  if (color === "bw") return "bw";
  return "color";
}

function paperSizeForBase(base: PosterStyleBase): PaperSize {
  return base === "a4" || base === "a4_bw" ? "a4" : "letter";
}

function colorModeForBase(base: PosterStyleBase): ColorMode {
  return base === "bw" || base === "a4_bw" || base === "printer_efficient" ? "bw" : "color";
}

function toPosterStyle(
  size: PaperSize,
  color: ColorMode,
  regionCode: string | null,
): PosterStyle {
  return formatPosterStyle(toPosterStyleBase(size, color), regionCode);
}

function variantLabel(color: ColorMode, regionName: string | null) {
  const base = color === "color" ? "Color" : "B&W";
  return regionName === null ? base : `${base} (${regionName})`;
}

function formatPosterCode(code: string) {
  const normalized = code.trim().toLowerCase();
  return /^[a-z0-9]{5}$/.test(normalized) ? `a-${normalized}` : code;
}

function canDeletePoster(poster: ClientPoster) {
  return poster.verification_status !== "success" && poster.scanCount === 0;
}

type ClientPoster = {
  id: string;
  referral_code: string;
  poster_type: PosterStyle;
  verification_status: PosterVerificationStatus;
  campaign_slug: string;
  poster_group_id: string | null;
  location_description: string | null;
  name: string | null;
  scanCount: number;
};

type ClientPosterGroup = {
  id: string;
  name: string | null;
  campaign_slug: string;
  poster_count: number;
  posters: ClientPoster[];
};

type ClientPosterData = {
  groups: ClientPosterGroup[];
  standalonePosters: ClientPoster[];
};

type ScanResult = {
  status:
    | "success"
    | "auto_matched"
    | "already_verified"
    | "in_review"
    | "no_qr"
    | "no_match";
  detectedQrCodes: string[];
  message: string;
  verifiedPoster: {
    name: string | null;
    referralCode: string;
    groupName: string | null;
  } | null;
};

type GeoState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "ok"; latitude: number; longitude: number; accuracy: number }
  | { kind: "error"; message: string };

type VerifyTarget =
  | { kind: "poster"; poster: ClientPoster }
  | { kind: "group"; group: ClientPosterGroup };

const POSTER_STYLES: PosterStyle[] = ["color", "bw", "a4", "a4_bw"];
const PAPER_SIZE_LABELS: Record<PaperSize, string> = {
  letter: "Letter",
  a4: "A4",
};
const SUPPORTED_PROOF_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".heic", ".heif", ".webp"];
const SUPPORTED_PROOF_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const SUPPORTED_PROOF_IMAGE_FORMATS = "PNG, JPG, HEIC, WebP";

function parseGroupSizeInput(value: string) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

function clampGroupSize(parsed: number | null) {
  if (parsed === null) return 0;
  return Math.max(0, Math.min(20, parsed));
}

function clampGroupSizeInput(value: string) {
  return clampGroupSize(parseGroupSizeInput(value));
}

function clampPosterAddCountInput(value: string, remaining: number) {
  return Math.max(1, Math.min(remaining, clampGroupSizeInput(value)));
}

function isSupportedProofImage(file: File) {
  const type = file.type.trim().toLowerCase();
  if (type && SUPPORTED_PROOF_IMAGE_MIME_TYPES.has(type)) {
    return true;
  }

  const name = file.name.trim().toLowerCase();
  return SUPPORTED_PROOF_IMAGE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

export function PostersClient({
  campaigns,
  initialCampaignSlug,
  initialData,
  defaultPaperSize,
  defaultRegionCode,
}: {
  campaigns: PosterCampaignSummary[];
  initialCampaignSlug: string | null;
  initialData: ClientPosterData;
  defaultPaperSize: PaperSize;
  defaultRegionCode: string | null;
}) {
  const t = useTranslations("posters");
  const router = useRouter();
  const data = initialData;
  const [campaignSlug, setCampaignSlug] = useState<string | null>(initialCampaignSlug);
  const [paperSize, setPaperSizeState] = useState<PaperSize>(defaultPaperSize);
  const [colorMode, setColorModeState] = useState<ColorMode>("color");
  const [regionCode, setRegionCodeState] = useState<string | null>(defaultRegionCode);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const storedSize = window.localStorage.getItem("posters:paperSize");
      if (storedSize === "letter" || storedSize === "a4") {
        setPaperSizeState(storedSize);
      }
      const storedColor = window.localStorage.getItem("posters:colorMode");
      if (storedColor === "color" || storedColor === "bw") {
        setColorModeState(storedColor);
      }
      const storedRegion = window.localStorage.getItem("posters:regionCode");
      if (storedRegion !== null && storedRegion !== "" && storedRegion !== REGION_DEFAULT_VALUE) {
        setRegionCodeState(storedRegion);
      }
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }, []);

  const setPaperSize = useCallback((next: PaperSize) => {
    setPaperSizeState(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("posters:paperSize", next);
      } catch {
        // ignore
      }
    }
  }, []);

  const setColorMode = useCallback((next: ColorMode) => {
    setColorModeState(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("posters:colorMode", next);
      } catch {
        // ignore
      }
    }
  }, []);

  const setRegionCode = useCallback((next: string | null) => {
    setRegionCodeState(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("posters:regionCode", next ?? "");
      } catch {
        // ignore
      }
    }
  }, []);
  const [posterName, setPosterName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupSizeInput, setGroupSizeInput] = useState("3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<VerifyTarget | null>(null);
  const [showGroups, setShowGroups] = useState(true);

  const campaign = useMemo(
    () => campaigns.find((c) => c.slug === campaignSlug) ?? null,
    [campaigns, campaignSlug],
  );
  const availableStyles = campaign?.styles ?? POSTER_STYLES;
  const availableStyleSet = useMemo(() => new Set<PosterStyle>(availableStyles), [availableStyles]);
  const campaignRegions = useMemo(() => campaign?.regions ?? [], [campaign]);

  const parsedStyles = useMemo(
    () =>
      availableStyles.flatMap((style) => {
        const parsed = parsePosterStyle(style);
        return parsed === null ? [] : [parsed];
      }),
    [availableStyles],
  );

  const availableSizes = useMemo<PaperSize[]>(() => {
    const sizes = new Set<PaperSize>();
    for (const { base } of parsedStyles) {
      sizes.add(paperSizeForBase(base));
    }
    return [...sizes];
  }, [parsedStyles]);

  const selectedPaperSize = availableSizes.includes(paperSize)
    ? paperSize
    : availableSizes[0] ?? "letter";

  const availableVariants = useMemo<VariantOption[]>(() => {
    const present = new Set<string>();
    for (const { base, region } of parsedStyles) {
      if (paperSizeForBase(base) !== selectedPaperSize) continue;
      const variantColor = colorModeForBase(base);
      present.add(`${variantColor}|${region ?? ""}`);
    }
    const englishOptions: VariantOption[] = [];
    const regionalOptions: VariantOption[] = [];

    for (const color of ["color", "bw"] as ColorMode[]) {
      if (present.has(`${color}|`)) {
        englishOptions.push({
          key: `${color}|`,
          colorMode: color,
          regionCode: null,
          regionName: null,
          label: variantLabel(color, null),
        });
      }
    }
    for (const region of campaignRegions) {
      for (const color of ["color", "bw"] as ColorMode[]) {
        if (present.has(`${color}|${region.code}`)) {
          regionalOptions.push({
            key: `${color}|${region.code}`,
            colorMode: color,
            regionCode: region.code,
            regionName: region.name,
            label: variantLabel(color, region.name),
          });
        }
      }
    }
    return [...englishOptions, ...regionalOptions];
  }, [parsedStyles, campaignRegions, selectedPaperSize]);

  const activeVariantKey = `${colorMode}|${regionCode ?? ""}`;
  const selectedVariant = availableVariants.find((v) => v.key === activeVariantKey) ?? availableVariants[0] ?? null;
  const variantExists = selectedVariant?.key === activeVariantKey;

  useEffect(() => {
    if (!availableSizes.includes(paperSize)) {
      setPaperSizeState(availableSizes[0] ?? "letter");
    }
  }, [availableSizes, paperSize]);

  useEffect(() => {
    if (availableVariants.length === 0) return;
    if (!variantExists) {
      const fallback = availableVariants[0];
      setColorModeState(fallback.colorMode);
      setRegionCodeState(fallback.regionCode);
    }
  }, [availableVariants, variantExists]);

  const effectiveColorMode = selectedVariant?.colorMode ?? colorMode;
  const effectiveRegionCode = selectedVariant?.regionCode ?? null;
  const selectedPosterType = toPosterStyle(selectedPaperSize, effectiveColorMode, effectiveRegionCode);
  const posterType = availableStyleSet.has(selectedPosterType)
    ? selectedPosterType
    : availableStyles[0] ?? "color";
  const posterPreviewUrl = campaign?.previewUrls[posterType] ?? null;

  const refresh = useCallback(async () => {
    router.refresh();
  }, [router]);

  const createPoster = useCallback(async () => {
    if (campaignSlug === null) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/posters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaignSlug,
          posterType,
          name: posterName.trim() || null,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      setPosterName("");
      await refresh();
    } catch {
      setError(t("errors.create-failed"));
    } finally {
      setBusy(false);
    }
  }, [campaignSlug, posterName, posterType, refresh, t]);

  const createGroup = useCallback(async () => {
    if (campaignSlug === null) return;
    const count = clampGroupSizeInput(groupSizeInput);
    setGroupSizeInput(String(count));
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/poster-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaignSlug,
          posterType,
          count,
          name: groupName.trim() || null,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      setGroupName("");
      setGroupSizeInput("3");
      await refresh();
    } catch {
      setError(t("errors.create-failed"));
    } finally {
      setBusy(false);
    }
  }, [campaignSlug, posterType, groupSizeInput, groupName, refresh, t]);

  const addPostersToGroup = useCallback(async (groupId: string, count: number) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/poster-groups/${groupId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      await refresh();
    } catch {
      setError(t("errors.create-failed"));
    } finally {
      setBusy(false);
    }
  }, [refresh, t]);

  const handleVerified = useCallback(async () => {
    setVerifyTarget(null);
    await refresh();
  }, [refresh]);

  const allPosters = [
    ...data.standalonePosters,
    ...data.groups.flatMap((g) => g.posters),
  ];
  const pendingPosters = allPosters.filter((p) => p.verification_status === "pending");
  const verifiedCount = allPosters.filter((p) => p.verification_status === "success").length;
  const totalPosters = allPosters.length;

  const [draggingPosterId, setDraggingPosterId] = useState<string | null>(null);
  const movePoster = useCallback(
    async (posterId: string, targetGroupId: string | null) => {
      try {
        await movePosterRequest(posterId, targetGroupId);
        await refresh();
      } catch {
        setError(t("errors.move-failed"));
      }
    },
    [refresh, t],
  );
  const dragContextValue = useMemo<PosterDragContextValue>(
    () => ({
      draggingPosterId,
      beginDrag: (id) => setDraggingPosterId(id),
      endDrag: () => setDraggingPosterId(null),
      onMovePoster: movePoster,
    }),
    [draggingPosterId, movePoster],
  );

  return (
    <PosterDragContext.Provider value={dragContextValue}>
    <div className="space-y-10 pb-16">
      {error !== null ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      {/* Scan prompts */}
      {pendingPosters.length > 0 && (
        <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <p className="font-sub text-lg text-foreground">
              {t("scan-prompt.title", { count: pendingPosters.length })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("scan-prompt.body")}
            </p>
          </div>
          <Button
            size="app-sm"
            className="self-start sm:self-auto"
            onClick={() => {
              const group = data.groups.find((g) => g.posters.some((p) => p.verification_status === "pending"));
              if (group) {
                setVerifyTarget({ kind: "group", group });
              } else {
                const poster = data.standalonePosters.find((p) => p.verification_status === "pending");
                if (poster) setVerifyTarget({ kind: "poster", poster });
              }
            }}
          >
            {t("scan-prompt.cta")}
          </Button>
        </section>
      )}

      {totalPosters > 0 && verifiedCount === totalPosters && (
        <section>
          <p className="text-sm text-acceptance">All {totalPosters} poster{totalPosters !== 1 ? "s" : ""} verified ✓</p>
        </section>
      )}

      {/* Create */}
      <section>
        <h2 className="font-sub text-2xl text-foreground">{t("sections.new")}</h2>
        <div className="mt-5">
          <CreateSection
            campaigns={campaigns}
            campaignSlug={campaignSlug}
            setCampaignSlug={setCampaignSlug}
            availableSizes={availableSizes}
            availableVariants={availableVariants}
            paperSize={selectedPaperSize}
            setPaperSize={setPaperSize}
            colorMode={effectiveColorMode}
            setColorMode={setColorMode}
            regionCode={effectiveRegionCode}
            setRegionCode={setRegionCode}
            posterType={posterType}
            posterPreviewUrl={posterPreviewUrl}
            posterName={posterName}
            setPosterName={setPosterName}
            groupName={groupName}
            setGroupName={setGroupName}
            groupSizeInput={groupSizeInput}
            setGroupSizeInput={setGroupSizeInput}
            busy={busy}
            groupCount={data.groups.length}
            createPoster={createPoster}
            createGroup={createGroup}
          />
        </div>
      </section>

      {/* Your posters (groups + ungrouped) */}
      {(data.groups.length > 0 || data.standalonePosters.length > 0) && (
        <section>
          <button
            type="button"
            data-slot="open-link"
            onClick={() => setShowGroups((open) => !open)}
            className="group inline-flex items-center gap-2 bg-transparent p-0 text-left"
            aria-expanded={showGroups}
          >
            <span className="font-sub text-2xl text-foreground">{t("sections.yours")}</span>
            <ChevronDown
              size={20}
              className={cn(
                "text-muted-foreground transition-transform duration-150 group-hover:text-foreground",
                showGroups && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {showGroups && (
            <div className="mt-4 space-y-3">
              {data.groups.map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  busy={busy}
                  onAddPosters={(count) => addPostersToGroup(group.id, count)}
                  onRefresh={refresh}
                />
              ))}
              {data.standalonePosters.length > 0 && (
                <UngroupedCard
                  posters={data.standalonePosters}
                  onRefresh={refresh}
                />
              )}
            </div>
          )}
        </section>
      )}

      {verifyTarget ? (
        <VerifyModal
          onClose={() => setVerifyTarget(null)}
          onDone={handleVerified}
        />
      ) : null}
    </div>
    </PosterDragContext.Provider>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center justify-between text-sm text-primary">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} className="ml-3 text-primary/80 hover:text-primary">
        ✕
      </button>
    </div>
  );
}

async function renamePosterGroupRequest(groupId: string, name: string | null) {
  const response = await fetch(`/api/poster-groups/${groupId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function deletePosterGroupRequest(groupId: string) {
  const response = await fetch(`/api/poster-groups/${groupId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

function GroupCard({
  group,
  busy,
  onAddPosters,
  onRefresh,
}: {
  group: ClientPosterGroup;
  busy: boolean;
  onAddPosters: (count: number) => void;
  onRefresh: () => void;
}) {
  const t = useTranslations("posters");
  const [addCountInput, setAddCountInput] = useState("1");
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(group.name ?? "");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const pendingCount = group.posters.filter((p) => p.verification_status === "pending").length;
  const verifiedCount = group.posters.filter((p) => p.verification_status === "success").length;
  const scanCount = group.posters.reduce((total, poster) => total + poster.scanCount, 0);
  const hasVerifiedPosters = group.posters.some((poster) => poster.verification_status === "success");
  const canDeleteGroup = !hasVerifiedPosters && scanCount === 0;
  const remaining = Math.max(0, 20 - group.posters.length);
  const displayName = group.name !== null && group.name.trim() !== "" ? group.name : t("groups.unnamed");
  const { hover, isDragging, dropHandlers } = useDropTarget(group.id);
  const groupFull = group.posters.length >= 20;
  const trimmedAddCountInput = addCountInput.trim();
  const parsedAddCountInput = parseGroupSizeInput(addCountInput);
  const addCountNeedsCorrection =
    trimmedAddCountInput !== "" &&
    (parsedAddCountInput === null || parsedAddCountInput < 1 || parsedAddCountInput > remaining);
  const correctedAddCount = clampPosterAddCountInput(addCountInput, remaining);

  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);

  async function commitGroupRename() {
    const next = draftName.trim();
    if (next === (group.name ?? "")) {
      setEditingName(false);
      setRenameError(null);
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      await renamePosterGroupRequest(group.id, next === "" ? null : next);
      setEditingName(false);
      onRefresh();
    } catch {
      setRenameError(t("errors.rename-group-failed"));
    } finally {
      setRenameBusy(false);
    }
  }

  function cancelGroupRename() {
    setEditingName(false);
    setDraftName(group.name ?? "");
    setRenameError(null);
  }

  async function deleteGroup() {
    if (!window.confirm(t("actions.delete-group-confirm", { name: displayName }))) {
      return;
    }
    setDeleteBusy(true);
    setRenameError(null);
    try {
      await deletePosterGroupRequest(group.id);
      onRefresh();
    } catch {
      setRenameError(t("errors.delete-group-failed"));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div
      {...dropHandlers}
      className={cn(
        "rounded-lg border border-foreground/10 bg-card p-4 transition-colors",
        isDragging && !groupFull && "border-dashed border-foreground/30",
        hover && !groupFull && "border-solid border-primary/60 bg-primary/5",
        isDragging && groupFull && "opacity-60",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {editingName ? (
            <PosterRenameControls
              inputRef={nameInputRef}
              draftName={draftName}
              setDraftName={setDraftName}
              busy={renameBusy}
              placeholder={t("actions.rename-group-placeholder")}
              ariaLabel={t("actions.rename-group", { name: displayName })}
              onCommit={() => void commitGroupRename()}
              onCancel={cancelGroupRename}
            />
          ) : (
            <h3 className="font-body text-base font-medium text-foreground">
              {displayName}
            </h3>
          )}
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("groups.count", { count: group.poster_count })}
            {verifiedCount > 0 && <> · <span className="text-acceptance">{verifiedCount} verified</span></>}
            {pendingCount > 0 && <> · <span className="text-accent">{pendingCount} pending</span></>}
            {scanCount > 0 && <> · {scanCount} referral{scanCount === 1 ? "" : "s"}</>}
          </p>
          {renameError !== null ? (
            <p className="mt-1 text-xs text-primary">{renameError}</p>
          ) : null}
        </div>
        {!editingName && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a
            href={`/api/poster-groups/${group.id}/pdf`}
            data-slot="icon-link"
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon glyph="download" size={20} />
            <span className="sm:hidden">PDF</span>
            <span className="hidden sm:inline">Download group (PDF)</span>
          </a>
          <a
            href={`/api/poster-groups/${group.id}/zip`}
            data-slot="icon-link"
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon glyph="download" size={20} />
            <span className="sm:hidden">ZIP</span>
            <span className="hidden sm:inline">Download group (ZIP)</span>
          </a>
          <button
            type="button"
            data-slot="icon-link"
            onClick={() => {
              setDraftName(group.name ?? "");
              setEditingName(true);
              setRenameError(null);
            }}
            aria-label={t("actions.rename-group", { name: displayName })}
            title={t("actions.rename-group", { name: displayName })}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 bg-transparent p-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Pencil size={16} />
            {t("actions.rename")}
          </button>
          {canDeleteGroup ? (
            <button
              type="button"
              data-slot="icon-link"
              onClick={() => void deleteGroup()}
              disabled={deleteBusy}
              aria-label={t("actions.delete-group", { name: displayName })}
              title={t("actions.delete-group", { name: displayName })}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 bg-transparent p-0 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 size={16} />
              {t("actions.delete")}
            </button>
          ) : null}
        </div>
        )}
      </div>

      {remaining > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 pb-6">
          <div className="relative w-16 flex-none">
            <label htmlFor={`group-add-count-${group.id}`} className="sr-only">
              {t("group-card.add-count-label")}
            </label>
            <Input
              id={`group-add-count-${group.id}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={addCountInput}
              onChange={(event) => setAddCountInput(event.target.value)}
              onBlur={(event) => setAddCountInput(String(clampPosterAddCountInput(event.currentTarget.value, remaining)))}
              aria-invalid={addCountNeedsCorrection ? "true" : "false"}
              aria-describedby={`group-add-count-help-${group.id}`}
              className="w-full"
            />
            <p
              id={`group-add-count-help-${group.id}`}
              className={cn(
                "pointer-events-none absolute left-0 top-full mt-1 whitespace-nowrap text-xs",
                addCountNeedsCorrection ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {addCountNeedsCorrection
                ? t("group-card.add-invalid", { remaining, count: correctedAddCount })
                : t("group-card.add-help", { remaining })}
            </p>
          </div>
          <Button
            type="button"
            size="app-sm"
            onClick={() => {
              const count = clampPosterAddCountInput(addCountInput, remaining);
              setAddCountInput(String(count));
              onAddPosters(count);
            }}
            disabled={busy}
          >
            {t("group-card.add-button", { remaining })}
          </Button>
        </div>
      ) : null}

      <ul className="mt-4 space-y-0 border-l border-foreground/15">
        {group.posters.map((poster) => (
          <PosterTreeItem
            key={poster.id}
            poster={poster}
            onRefresh={onRefresh}
          />
        ))}
      </ul>
    </div>
  );
}

function UngroupedCard({
  posters,
  onRefresh,
}: {
  posters: ClientPoster[];
  onRefresh: () => void;
}) {
  const t = useTranslations("posters");
  const { hover, isDragging, dropHandlers } = useDropTarget(UNGROUPED_DROP_TARGET);
  return (
    <div
      {...dropHandlers}
      className={cn(
        "rounded-lg border border-dashed border-foreground/15 bg-card p-4 transition-colors",
        isDragging && "border-foreground/30",
        hover && "border-solid border-primary/60 bg-primary/5",
      )}
    >
      <div className="flex flex-col gap-1">
        <h3 className="font-body text-base font-medium text-foreground">
          {t("sections.ungrouped")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("groups.count", { count: posters.length })}
        </p>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {posters.map((poster) => (
          <PosterRow
            key={poster.id}
            poster={poster}
            onRefresh={onRefresh}
          />
        ))}
      </ul>
    </div>
  );
}

async function renamePosterRequest(posterId: string, name: string | null) {
  const response = await fetch(`/api/posters/${posterId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function deletePosterRequest(posterId: string) {
  const response = await fetch(`/api/posters/${posterId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function movePosterRequest(posterId: string, groupId: string | null) {
  const response = await fetch(`/api/posters/${posterId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ groupId }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

const POSTER_DRAG_MIME = "application/x-poster-id";
const UNGROUPED_DROP_TARGET = "__standalone__";

type PosterDragContextValue = {
  draggingPosterId: string | null;
  beginDrag: (posterId: string) => void;
  endDrag: () => void;
  onMovePoster: (posterId: string, targetGroupId: string | null) => Promise<void>;
};

const PosterDragContext = createContext<PosterDragContextValue | null>(null);

function usePosterDrag() {
  const ctx = useContext(PosterDragContext);
  if (!ctx) throw new Error("PosterDragContext is missing");
  return ctx;
}

function useDropTarget(targetId: string) {
  const { draggingPosterId, onMovePoster, endDrag } = usePosterDrag();
  const [hover, setHover] = useState(false);

  const isDragging = draggingPosterId !== null;
  const groupId = targetId === UNGROUPED_DROP_TARGET ? null : targetId;

  const dropHandlers = {
    onDragOver: (event: React.DragEvent) => {
      if (!isDragging) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (!hover) setHover(true);
    },
    onDragEnter: (event: React.DragEvent) => {
      if (!isDragging) return;
      event.preventDefault();
      setHover(true);
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!isDragging) return;
      const related = event.relatedTarget as Node | null;
      if (related && (event.currentTarget as Node).contains(related)) return;
      setHover(false);
    },
    onDrop: (event: React.DragEvent) => {
      if (!isDragging) return;
      event.preventDefault();
      const posterId = event.dataTransfer.getData(POSTER_DRAG_MIME) || draggingPosterId;
      setHover(false);
      endDrag();
      if (posterId === null || posterId === "") return;
      void onMovePoster(posterId, groupId);
    },
  };

  return { hover, isDragging, dropHandlers };
}

function usePosterDragHandle(posterId: string) {
  const { beginDrag, endDrag, draggingPosterId } = usePosterDrag();
  const isDragging = draggingPosterId === posterId;

  return {
    isDragging,
    handleProps: {
      draggable: true,
      onDragStart: (event: React.DragEvent) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(POSTER_DRAG_MIME, posterId);
        beginDrag(posterId);
      },
      onDragEnd: () => endDrag(),
    },
  };
}

function PosterRenameControls({
  inputRef,
  draftName,
  setDraftName,
  busy,
  placeholder,
  ariaLabel,
  onCommit,
  onCancel,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  draftName: string;
  setDraftName: (value: string) => void;
  busy: boolean;
  placeholder: string;
  ariaLabel: string;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("posters");

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input
        ref={inputRef}
        type="text"
        value={draftName}
        onChange={(event) => setDraftName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={busy}
        className="h-9 w-full max-w-sm"
      />
      <div className="flex gap-2">
        <Button
          type="button"
          size="app-sm"
          onClick={onCommit}
          disabled={busy}
        >
          {t("actions.rename-save")}
        </Button>
        <button
          type="button"
          data-slot="icon-link"
          onClick={onCancel}
          disabled={busy}
          className="cursor-pointer bg-transparent px-2 py-1 text-sm text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("actions.rename-cancel")}
        </button>
      </div>
    </div>
  );
}

function PosterTreeItem({
  poster,
  onRefresh,
}: {
  poster: ClientPoster;
  onRefresh: () => void;
}) {
  const t = useTranslations("posters");
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(poster.name ?? "");
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { isDragging, handleProps } = usePosterDragHandle(poster.id);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const statusColor: Record<PosterVerificationStatus, string> = {
    pending: "text-accent",
    in_review: "text-accent",
    success: "text-acceptance",
    rejected: "text-primary",
    digital: "text-muted-foreground",
  };

  const prefix = poster.verification_status === "success" ? "✓ " : poster.verification_status === "rejected" ? "✕ " : "";
  const displayCode = formatPosterCode(poster.referral_code);
  const title = poster.name ?? displayCode;

  async function commitRename() {
    const next = draftName.trim();
    if (next === (poster.name ?? "")) {
      setEditing(false);
      setRowError(null);
      return;
    }
    setBusy(true);
    setRowError(null);
    try {
      await renamePosterRequest(poster.id, next === "" ? null : next);
      setEditing(false);
      onRefresh();
    } catch {
      setRowError(t("errors.rename-failed"));
    } finally {
      setBusy(false);
    }
  }

  function cancelRename() {
    setEditing(false);
    setDraftName(poster.name ?? "");
    setRowError(null);
  }

  async function deletePoster() {
    if (!window.confirm(t("actions.delete-poster-confirm", { code: displayCode }))) {
      return;
    }
    setBusy(true);
    setRowError(null);
    try {
      await deletePosterRequest(poster.id);
      onRefresh();
    } catch {
      setRowError(t("errors.delete-failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      id={`poster-${poster.id}`}
      className={cn(
        "pl-4 transition-opacity",
        isDragging && "opacity-40",
      )}
      {...(!editing ? handleProps : {})}
    >
      <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex min-w-0 flex-1 items-center gap-2">
          <span
            className="absolute -left-4 top-1/2 h-px w-3 bg-foreground/15"
            aria-hidden
          />
          {!editing && (
            <span
              aria-hidden
              className="cursor-grab select-none text-muted-foreground/60 active:cursor-grabbing"
              title={t("actions.move-poster", { code: displayCode })}
            >
              <Icon glyph="move" size={16} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {editing ? (
              <PosterRenameControls
                inputRef={inputRef}
                draftName={draftName}
                setDraftName={setDraftName}
                busy={busy}
                placeholder={t("actions.rename-placeholder")}
                ariaLabel={t("actions.rename-poster", { code: displayCode })}
                onCommit={() => void commitRename()}
                onCancel={cancelRename}
              />
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="truncate text-sm font-medium text-foreground">{title}</span>
                {poster.name !== null ? (
                  <span className={cn("font-mono text-xs", statusColor[poster.verification_status])}>
                    {prefix}{displayCode}
                  </span>
                ) : null}
                {poster.scanCount > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {poster.scanCount} referral{poster.scanCount === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
            )}
            {rowError !== null ? (
              <p className="mt-1 text-xs text-primary">{rowError}</p>
            ) : null}
          </div>
        </div>

        {!editing && (
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={`/api/posters/${poster.id}/pdf`}
              data-slot="icon-link"
              className="inline-flex size-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
              aria-label={`Download poster ${displayCode}`}
              title={`Download poster ${displayCode}`}
            >
              <Icon glyph="download" size={17} />
            </a>
            <button
              type="button"
              data-slot="icon-link"
              onClick={() => {
                setDraftName(poster.name ?? "");
                setEditing(true);
                setRowError(null);
              }}
              className="inline-flex size-7 cursor-pointer items-center justify-center bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={t("actions.rename-poster", { code: displayCode })}
              title={t("actions.rename-poster", { code: displayCode })}
            >
              <Pencil size={16} />
            </button>
            {canDeletePoster(poster) ? (
              <button
                type="button"
                data-slot="icon-link"
                onClick={() => void deletePoster()}
                disabled={busy}
                className="inline-flex size-7 cursor-pointer items-center justify-center bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={t("actions.delete-poster", { code: displayCode })}
                title={t("actions.delete-poster", { code: displayCode })}
              >
                <Trash2 size={17} strokeWidth={2} />
              </button>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

function PosterRow({
  poster,
  onRefresh,
}: {
  poster: ClientPoster;
  onRefresh: () => void;
}) {
  const t = useTranslations("posters");
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(poster.name ?? "");
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { isDragging, handleProps } = usePosterDragHandle(poster.id);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const statusColor: Record<PosterVerificationStatus, string> = {
    pending: "text-accent",
    in_review: "text-accent",
    success: "text-acceptance",
    rejected: "text-primary",
    digital: "text-muted-foreground",
  };
  const displayCode = formatPosterCode(poster.referral_code);
  const title = poster.name ?? displayCode;

  async function commitRename() {
    const next = draftName.trim();
    if (next === (poster.name ?? "")) {
      setEditing(false);
      setRowError(null);
      return;
    }
    setBusy(true);
    setRowError(null);
    try {
      await renamePosterRequest(poster.id, next === "" ? null : next);
      setEditing(false);
      onRefresh();
    } catch {
      setRowError(t("errors.rename-failed"));
    } finally {
      setBusy(false);
    }
  }

  function cancelRename() {
    setEditing(false);
    setDraftName(poster.name ?? "");
    setRowError(null);
  }

  async function deletePoster() {
    if (!window.confirm(
  t("actions.delete-poster-confirm", {
    name: poster.name ?? displayCode,
    code: displayCode,
  }),
)) {
      return;
    }
    setBusy(true);
    setRowError(null);
    try {
      await deletePosterRequest(poster.id);
      onRefresh();
    } catch {
      setRowError(t("errors.delete-failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      id={`poster-${poster.id}`}
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-3 transition-opacity",
        isDragging && "opacity-40",
      )}
      {...(!editing ? handleProps : {})}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {!editing && (
          <span
            aria-hidden
            className="cursor-grab select-none text-muted-foreground/60 active:cursor-grabbing"
            title={t("actions.move-poster", { code: displayCode })}
          >
            <Icon glyph="move" size={16} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <PosterRenameControls
              inputRef={inputRef}
              draftName={draftName}
              setDraftName={setDraftName}
              busy={busy}
              placeholder={t("actions.rename-placeholder")}
              ariaLabel={t("actions.rename-poster", { code: displayCode })}
              onCommit={() => void commitRename()}
              onCancel={cancelRename}
            />
          ) : (
            <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
              <span className="truncate text-sm font-medium text-foreground">{title}</span>
              {poster.name !== null ? (
                <span className="font-mono text-xs text-muted-foreground">{displayCode}</span>
              ) : null}
              <span className={cn("text-xs", statusColor[poster.verification_status])}>
                {t(`status.${poster.verification_status}`)}
              </span>
              {poster.scanCount > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {poster.scanCount} referral{poster.scanCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
          )}
          {rowError !== null ? (
            <p className="mt-1 text-xs text-primary">{rowError}</p>
          ) : null}
        </div>
      </div>

      {!editing && (
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={`/api/posters/${poster.id}/pdf`}
            data-slot="icon-link"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icon glyph="download" size={20} />
            {t("actions.download")}
          </a>
          <button
            type="button"
            data-slot="icon-link"
            onClick={() => {
              setDraftName(poster.name ?? "");
              setEditing(true);
              setRowError(null);
            }}
            className="inline-flex cursor-pointer items-center gap-1.5 bg-transparent p-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t("actions.rename-poster", { code: displayCode })}
            title={t("actions.rename-poster", { code: displayCode })}
          >
            <Pencil size={16} />
            {t("actions.rename")}
          </button>
          {canDeletePoster(poster) ? (
            <button
              type="button"
              data-slot="icon-link"
              onClick={() => void deletePoster()}
              disabled={busy}
              aria-label={t("actions.delete-poster", { code: displayCode })}
              title={t("actions.delete-poster", { code: displayCode })}
              className="inline-flex cursor-pointer items-center gap-1.5 bg-transparent p-0 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 size={16} />
              {t("actions.delete")}
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}

type VariantOption = {
  key: string;
  colorMode: ColorMode;
  regionCode: string | null;
  regionName: string | null;
  label: string;
};

function CreateSection({
  campaigns,
  campaignSlug,
  setCampaignSlug,
  availableSizes,
  availableVariants,
  paperSize,
  setPaperSize,
  colorMode,
  setColorMode,
  regionCode,
  setRegionCode,
  posterType,
  posterPreviewUrl,
  posterName,
  setPosterName,
  groupName,
  setGroupName,
  groupSizeInput,
  setGroupSizeInput,
  busy,
  groupCount,
  createPoster,
  createGroup,
}: {
  campaigns: PosterCampaignSummary[];
  campaignSlug: string | null;
  setCampaignSlug: (value: string) => void;
  availableSizes: PaperSize[];
  availableVariants: VariantOption[];
  paperSize: PaperSize;
  setPaperSize: (value: PaperSize) => void;
  colorMode: ColorMode;
  setColorMode: (value: ColorMode) => void;
  regionCode: string | null;
  setRegionCode: (value: string | null) => void;
  posterType: PosterStyle;
  posterPreviewUrl: string | null;
  posterName: string;
  setPosterName: (value: string) => void;
  groupName: string;
  setGroupName: (value: string) => void;
  groupSizeInput: string;
  setGroupSizeInput: (value: string) => void;
  busy: boolean;
  groupCount: number;
  createPoster: () => void;
  createGroup: () => void;
}) {
  const t = useTranslations("posters");
  const trimmedGroupSizeInput = groupSizeInput.trim();
  const parsedGroupSizeInput = parseGroupSizeInput(groupSizeInput);
  const groupSizeNeedsCorrection =
    trimmedGroupSizeInput !== "" &&
    (parsedGroupSizeInput === null || parsedGroupSizeInput < 0 || parsedGroupSizeInput > 20);
  const correctedGroupSize = clampGroupSize(parsedGroupSizeInput);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_11rem] lg:items-start">
      <div className="space-y-5">
        {/* Campaign + format options */}
        <div className="flex flex-wrap items-end gap-5">
          {campaigns.length > 1 && (
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground">{t("campaign.label")}</label>
              {campaigns.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("campaign.empty")}</p>
              ) : (
                <Select value={campaignSlug ?? undefined} onValueChange={setCampaignSlug}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder={t("campaign.placeholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {campaigns.map((c) => (
                      <SelectItem key={c.slug} value={c.slug}>
                        {c.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {availableSizes.length > 1 && (
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground">Paper size</label>
              <Select value={paperSize} onValueChange={(value) => setPaperSize(value as PaperSize)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  className="w-[var(--radix-select-trigger-width)] min-w-0"
                >
                  {availableSizes.map((size) => (
                    <SelectItem key={size} value={size}>
                      {PAPER_SIZE_LABELS[size]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {availableVariants.length > 1 && (
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground">Variant</label>
              <VariantCombobox
                value={`${colorMode}|${regionCode ?? ""}`}
                options={availableVariants}
                onChange={(option) => {
                  setColorMode(option.colorMode);
                  setRegionCode(option.regionCode);
                }}
              />
            </div>
          )}
        </div>

        {/* Create actions */}
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-foreground font-medium">Single poster</p>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap sm:justify-end">
              <Input
                value={posterName}
                onChange={(event) => setPosterName(event.target.value)}
                placeholder="Poster name"
                className="flex-[1_1_13rem] sm:w-64 sm:flex-none"
              />
              <Button
                size="app-sm"
                className="w-32"
                onClick={createPoster}
                disabled={busy || campaignSlug === null}
              >
                {t("actions.create-poster")}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-foreground font-medium shrink-0">Poster group</p>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap sm:justify-end">
              <div className="relative w-16 flex-none">
                <label htmlFor="group-size-input" className="sr-only">
                  {t("groups.size-label")}
                </label>
                <Input
                  id="group-size-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={groupSizeInput}
                  onChange={(event) => setGroupSizeInput(event.target.value)}
                  onBlur={(event) => setGroupSizeInput(String(clampGroupSizeInput(event.currentTarget.value)))}
                  aria-invalid={groupSizeNeedsCorrection ? "true" : "false"}
                  aria-describedby="group-size-help"
                  className="w-full"
                />
                <p
                  id="group-size-help"
                  className={cn(
                    "pointer-events-none absolute left-0 top-full mt-1 whitespace-nowrap text-xs",
                    groupSizeNeedsCorrection ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {groupSizeNeedsCorrection
                    ? t("groups.size-invalid", { count: correctedGroupSize })
                    : t("groups.size-help")}
                </p>
              </div>
              <Input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Group name"
                className="flex-[1_1_13rem] sm:w-64 sm:flex-none"
              />
              <Button
                size="app-sm"
                className="w-32"
                onClick={createGroup}
                disabled={busy || campaignSlug === null || groupName.trim() === "" || groupCount >= 300}
                title={groupCount >= 300 ? "You can have at most 300 poster groups." : undefined}
              >
                {t("actions.create-group")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {posterPreviewUrl !== null ? (
        <PosterPreview url={posterPreviewUrl} posterType={posterType} />
      ) : null}
    </div>
  );
}

function VariantCombobox({
  value,
  options,
  onChange,
}: {
  value: string;
  options: VariantOption[];
  onChange: (option: VariantOption) => void;
}) {
  const [open, setOpenState] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (!next) setQuery("");
  }, []);

  const active = options.find((o) => o.key === value) ?? null;
  const trimmedQuery = query.trim().toLowerCase();
  const filtered =
    trimmedQuery === ""
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(trimmedQuery));

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="select-trigger"
          data-size="default"
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex h-9 w-56 cursor-pointer items-center justify-between gap-1.5 rounded-none border border-transparent bg-input/50 px-3 py-2 text-sm text-foreground whitespace-nowrap outline-none transition-[color,box-shadow,background-color] select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <span className="truncate">{active?.label ?? ""}</span>
          <ChevronDown size={16} className="opacity-50" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] gap-0 rounded-none p-0"
      >
        <div className="relative p-2">
          <Search
            size={14}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search variants"
            aria-label="Search variants"
            className="h-8 rounded-none pl-7 text-sm"
          />
        </div>
        <ul role="listbox" className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-3 py-1.5 text-xs text-muted-foreground">No matches</li>
          ) : (
            filtered.map((option) => {
              const selected = option.key === value;
              return (
                <li key={option.key}>
                  <button
                    type="button"
                    role="option"
                    data-slot="select-item"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(option);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-between gap-2 bg-transparent px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-foreground/8 focus:bg-foreground/8 focus:outline-none",
                      selected && "font-medium",
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {selected ? <Check size={14} aria-hidden /> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function PosterPreview({ url, posterType }: { url: string; posterType: PosterStyle }) {
  const label = posterType === "a4" || posterType === "a4_bw" ? "A4 poster preview" : "Letter poster preview";

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">Preview</p>
      <div className="overflow-hidden rounded-lg border border-foreground/10 bg-card">
        <Image
          src={url}
          alt={label}
          width={900}
          height={posterType === "a4" || posterType === "a4_bw" ? 1273 : 1165}
          className="block h-auto w-full bg-background"
          sizes="(max-width: 1024px) 11rem, 176px"
        />
      </div>
    </div>
  );
}

function useGeolocation(enabled: boolean) {
  const t = useTranslations("posters");
  const [state, setState] = useState<GeoState>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);
  const geolocation = typeof navigator === "undefined" ? null : navigator.geolocation;
  const unavailableState: GeoState = { kind: "error", message: t("errors.geolocation-unavailable") };

  const retry = useCallback(() => {
    setState({ kind: "pending" });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (geolocation === null) return;

    let cancelled = false;

    const watchId = geolocation.watchPosition(
      (position) => {
        if (cancelled) return;
        setState({
          kind: "ok",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (err) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            err.code === err.PERMISSION_DENIED ? t("errors.geolocation-denied") : err.message,
        });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );

    return () => {
      cancelled = true;
      geolocation.clearWatch(watchId);
    };
  }, [enabled, attempt, geolocation, t]);

  const resolvedState: GeoState = !enabled
    ? { kind: "idle" }
    : geolocation === null
      ? unavailableState
      : state.kind === "idle"
        ? { kind: "pending" }
        : state;

  return { state: resolvedState, start: retry };
}

function VerifyModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("posters");
  const { state: geoState, start: retryGeo } = useGeolocation(true);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCapture = useCallback(
    async (nextFile: File | null) => {
      if (!nextFile) return;
      if (geoState.kind !== "ok") {
        setError(t("verify-modal.location-error"));
        return;
      }
      if (!isSupportedProofImage(nextFile)) {
        setError(t("errors.invalid-image-format", { formats: SUPPORTED_PROOF_IMAGE_FORMATS }));
        return;
      }
      setError(null);
      setSubmitting(true);
      try {
        const formData = new FormData();
        formData.append("proof", nextFile);
        formData.append("latitude", String(geoState.latitude));
        formData.append("longitude", String(geoState.longitude));
        formData.append("locationAccuracy", String(geoState.accuracy));

        const response = await fetch("/api/posters/scan", { method: "POST", body: formData });
        const data = await response.json().catch(() => null);
        const payload: Record<string, unknown> | null =
          typeof data === "object" && data !== null && !Array.isArray(data)
            ? Object.fromEntries(Object.entries(data))
            : null;
        if (!response.ok) {
          throw new Error(t("errors.upload-failed"));
        }
        const status = payload?.status;
        const detectedQrCodes = Array.isArray(payload?.detectedQrCodes)
          ? payload.detectedQrCodes.filter((code): code is string => typeof code === "string")
          : null;
        const message = payload?.message;
        if (
          status !== "success" &&
          status !== "auto_matched" &&
          status !== "already_verified" &&
          status !== "in_review" &&
          status !== "no_qr" &&
          status !== "no_match"
        ) {
          throw new Error(t("errors.upload-failed"));
        }
        if (detectedQrCodes === null || typeof message !== "string") {
          throw new Error(t("errors.upload-failed"));
        }
        if (status === "no_qr") {
          setError(t("errors.no-qr"));
          return;
        }
        const verifiedPosterRaw = payload?.verifiedPoster;
        const verifiedPoster =
          verifiedPosterRaw !== null &&
          typeof verifiedPosterRaw === "object" &&
          !Array.isArray(verifiedPosterRaw) &&
          typeof (verifiedPosterRaw as Record<string, unknown>).referralCode === "string"
            ? {
                name:
                  typeof (verifiedPosterRaw as Record<string, unknown>).name === "string"
                    ? ((verifiedPosterRaw as Record<string, unknown>).name as string)
                    : null,
                referralCode: (verifiedPosterRaw as Record<string, unknown>).referralCode as string,
                groupName:
                  typeof (verifiedPosterRaw as Record<string, unknown>).groupName === "string"
                    ? ((verifiedPosterRaw as Record<string, unknown>).groupName as string)
                    : null,
              }
            : null;
        setResult({ status, detectedQrCodes, message, verifiedPoster });
      } catch {
        setError(t("errors.upload-failed"));
      } finally {
        setSubmitting(false);
      }
    },
    [geoState, t],
  );

  const step: "location" | "capture" | "processing" | "done" =
    result !== null
      ? "done"
      : submitting
        ? "processing"
        : geoState.kind === "ok"
          ? "capture"
          : "location";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        className="dark-surface relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-[#0a0a0a] ring-1 ring-white/10 shadow-2xl sm:rounded-2xl"
        style={{ color: "#fff" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-white/5 px-5 pb-4 pt-5">
          <div className="min-w-0">
            <p className="text-sm text-[color:#ffffffcc]">
              {t("verify-modal.eyebrow")}
            </p>
            <h3 className="mt-1 font-sub text-xl leading-tight text-[#fff] sm:text-2xl">
              {t("verify-modal.title")}
            </h3>
          </div>
          <button
            type="button"
            data-slot="icon-link"
            onClick={onClose}
            className="-mr-1 -mt-1 shrink-0 rounded-lg p-2 text-[color:#ffffff99] transition-colors hover:bg-white/10 hover:text-[#fff]"
            aria-label={t("actions.cancel")}
          >
            <Icon glyph="view-close-small" size={20} />
          </button>
        </div>

        {/* Step indicator */}
        {step !== "done" && (
          <div className="flex gap-1.5 px-5 pt-4">
            <StepBar active={true} done={geoState.kind === "ok"} />
            <StepBar active={step === "capture" || step === "processing"} done={submitting || result !== null} />
            <StepBar active={step === "processing"} done={false} />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:py-6">
          {result ? (
            <ResultView result={result} />
          ) : submitting ? (
            <ProcessingView />
          ) : geoState.kind !== "ok" ? (
            <LocationStep state={geoState} onRetry={retryGeo} />
          ) : (
            <CaptureStep
              onCapture={handleCapture}
              error={error}
            />
          )}
        </div>

        {/* Footer */}
        {result !== null && (
          <div className="border-t border-white/5 px-5 pb-5 pt-3 sm:pb-6">
            <Button
              size="app"
              className="w-full"
              onClick={() => {
                setResult(null);
                onDone();
              }}
            >
              Done
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function StepBar({ active, done }: { active: boolean; done: boolean }) {
  return (
    <div
      className={cn(
        "h-1 flex-1 rounded-full transition-colors",
        done ? "bg-[#16a34a]" : active ? "bg-[#fff]" : "bg-white/15",
      )}
    />
  );
}

function LocationStep({ state, onRetry }: { state: GeoState; onRetry: () => void }) {
  const t = useTranslations("posters");

  if (state.kind === "error") {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="font-sub text-lg text-[#fff]">Allow location access</p>
          <p className="text-sm leading-relaxed text-[color:#ffffff99]">{state.message}</p>
        </div>
        <Button size="app" className="w-full" onClick={onRetry}>
          {t("verify-modal.location-retry")} →
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5">
        <span className="size-2 animate-pulse rounded-full bg-[#fff]" />
        <span className="text-xs text-[color:#ffffffcc]">Acquiring precise location…</span>
      </div>
      <p className="text-sm leading-relaxed text-[color:#ffffff99]">
        Approve the location prompt in your browser. We need it to confirm where this poster was put up.
      </p>
    </div>
  );
}

function CaptureStep({
  onCapture,
  error,
}: {
  onCapture: (file: File) => void;
  error: string | null;
}) {
  const t = useTranslations("posters");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;

    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setStreamError(t("capture.camera-unavailable"));
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
          setReady(true);
        }
        if (navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (active) {
            setHasMultipleCameras(devices.filter((d) => d.kind === "videoinput").length > 1);
          }
        }
      } catch {
        if (!active) return;
        setStreamError(t("capture.camera-denied"));
      }
    }

    void start();

    return () => {
      active = false;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [t, facingMode]);

  function takePhoto() {
    const video = videoRef.current;
    if (!video) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `poster-${Date.now()}.jpg`, { type: "image/jpeg" });
        onCapture(file);
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <p className="font-sub text-lg text-[#fff]">{t("capture.title")}</p>
        <p className="text-sm leading-relaxed text-[color:#ffffff99]">
          {t("capture.body")}
        </p>
      </div>

      <div className="relative overflow-hidden rounded-lg bg-black ring-1 ring-white/10">
        <video
          ref={videoRef}
          playsInline
          muted
          className="block aspect-[3/4] w-full bg-black object-cover"
        />
        {hasMultipleCameras && (
          <button
            type="button"
            data-slot="icon-link"
            onClick={() =>
              setFacingMode((current) => (current === "environment" ? "user" : "environment"))
            }
            aria-label={t("capture.flip-camera")}
            title={t("capture.flip-camera")}
            className="absolute right-3 top-3 inline-flex size-10 cursor-pointer items-center justify-center text-white transition-opacity hover:opacity-90"
          >
            <SwitchCamera size={20} />
          </button>
        )}
      </div>

      {streamError !== null ? (
        <p className="text-sm text-[#ff8b9a]">{streamError}</p>
      ) : (
        <Button size="app" className="w-full" onClick={takePhoto} disabled={!ready}>
          <Icon glyph="photo-fill" size={18} />
          {t("capture.capture-button")}
        </Button>
      )}

      {error !== null && (
        <p className="text-sm text-[#ff8b9a]">{error}</p>
      )}
    </div>
  );
}

function ProcessingView() {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-full border-2 border-white/15 border-t-[#fff] [animation:spin_0.9s_linear_infinite]" />
      <div className="space-y-1">
        <p className="font-sub text-lg text-[#fff]">Reading the QR code…</p>
        <p className="text-sm text-[color:#ffffff99]">This usually takes a second.</p>
      </div>
    </div>
  );
}

function ResultView({ result }: { result: ScanResult }) {
  const t = useTranslations("posters");
  const isSuccess =
    result.status === "success" ||
    result.status === "auto_matched" ||
    result.status === "already_verified";
  const isReview = result.status === "in_review";
  const tone = isSuccess ? "success" : isReview ? "review" : "fail";
  const toneClass =
    tone === "success"
      ? "text-[#7ee2a3]"
      : tone === "review"
        ? "text-[#ffbf71]"
        : "text-[#ff8b9a]";
  const glyph = tone === "success" ? "checkbox-checked" : tone === "review" ? "clock-fill" : "view-close";

  const verified = result.verifiedPoster;
  const displayName =
    verified !== null
      ? verified.name ?? formatPosterCode(verified.referralCode)
      : null;

  return (
    <div className="flex flex-col items-start gap-3 py-2 text-left">
      <span className={cn("inline-flex", toneClass)}>
        <Icon glyph={glyph} size={36} />
      </span>
      <div className="space-y-1">
        <p className="font-sub text-xl text-[#fff]">{t(`results.${result.status}`)}</p>
        {isSuccess && displayName !== null ? (
          <p className="text-sm leading-relaxed text-[color:#ffffff99]">
            Verified poster <span className="font-semibold text-[#fff]">{displayName}</span>
            {verified?.groupName ? (
              <>
                {" "}of poster group <span className="font-semibold text-[#fff]">{verified.groupName}</span>
              </>
            ) : null}
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-[color:#ffffff99]">{result.message}</p>
        )}
      </div>
    </div>
  );
}
