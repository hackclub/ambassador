"use client";

import { useState, useTransition, type FormEvent } from "react";
import Icon from "@hackclub/icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AmbassadorExpedition } from "@/lib/expeditions";

type Props = {
  initialExpeditions: AmbassadorExpedition[];
  canSubmit: boolean;
};

function displayTitle(expedition: AmbassadorExpedition) {
  return expedition.prettyName || expedition.name || "Untitled expedition";
}

function displayLocation(expedition: AmbassadorExpedition) {
  return [
    expedition.venue.name,
    expedition.venue.city,
    expedition.venue.state,
    expedition.venue.country,
  ].filter(Boolean).join(", ");
}

export function StardanceExpeditionsSection({
  initialExpeditions,
  canSubmit,
}: Props) {
  const [expeditions, setExpeditions] = useState(initialExpeditions);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isPending, startTransition] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    setError("");
    setSuccess("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/stardance/expeditions/submissions", {
          method: "POST",
          body: formData,
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          setError(
            typeof data?.error === "string"
              ? data.error
              : "Could not submit that expedition.",
          );
          return;
        }

        if (data?.expedition) {
          setExpeditions((current) => [data.expedition, ...current]);
        }
        form.reset();
        setSuccess("Expedition submitted for review.");
      } catch {
        setError("Could not submit that expedition.");
        return;
      }
    });
  };

  return (
    <section>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-sub text-2xl font-bold leading-8 text-foreground">
            <span className="text-muted-foreground">III.</span> Stardance Expeditions
          </h2>
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">
            A Stardance Expedition isn&rsquo;t anything big like a Campfire or a Daydream.
            It&rsquo;s just you and some Hack Clubbers from your city hanging out and making
            projects! This is not a formal event.
          </p>
        </div>
        <Icon glyph="map-pin" size={28} className="mt-1 shrink-0 text-primary" aria-hidden />
      </div>

      {canSubmit ? (
        <form onSubmit={submit} className="mt-5 space-y-4 border border-foreground/15 bg-foreground/[0.03] p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-foreground">
              Title
              <Input name="title" required placeholder="Rooftop build night + boba" className="mt-1" />
            </label>
            <label className="block text-sm font-medium text-foreground">
              Date and time
              <Input name="startsAt" type="datetime-local" required className="mt-1" />
            </label>
            <label className="block text-sm font-medium text-foreground">
              Venue name
              <Input name="venueName" placeholder="Rooftop Deck" className="mt-1" />
            </label>
            <label className="block text-sm font-medium text-foreground">
              City
              <Input name="venueCity" required placeholder="Palo Alto" className="mt-1" />
            </label>
            <label className="block text-sm font-medium text-foreground md:col-span-2">
              Address
              <Input name="venueAddress" required placeholder="420 University Ave" className="mt-1" />
            </label>
            <label className="block text-sm font-medium text-foreground">
              State / region
              <Input name="venueState" placeholder="CA" className="mt-1" />
            </label>
            <label className="block text-sm font-medium text-foreground">
              ZIP / postal code
              <Input name="venueZip" placeholder="94301" className="mt-1" />
            </label>
            <label className="block text-sm font-medium text-foreground md:col-span-2">
              Google Maps URL
              <Input name="googleMapsUrl" type="url" placeholder="https://maps.google.com/..." className="mt-1" />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Submitting..." : "Submit expedition"}
            </Button>
            {success ? <p className="text-sm font-medium text-acceptance">{success}</p> : null}
            {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
          </div>
        </form>
      ) : (
        <p className="mt-4 border border-primary/30 bg-primary/10 p-4 text-sm text-foreground">
          Link your Slack account before submitting expeditions.
        </p>
      )}

      <div className="mt-5 space-y-3">
        {expeditions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No expeditions submitted yet.</p>
        ) : (
          expeditions.map((expedition) => (
            <article
              key={expedition.id}
              className="border border-foreground/15 bg-background/40 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-sub text-lg font-bold text-foreground">
                    {displayTitle(expedition)}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[expedition.date, displayLocation(expedition)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span
                  className={cn(
                    "border px-2 py-1 text-xs font-bold uppercase tracking-wide",
                    expedition.status === "Approved"
                      ? "border-acceptance/30 bg-acceptance/10 text-acceptance"
                      : "border-primary/30 bg-primary/10 text-primary",
                  )}
                >
                  {expedition.status || "Pending"}
                </span>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
