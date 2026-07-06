"use client";

import Icon from "@hackclub/icons";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  canPlaceAnotherShirtOrder,
  ORDER_STATUS_APPROVED,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_FAILED,
  ORDER_STATUS_PENDING,
  ORDER_STATUS_REJECTED,
  SHIRT_SIZES,
  type ShirtStockBySize,
  type ShirtSize,
} from "@/lib/shop";
import { cn } from "@/lib/utils";

export type ShirtOrderState = {
  id: string;
  status: string;
  size: string | null;
  warehouseUrl: string | null;
  publicOrderUrl: string | null;
  note: string | null;
  dispatchAt: string | null;
};

export type ShirtOrderSectionProps = {
  // Pre-formatted, display-only address labels. The browser never needs the
  // structured address fields (phone number, recipient name, …), so only the
  // label the dropdown renders crosses to the client.
  addressLabels: string[];
  needsAddressRefresh: boolean;
  existingOrder: ShirtOrderState | null;
  requiresOnboarding: boolean;
  onboardingStatus: string;
  onboardingFormUrl: string;
  stockBySize: ShirtStockBySize;
};

export default function ShirtOrderSection(props: ShirtOrderSectionProps) {
  const t = useTranslations("shirt");
  const trimmedExistingOrderNote = props.existingOrder?.note?.trim() ?? "";
  const retryableReason =
    props.existingOrder !== null &&
    !props.requiresOnboarding &&
    canPlaceAnotherShirtOrder(props.existingOrder.status)
      ? trimmedExistingOrderNote !== ""
        ? trimmedExistingOrderNote
        : t("order.no-reason")
      : null;
  const retryableWarning = retryableReason !== null
    ? t("order.retryable-warning", { reason: retryableReason })
    : null;
  const retryableWarningParts = retryableWarning?.split(/(rejected)/i) ?? [];
  return (
    <section>
      <h2 className="font-sub text-2xl font-bold leading-8 text-foreground">
        <span className="text-muted-foreground">II.</span> {t("heading")}
      </h2>
      {retryableWarning !== null ? (
        <p className="mt-4 text-base text-black">
          {retryableWarningParts.map((part, index) =>
            /^rejected$/i.test(part) ? (
              <span key={`${part}-${index}`} className="text-primary">
                {part}
              </span>
            ) : (
              <span key={`${part}-${index}`}>{part}</span>
            ),
          )}
        </p>
      ) : null}
      <ShirtOrderBody {...props} />
    </section>
  );
}

function InlineAuthLink() {
  return (
    <a
      href="https://auth.hackclub.com/addresses"
      target="_blank"
      rel="noreferrer"
      className="!text-acceptance !underline hover:!opacity-80"
    >
      Hack Club Auth
    </a>
  );
}

