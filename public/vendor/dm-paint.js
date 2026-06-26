// DM-side fog painting. Click a cell to toggle; click-drag to paint many.
// Sends the batch to the reveal endpoint; the authoritative fog state then
// streams back to every viewer (including this page) over Datastar SSE.
const stage = document.getElementById("stage");
if (stage) {
  const url = stage.dataset.revealUrl;
  let painting = false;
  let action = "reveal";
  let batch = new Set();

  const cellAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el && el.classList.contains("cell") ? el : null;
  };

  const apply = (cell) => {
    if (!cell) return;
    const i = Number(cell.dataset.i);
    if (batch.has(i)) return;
    batch.add(i);
    cell.dataset.revealed = action === "reveal" ? "1" : "0"; // optimistic
  };

  stage.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest && e.target.closest(".cell");
    if (!cell) return;
    e.preventDefault();
    painting = true;
    action = cell.dataset.revealed === "1" ? "hide" : "reveal";
    batch = new Set();
    apply(cell);
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {}
  });

  stage.addEventListener("pointermove", (e) => {
    if (!painting) return;
    apply(cellAt(e.clientX, e.clientY));
  });

  const finish = () => {
    if (!painting) return;
    painting = false;
    if (batch.size === 0) return;
    const cells = [...batch];
    batch = new Set();
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cells, action }),
    });
  };

  stage.addEventListener("pointerup", finish);
  stage.addEventListener("pointercancel", finish);
  window.addEventListener("pointerup", finish);
}
