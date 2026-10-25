import assert from "node:assert/strict";
import test from "node:test";
import {
  collectionUtcDay,
  publicationDateStatus,
  selectPublicationDate,
  strictPublicationDay,
} from "../lib/publication-date";

const asOf = "2026-10-21T08:00:00Z";

test("publication date chooses the earliest available nonfuture source date", () => {
  const dates = {
    firstPublicationDate: "2027-01-01",
    electronicPublicationDate: "2026-10-10",
    firstIndexDate: "2026-10-12",
  };
  assert.deepEqual(selectPublicationDate(dates, asOf), {
    publishedAt: "2026-10-10",
    selectedDateField: "electronicPublicationDate",
    originalDates: dates,
  });
  assert.equal(
    selectPublicationDate(
      {
        ...dates,
        firstIndexDate: "2026-10-05",
      },
      asOf,
    ).publishedAt,
    "2026-10-05",
  );
});

test("all-future candidates retain the preferred original date and are flagged", () => {
  const dates = {
    firstPublicationDate: "2027-01-01T12:00:00Z",
    electronicPublicationDate: "2026-11-01",
    firstIndexDate: "2026-11-05",
  };
  const result = selectPublicationDate(dates, asOf);
  assert.equal(result.publishedAt, dates.firstPublicationDate);
  assert.equal(result.dateAnomaly, "future");
  assert.deepEqual(result.originalDates, dates);
});

test("past preferred date remains valid and same-day publication is eligible", () => {
  assert.equal(
    selectPublicationDate(
      {
        firstPublicationDate: "2026-10-21",
        electronicPublicationDate: "2026-12-01",
      },
      asOf,
    ).publishedAt,
    "2026-10-21",
  );
  assert.equal(selectPublicationDate({ firstPublicationDate: "2026-10-20" }, asOf).dateAnomaly, undefined);
});

test("missing, invalid and impossible dates are preserved as evidence without inventing a publication day", () => {
  const dates = { firstPublicationDate: "2026-02-30", electronicPublicationDate: "", firstIndexDate: null };
  assert.deepEqual(selectPublicationDate(dates, asOf), { publishedAt: "", originalDates: dates });
  assert.deepEqual(selectPublicationDate({}, asOf), { publishedAt: "", originalDates: {} });
  assert.equal(
    selectPublicationDate({ firstPublicationDate: "invalid", firstIndexDate: "2026-10-18" }, asOf)
      .publishedAt,
    "2026-10-18",
  );
});

test("strict dates distinguish leap days, partial dates and malformed timestamps", () => {
  assert.equal(strictPublicationDay("2024-02-29"), "2024-02-29");
  for (const value of [
    "2026-02-29",
    "2026-04-31",
    "2026-10",
    "2026",
    "2026-10-21T99:00Z",
    "2026-10-21bad",
    null,
  ]) {
    assert.equal(strictPublicationDay(value), null, String(value));
  }
});

test("collection uses explicit UTC calendar days rather than the viewer timezone", () => {
  assert.equal(collectionUtcDay("2026-10-21T00:30:00+08:00"), "2026-10-20");
  assert.equal(
    selectPublicationDate({ firstPublicationDate: "2026-10-21" }, "2026-10-21T00:30:00+08:00").dateAnomaly,
    "future",
  );
  assert.throws(() => selectPublicationDate({}, "2026-02-30"), /Invalid collection date/);
});

test("date-status decisions exclude flags even after the source date passes, until re-normalized", () => {
  assert.equal(publicationDateStatus({ publishedAt: "2026-10-20" }, "2026-10-21"), "valid");
  assert.equal(publicationDateStatus({ publishedAt: "2026-10-22" }, "2026-10-21"), "future");
  assert.equal(
    publicationDateStatus({ publishedAt: "2026-10-20", dateAnomaly: "future" }, "2026-10-21"),
    "future",
  );
  assert.equal(publicationDateStatus({ publishedAt: "2026-02-30" }, "2026-10-21"), "invalid");
  assert.equal(selectPublicationDate({ firstPublicationDate: "2026-10-20" }, asOf).dateAnomaly, undefined);
});
