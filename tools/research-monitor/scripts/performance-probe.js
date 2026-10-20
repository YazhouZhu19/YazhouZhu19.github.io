/* Local-only QA: visible measurements, no telemetry or remote requests. */
(() => {
  if (!["localhost", "127.0.0.1", "::1"].includes(location.hostname)) return;
  const longTasks = [];
  const interactions = [];
  const observers = [];
  let started = 0;
  for (const type of ["longtask", "event"]) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.startTime < started) continue;
        (type === "longtask" ? longTasks : interactions).push({
          name: entry.name, startTime: Math.round(entry.startTime),
          duration: entry.duration, interactionId: entry.interactionId,
        });
      }
    });
    observer.observe({ type, buffered: true, ...(type === "event" ? { durationThreshold: 16 } : {}) });
    observers.push(observer);
  }
  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.createElement("details");
    panel.id = "performance-probe";
    panel.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:99999;background:#fff;color:#111;border:1px solid #555;padding:8px;max-width:80vw;max-height:40vh;overflow:auto;font:12px monospace";
    const summary = document.createElement("summary");
    const reset = document.createElement("button");
    reset.textContent = "Reset performance measurement";
    reset.onclick = () => { started = performance.now(); longTasks.length = 0; interactions.length = 0; render(); };
    const output = document.createElement("pre");
    output.setAttribute("aria-label", "Performance measurement");
    panel.append(summary, reset, output);
    document.body.append(panel);
    function render() {
      const requests = performance.getEntriesByType("resource").filter(entry => entry.startTime >= started).map(entry => ({
        path: new URL(entry.name).pathname, transferSize: entry.transferSize,
      }));
      const maxLongTask = Math.max(0, ...longTasks.map(entry => entry.duration));
      const maxInteraction = Math.max(0, ...interactions.filter(entry => entry.interactionId).map(entry => entry.duration));
      summary.textContent = `Local QA · max task ${maxLongTask} ms · max interaction ${maxInteraction} ms`;
      output.textContent = JSON.stringify({
        cpuThrottling: "none", supported: PerformanceObserver.supportedEntryTypes,
        elapsedMs: Math.round(performance.now() - started),
        maxLongTask, maxInteraction, longTasks, interactions, requests,
        note: "Event durations are observed local samples, not field INP. Worker fetches are not in the main resource timeline.",
      }, null, 2);
    }
    render();
    const timer = setInterval(render, 1000);
    addEventListener("pagehide", () => { clearInterval(timer); observers.forEach(observer => observer.disconnect()); }, { once: true });
  }, { once: true });
})();
