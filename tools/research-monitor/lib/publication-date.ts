export type PublicationDateField = "firstPublicationDate" | "electronicPublicationDate" | "firstIndexDate";
export type PublicationDates = Partial<Record<PublicationDateField, string | null>>;
export type PublicationDateSelection = {
  publishedAt: string;
  dateAnomaly?: "future";
  selectedDateField?: PublicationDateField;
  originalDates: PublicationDates;
};
const fields: PublicationDateField[] = [
  "firstPublicationDate",
  "electronicPublicationDate",
  "firstIndexDate",
];

/** Keep source calendar dates; reject Date.parse's rollover of impossible days. */
export function strictPublicationDay(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:$|T|\s)/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return null;
  const day = value.slice(0, 10);
  const date = new Date(day + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}

/** Source collection windows use UTC days; UI date windows may use Beijing days. */
export function collectionUtcDay(collectedAt: string): string {
  if (!strictPublicationDay(collectedAt)) throw new Error("Invalid collection date");
  return new Date(collectedAt).toISOString().slice(0, 10);
}

export function selectPublicationDate(
  dates: PublicationDates,
  collectedAt: string,
): PublicationDateSelection {
  const today = collectionUtcDay(collectedAt);
  const originalDates: PublicationDates = {};
  for (const field of fields) {
    const value = dates[field];
    if (typeof value === "string" || value === null) originalDates[field] = value;
  }
  const valid = fields.flatMap((field) => {
    const value = originalDates[field];
    const day = strictPublicationDay(value);
    return typeof value === "string" && day ? [{ field, value, day }] : [];
  });
  const elapsed = valid
    .filter((candidate) => candidate.day <= today)
    .sort((a, b) => a.day.localeCompare(b.day) || fields.indexOf(a.field) - fields.indexOf(b.field));
  if (elapsed.length) {
    const chosen = elapsed[0];
    return {
      publishedAt: chosen.day,
      selectedDateField: chosen.field,
      originalDates,
    };
  }
  // No plausible alternative: keep the preferred source's actual value for review.
  if (valid.length) {
    const chosen = valid[0];
    return {
      publishedAt: chosen.value,
      dateAnomaly: "future",
      selectedDateField: chosen.field,
      originalDates,
    };
  }
  // Missing/invalid dates are unknown, not January 1 or the collection day.
  return { publishedAt: "", originalDates };
}

/** Flags remain excluded until a later normalization/source correction clears them. */
export function publicationDateStatus(
  paper: { publishedAt: string; dateAnomaly?: "future" },
  today: string,
): "valid" | "invalid" | "future" {
  if (strictPublicationDay(today) !== today) throw new Error("Invalid comparison day");
  const day = strictPublicationDay(paper.publishedAt);
  if (!day) return "invalid";
  return paper.dateAnomaly === "future" || day > today ? "future" : "valid";
}

type DatedRecord = {
  publishedAt: string;
  dateAnomaly?: "future";
  provenance?: { collectedAt?: string; publicationDates?: PublicationDates }[];
};

/** Revisit retained records using available original dates, without inventing a source fetch. */
export function normalizePaperPublicationDate<T extends DatedRecord>(
  paper: T,
  collectedAt: string,
): Omit<T, "dateAnomaly"> & { dateAnomaly?: "future" } {
  const today = collectionUtcDay(collectedAt);
  const candidates = [
    paper.publishedAt,
    ...(paper.provenance ?? []).flatMap((entry) => fields.map((field) => entry.publicationDates?.[field])),
  ].flatMap((value) => {
    const day = strictPublicationDay(value);
    return typeof value === "string" && day ? [{ value, day }] : [];
  });
  const elapsed = candidates
    .filter((candidate) => candidate.day <= today)
    .sort((a, b) => a.day.localeCompare(b.day));
  const { dateAnomaly: _previousAnomaly, ...original } = paper;
  if (elapsed.length) return { ...original, publishedAt: elapsed[0].day };
  if (candidates.length)
    return { ...original, publishedAt: candidates[0].value, dateAnomaly: "future" as const };
  return { ...original, publishedAt: "" };
}