function NoAddressMessage({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const t = useTranslations("shirt");
  const body = t("no-address.body");
  const linkLabel = "Hack Club Auth";
  const [beforeLink, afterLink = ""] = body.split(linkLabel);

  return (
    <div className="border border-[var(--primary)]/40 bg-[var(--primary)]/10 p-4">
      <p className="font-body text-sm leading-relaxed text-foreground">
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            {beforeLink}
            <InlineAuthLink />
            {afterLink}
          </span>
          <RefreshAddressButton
            onRefresh={onRefresh}
            refreshing={refreshing}
          />
        </span>
      </p>
    </div>
  );
}

function ShirtOrderBody({
  addressLabels,
  needsAddressRefresh,
  existingOrder,
  requiresOnboarding,
  onboardingFormUrl,
  stockBySize,
}: ShirtOrderSectionProps) {
  const t = useTranslations("shirt");
  const router = useRouter();
  const refreshAddressesHref = "/api/auth/refresh?next=%2Fdashboard";
  useAddressRefreshRedirect(needsAddressRefresh);
  useAddressReturnRefresh(addressLabels.length === 0 && !existingOrder && !requiresOnboarding);
  const [size, setSize] = useState<ShirtSize>(
    existingOrder?.size === "S" ||
      existingOrder?.size === "M" ||
      existingOrder?.size === "L" ||
      existingOrder?.size === "XL"
      ? existingOrder.size
      : "M",
  );
  const [addressIndex, setAddressIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [refreshingAddresses, setRefreshingAddresses] = useState(false);
  const [error, setError] = useState("");
  const order = existingOrder;
  const canPlaceOrder = !order || canPlaceAnotherShirtOrder(order.status);
  const hasLiveStock = SHIRT_SIZES.some((shirtSize) => stockBySize[shirtSize] !== null);
  const availableSizes = SHIRT_SIZES.filter((shirtSize) => {
    const stock = stockBySize[shirtSize];
    return stock === null || stock > 0;
  });
  const hasAvailableSizes = availableSizes.length > 0;

  useEffect(() => {
    if (availableSizes.includes(size)) {
      return;
    }

    const fallbackSize = availableSizes[0];
    if (fallbackSize !== undefined) {
      setSize(fallbackSize);
    }
  }, [availableSizes, size]);

  const handleRefreshAddresses = async () => {
    if (refreshingAddresses) {
      return;
    }

    if (needsAddressRefresh) {
      window.location.assign(refreshAddressesHref);
      return;
    }

    setRefreshingAddresses(true);

    try {
      const res = await fetch("/api/hca/addresses/refresh", {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const payload: Record<string, unknown> | null =
          typeof data === "object" && data !== null && !Array.isArray(data)
            ? Object.fromEntries(Object.entries(data))
            : null;

        if (payload?.error === "reauth_required") {
          window.location.assign(refreshAddressesHref);
          return;
        }

        window.alert(t("errors.refresh-failed-alert"));
        return;
      }

      router.refresh();
    } catch {
      window.alert(t("errors.refresh-failed-alert"));
    } finally {
      setRefreshingAddresses(false);
    }
  };

  const surfaceClass = cn(
    "ui-input-surface h-14 w-full !rounded-none border-0 px-4 text-base focus-visible:ring-1 focus-visible:ring-foreground/15",
    "disabled:cursor-not-allowed disabled:text-foreground/50",
  );
  const readOnlySurfaceClass = cn(
    surfaceClass,
    "text-foreground disabled:opacity-100 disabled:text-foreground disabled:[-webkit-text-fill-color:var(--foreground)]",
  );
  const selectContentClass =
    "!rounded-none border-foreground/10 bg-background text-foreground !duration-0 !data-open:animate-none !data-closed:animate-none !data-[side=bottom]:translate-y-0 !data-[side=top]:translate-y-0 !data-[side=left]:translate-x-0 !data-[side=right]:translate-x-0";

  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/shirt/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size, addressIndex }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      } else {
        const data = await res.json().catch(() => null);
        const payload: Record<string, unknown> | null =
          typeof data === "object" && data !== null && !Array.isArray(data)
            ? Object.fromEntries(Object.entries(data))
            : null;
        setError(
          payload?.error === "no_address"
            ? t("errors.no-address")
            : payload?.error === "not_ambassador"
              ? t("errors.not-ambassador")
              : payload?.error === "onboarding_incomplete"
                ? t("errors.onboarding-incomplete")
                : payload?.error === "out_of_stock"
                  ? t("errors.out-of-stock", { size })
                : payload?.error === "unauthorized"
                ? t("errors.refresh-addresses")
                  : payload?.error === "already_ordered"
                  ? t("errors.already-ordered")
                    : payload?.error === "invalid_size"
                    ? t("errors.invalid-size")
                      : t("errors.generic"),
        );
      }
    } catch {
      setError(t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  if (order && !canPlaceOrder) {
    return (
      <div className="mt-4">
        <LatestOrderCard order={order} />
      </div>
    );
  }

  if (requiresOnboarding) {
    return (
      <p className="mt-4 font-body text-base text-foreground">
        {t.rich("onboarding.body", {
          link: (chunks) => (
            <a
              href={onboardingFormUrl}
              target="_blank"
              rel="noreferrer"
              className="!text-primary !underline hover:!opacity-80"
            >
              {chunks}
            </a>
          ),
        })}
      </p>
    );
  }

  if (needsAddressRefresh && !order) {
    return (
      <div className="mt-4 space-y-4">
        <p className="font-body text-base text-foreground">{t("refresh-addresses.body")}</p>
        <a href={refreshAddressesHref} className={buttonVariants({ size: "app" })}>
          {t("refresh-addresses.cta")}
        </a>
      </div>
    );
  }

  if (addressLabels.length === 0 && !order) {
    return (
      <div className="mt-4">
        <NoAddressMessage
          onRefresh={handleRefreshAddresses}
          refreshing={refreshingAddresses}
        />
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-8">
      {addressLabels.length === 0 ? (
        needsAddressRefresh ? (
          <div className="space-y-4">
            <p className="font-body text-base text-foreground">{t("refresh-addresses.body")}</p>
            <a href={refreshAddressesHref} className={buttonVariants({ size: "app" })}>
              {t("refresh-addresses.cta")}
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            <NoAddressMessage
              onRefresh={handleRefreshAddresses}
              refreshing={refreshingAddresses}
            />
          </div>
        )
      ) : (
        <>
          <div>
            <label className="mb-2 block font-body text-base tracking-wide text-foreground">
              {t("labels.size")}
            </label>
            <div className="grid grid-cols-4 gap-2">
              {SHIRT_SIZES.map((shirtSize) => {
                const active = shirtSize === size;
                const stock = stockBySize[shirtSize];
                const outOfStock = stock !== null && stock <= 0;
                return (
                  <Button
                    key={shirtSize}
                    type="button"
                    onClick={() => setSize(shirtSize)}
                    disabled={outOfStock}
                    variant="destructive"
                    size="app"
                    selected={active}
                    className={cn(
                      "h-14 w-full !rounded-none font-body text-base tracking-wide shadow-none",
                      "flex-col gap-0.5 leading-tight disabled:opacity-50",
                      !active && "bg-primary !text-white hover:opacity-100",
                    )}
                  >
                    <span>{shirtSize}</span>
                    {stock !== null ? (
                      <span className="text-[11px] font-body">
                        {outOfStock ? t("stock.out") : t("stock.left", { count: stock })}
                      </span>
                    ) : null}
                  </Button>
                );
              })}
            </div>
            {hasLiveStock && !hasAvailableSizes ? (
              <p className="mt-2 font-body text-sm text-primary">{t("stock.none")}</p>
            ) : null}
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <label className="block font-body text-base tracking-wide text-foreground">
                {t("labels.shipping-address")}
              </label>
              <RefreshAddressButton
                onRefresh={handleRefreshAddresses}
                refreshing={refreshingAddresses}
              />
            </div>
            {addressLabels.length === 1 ? (
              <Input
                type="text"
                disabled
                value={addressLabels[0]}
                className={readOnlySurfaceClass}
              />
            ) : (
              <Select
                value={String(addressIndex)}
                onValueChange={(value) => setAddressIndex(Number(value))}
              >
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
                  side="bottom"
                  sideOffset={0}
                  avoidCollisions={false}
                  className={selectContentClass}
                >
                  {addressLabels.map((label, index) => (
                    <SelectItem
                      key={index}
                      value={String(index)}
                      className="focus:bg-card focus:text-foreground"
                    >
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="mt-1 text-right">
              <ExternalArrowLink
                href="https://auth.hackclub.com/addresses"
                label={t("manage-addresses")}
              />
            </div>
          </div>

          {error ? <p className="font-body text-base text-primary">{error}</p> : null}

          <div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || (hasLiveStock && !hasAvailableSizes)}
              className={buttonVariants({ size: "app" })}
            >
              {submitting ? t("actions.placing") : t("actions.place")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function useAddressRefreshRedirect(needsAddressRefresh: boolean) {
  useEffect(() => {
    const storageKey = "shirt-address-refresh-attempted";

    if (!needsAddressRefresh) {
      window.sessionStorage.removeItem(storageKey);
      return;
    }

    if (window.sessionStorage.getItem(storageKey) === "1") {
      return;
    }

    window.sessionStorage.setItem(storageKey, "1");
    window.location.assign("/api/auth/refresh?next=%2Fdashboard");
  }, [needsAddressRefresh]);
}

function useAddressReturnRefresh(enabled: boolean) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let lastRefreshAt = 0;
    const refreshThrottleMs = 1500;

    const refresh = () => {
      if (document.visibilityState === "hidden") {
        return;
      }

      const now = Date.now();
      if (now - lastRefreshAt < refreshThrottleMs) {
        return;
      }

      lastRefreshAt = now;
      router.refresh();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        refresh();
      }
    };

    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, router]);
}

function LatestOrderCard({ order }: { order: ShirtOrderState }) {
  const t = useTranslations("shirt");
  const approvedTrackingUrl = order.publicOrderUrl ?? order.warehouseUrl;
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");

  if (order.status === ORDER_STATUS_APPROVED) {
    return (
      <div>
        <p className="font-body text-base text-muted-foreground">
          {approvedTrackingUrl !== null ? (
            t.rich("order.approved-message", {
              link: (chunks) => (
                <a
                  href={approvedTrackingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="!text-primary !underline hover:!opacity-80"
                >
                  {chunks}
                </a>
              ),
            })
          ) : (
            t("order.approved-message-no-link")
          )}
        </p>
      </div>
    );
  }

  if (order.status === ORDER_STATUS_PENDING) {
    return (
      <PendingOrderCard
        order={order}
        cancelling={cancelling}
        cancelError={cancelError}
        onCancel={async () => {
          if (cancelling) return;
          if (!window.confirm(t("order.cancel-confirm"))) return;
          setCancelling(true);
          setCancelError("");
          try {
            const res = await fetch(`/api/shirt/orders/${order.id}/cancel`, {
              method: "POST",
            });
            if (res.ok) {
              window.location.reload();
              return;
            }
            const data = await res.json().catch(() => null);
            const payload: Record<string, unknown> | null =
              typeof data === "object" && data !== null && !Array.isArray(data)
                ? Object.fromEntries(Object.entries(data))
                : null;
            setCancelError(
              payload?.error === "embargo_expired"
                ? t("order.cancel-too-late")
                : payload?.error === "not_cancellable"
                  ? t("order.cancel-not-cancellable")
                  : t("errors.generic"),
            );
          } catch {
            setCancelError(t("errors.generic"));
          } finally {
            setCancelling(false);
          }
        }}
      />
    );
  }

  const title =
    order.status === ORDER_STATUS_REJECTED
        ? t("order.rejected-title")
        : order.status === ORDER_STATUS_FAILED
          ? t("order.failed-title")
          : t("order.cancelled-title");
  const body =
    order.status === ORDER_STATUS_REJECTED
        ? t("order.rejected-body")
        : order.status === ORDER_STATUS_FAILED
          ? t("order.failed-body")
          : t("order.cancelled-body");

  return (
    <div>
      <h3 className="font-sub text-2xl text-foreground">{title}</h3>
      <p className="mt-2 font-body text-base text-muted-foreground">{body}</p>

      {(order.status === ORDER_STATUS_REJECTED ||
        order.status === ORDER_STATUS_FAILED ||
        order.status === ORDER_STATUS_CANCELLED) &&
      order.note !== null && order.note !== "" ? (
        <p className="mt-3 font-body text-sm text-primary">{order.note}</p>
      ) : null}

      {order.warehouseUrl !== null || order.publicOrderUrl !== null ? (
        <div className="mt-6 flex flex-wrap gap-3">
          {order.warehouseUrl !== null ? (
            <a
              href={order.warehouseUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ size: "app" })}
            >
              {t("order.track-cta")}
            </a>
          ) : null}
          {order.publicOrderUrl !== null ? (
            <a
              href={order.publicOrderUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ size: "app" })}
            >
              {t("order.public-cta")}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PendingOrderCard({
  order,
  cancelling,
  cancelError,
  onCancel,
}: {
  order: ShirtOrderState;
  cancelling: boolean;
  cancelError: string;
  onCancel: () => void | Promise<void>;
}) {
  const t = useTranslations("shirt");
  const dispatchAt = order.dispatchAt;
  const now = useNow(1000);
  const dispatchDate = dispatchAt !== null ? new Date(dispatchAt) : null;
  const dispatchValid = dispatchDate !== null && !Number.isNaN(dispatchDate.getTime());
  const remainingMs = dispatchValid ? dispatchDate!.getTime() - now : 0;
  const withinEmbargo = !dispatchValid || remainingMs > 0;

  return (
    <div>
      {withinEmbargo ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="font-body text-base leading-relaxed text-muted-foreground md:text-lg">
            {t("order.pending-hint")}
          </p>
          <button
            type="button"
            data-slot="text-link"
            onClick={onCancel}
            disabled={cancelling}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 appearance-none border-0 bg-transparent p-0 font-body text-sm text-primary underline underline-offset-2 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon glyph="forbidden" size={16} />
            {cancelling ? t("order.cancel-pending") : t("order.cancel-cta")}
          </button>
        </div>
      ) : (
        <p className="font-body text-base leading-relaxed text-foreground md:text-lg">
          {t("order.pending-dispatching")}
        </p>
      )}
      {cancelError !== "" ? (
        <p className="mt-2 font-body text-sm text-primary">{cancelError}</p>
      ) : null}
    </div>
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function RefreshAddressButton({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void | Promise<void>;
  refreshing: boolean;
}) {
  return (
    <button
      type="button"
      data-slot="icon-link"
      aria-label="Refresh addresses"
      disabled={refreshing}
      onClick={onRefresh}
      className="-m-2.5 inline-flex shrink-0 cursor-pointer items-center justify-center appearance-none border-0 bg-transparent p-2.5 text-foreground outline-none transition-colors hover:text-acceptance focus-visible:text-acceptance disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon glyph="view-reload" size={18} />
    </button>
  );
}

function ExternalArrowLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center !text-primary !underline hover:!opacity-80"
    >
      <span>{label} ↗</span>
    </a>
  );
}
