export function setChipText(elementId, text, variant = "") {
  const element = document.getElementById(elementId);
  if (!element) return;
  element.textContent = text;
  element.className = `chip ${variant}`.trim();
}

export function setControlsState(connected) {
  const ids = ["disconnect-btn", "mic-btn", "camera-btn", "send-btn"];
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element) {
      element.disabled = !connected;
    }
  }
  const connect = document.getElementById("connect-btn");
  if (connect) {
    connect.disabled = connected;
  }
}

export function appendTranscript(entry) {
  const target = document.getElementById("transcript-list");
  if (!target) return;
  const row = document.createElement("article");
  row.className = `entry ${entry.role}`;
  row.innerHTML = `<span class="entry-role">${entry.role}</span><p>${escapeHtml(entry.text)}</p>`;
  target.prepend(row);
}

export function appendDiagnostic(entry) {
  const target = document.getElementById("diagnostic-list");
  if (!target) return;
  const row = document.createElement("article");
  row.className = "entry diagnostic";
  row.innerHTML = `<span class="entry-role">${escapeHtml(entry.event || "event")}</span><p>${escapeHtml(JSON.stringify(entry))}</p>`;
  target.prepend(row);
}

export function renderError(error) {
  appendDiagnostic({ event: "error", detail: String(error) });
  setChipText("connection-chip", "failed", "chip-danger");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
