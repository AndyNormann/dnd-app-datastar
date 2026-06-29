// DM-side fog reveal. Drag a rectangle to reveal every cell it covers; a plain
// single click toggles one cell. The covered cells are POSTed to the reveal
// endpoint; the authoritative fog state then streams back to every viewer
// (including this page) over Datastar SSE.
const stage = document.getElementById("stage");
const selbox = document.getElementById("selbox");
if (stage && selbox) {
  const url = stage.dataset.revealUrl;
  const cols = Number(stage.dataset.cols);

  let dragging = false;
  let startIndex = -1;
  let startX = 0;
  let startY = 0;
  let baseline = new Set(); // cells already revealed when the drag began

  const cellAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el && el.classList.contains("cell") ? el : null;
  };

  // Inclusive rectangular range of cell indices spanning two cells in the grid.
  const rangeIndices = (a, b) => {
    const ac = a % cols;
    const ar = (a / cols) | 0;
    const bc = b % cols;
    const br = (b / cols) | 0;
    const minC = Math.min(ac, bc);
    const maxC = Math.max(ac, bc);
    const minR = Math.min(ar, br);
    const maxR = Math.max(ar, br);
    const out = [];
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) out.push(r * cols + c);
    }
    return out;
  };

  const drawBox = (clientX, clientY) => {
    const rect = stage.getBoundingClientRect();
    const x1 = startX - rect.left;
    const y1 = startY - rect.top;
    const x2 = clientX - rect.left;
    const y2 = clientY - rect.top;
    selbox.style.left = Math.min(x1, x2) + "px";
    selbox.style.top = Math.min(y1, y2) + "px";
    selbox.style.width = Math.abs(x2 - x1) + "px";
    selbox.style.height = Math.abs(y2 - y1) + "px";
    selbox.hidden = false;
  };

  stage.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest && e.target.closest(".cell");
    if (!cell) return;
    e.preventDefault();
    dragging = true;
    startIndex = Number(cell.dataset.i);
    startX = e.clientX;
    startY = e.clientY;
    baseline = new Set();
    for (const el of stage.querySelectorAll('.cell[data-revealed="1"]')) {
      baseline.add(Number(el.dataset.i));
    }
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {}
  });

  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    drawBox(e.clientX, e.clientY);
    const cell = cellAt(e.clientX, e.clientY);
    const endIndex = cell ? Number(cell.dataset.i) : startIndex;
    // Optimistic preview: cells inside the box light up; cells outside fall
    // back to whatever they were before the drag started.
    const covered = new Set(rangeIndices(startIndex, endIndex));
    for (const el of stage.querySelectorAll(".cell")) {
      const i = Number(el.dataset.i);
      el.dataset.revealed = covered.has(i) || baseline.has(i) ? "1" : "0";
    }
  });

  const finish = (e) => {
    if (!dragging) return;
    dragging = false;
    selbox.hidden = true;
    const cell = e ? cellAt(e.clientX, e.clientY) : null;
    const endIndex = cell ? Number(cell.dataset.i) : startIndex;

    let cells;
    let action;
    if (endIndex === startIndex) {
      // No real drag: treat as a single-cell toggle.
      const startCell = stage.querySelector(`.cell[data-i="${startIndex}"]`);
      const wasRevealed = startCell && startCell.dataset.revealed === "1";
      action = wasRevealed ? "hide" : "reveal";
      cells = [startIndex];
      if (startCell) startCell.dataset.revealed = wasRevealed ? "0" : "1";
    } else {
      action = "reveal";
      cells = rangeIndices(startIndex, endIndex);
    }

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
