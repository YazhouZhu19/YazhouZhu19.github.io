import { SIGNALS_MAX_BYTES, SIGNALS_MAX_RECORDS } from "../lib/research-signals";

/** Report both source-archive limits; never change limits or remove records. */
export function signalsCapacity(records: number, bytes: number) {
  if (![records, bytes].every((value) => Number.isSafeInteger(value) && value >= 0))
    throw new Error("Invalid signals capacity measurement");
  const metric = (used: number, limit: number) => ({
    used,
    limit,
    remaining: limit - used,
    percent: Math.round((used / limit) * 10000) / 100,
    warning: used >= limit * 0.8,
  });
  return {
    records: metric(records, SIGNALS_MAX_RECORDS),
    bytes: metric(bytes, SIGNALS_MAX_BYTES),
  };
}

export function signalsCapacityLines(records: number, bytes: number, phase: "input" | "output") {
  const capacity = signalsCapacity(records, bytes);
  const lines = [JSON.stringify({ event: "signals-capacity", phase, ...capacity })];
  if (capacity.records.warning || capacity.bytes.warning) {
    const detail = Object.entries(capacity)
      .map(
        ([name, value]) =>
          `${name}: ${value.used}/${value.limit} (${value.percent}%, remaining ${value.remaining})`,
      )
      .join("; ");
    lines.push(
      `::warning title=Research signals capacity::${phase} archive at or above 80% of a capacity limit; ${detail}. Plan sharded source storage before the hard limit. No records were removed or limits changed.`,
    );
  }
  return lines;
}
