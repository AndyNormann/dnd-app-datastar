// DM-side fog reveal. Drag a rectangle to reveal every cell it encloses; a plain
// single click toggles one cell. While dragging, only the selection outline is
// shown — cells reveal on release. The covered cells are POSTed to the reveal
// endpoint; the authoritative fog state then streams back to every viewer
// (including this page) over Datastar SSE.
const stage = document.getElementById("stage");
const selbox = document.getElementById("selbox");
if (stage && selbox) {
  const url = stage.dataset.revealUrl;
  const cols = Number(stage.dataset.cols);
  const rows = Number(stage.dataset.rows);

  let dragging = false;
  let startIndex = -1;
  let startX = 0;
  let startY = 0;
  let endIndex = -1;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Map any pointer position (even outside the image) to the nearest grid cell.
  const indexAt = (clientX, clientY) => {
    const rect = stage.getBoundingClientRect();
    const col = clamp(Math.floor(((clientX - rect.left) / rect.width) * cols), 0, cols - 1);
    const row = clamp(Math.floor(((clientY - rect.top) / rect.height) * rows), 0, rows - 1);
    return row * cols + col;
  };

  // Inclusive rectangular range of cell indices spanning two cells in the grid.
  const rangeIndices = (a, b) => {
    const minC = Math.min(a % cols, b % cols);
    const maxC = Math.max(a % cols, b % cols);
    const minR = Math.min((a / cols) | 0, (b / cols) | 0);
    const maxR = Math.max((a / cols) | 0, (b / cols) | 0);
    const out = [];
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) out.push(r * cols + c);
    }
    return out;
  };

  const drawBox = (clientX, clientY) => {
    const rect = stage.getBoundingClientRect();
    const x1 = clamp(startX - rect.left, 0, rect.width);
    const y1 = clamp(startY - rect.top, 0, rect.height);
    const x2 = clamp(clientX - rect.left, 0, rect.width);
    const y2 = clamp(clientY - rect.top, 0, rect.height);
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
    startX = e.clientX;
    startY = e.clientY;
    startIndex = indexAt(e.clientX, e.clientY);
    endIndex = startIndex;
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {}
  });

  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    endIndex = indexAt(e.clientX, e.clientY);
    drawBox(e.clientX, e.clientY);
  });

  const finish = () => {
    if (!dragging) return;
    dragging = false;
    selbox.hidden = true;

    let cells;
    let action;
    if (endIndex === startIndex) {
      // No real drag: toggle the single cell based on its current state.
      const startCell = stage.querySelector(`.cell[data-i="${startIndex}"]`);
      const wasRevealed = startCell && startCell.dataset.revealed === "1";
      action = wasRevealed ? "hide" : "reveal";
      cells = [startIndex];
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
