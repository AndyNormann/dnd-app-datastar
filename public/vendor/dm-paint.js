// DM-side fog reveal. Drag across the grid to select a rectangle of cells; the
// affected squares are highlighted while dragging and committed on release. A
// plain single click toggles one cell. Direction follows the start cell:
// starting on a hidden square reveals, starting on a revealed square hides. The
// covered cells are POSTed to the reveal endpoint; the authoritative fog state
// then streams back to every viewer (including this page) over Datastar SSE.
const stage = document.getElementById("stage");
if (stage) {
  const url = stage.dataset.revealUrl;
  const cols = Number(stage.dataset.cols);
  const rows = Number(stage.dataset.rows);

  let dragging = false;
  let startIndex = -1;
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

  const clearPreview = () => {
    for (const el of stage.querySelectorAll(".cell.preview")) el.classList.remove("preview");
  };

  // Highlight exactly the cells the current selection would affect.
  const showPreview = () => {
    const covered = new Set(rangeIndices(startIndex, endIndex));
    for (const el of stage.querySelectorAll(".cell")) {
      el.classList.toggle("preview", covered.has(Number(el.dataset.i)));
    }
  };

  stage.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest && e.target.closest(".cell");
    if (!cell) return;
    e.preventDefault();
    dragging = true;
    startIndex = indexAt(e.clientX, e.clientY);
    endIndex = startIndex;
    showPreview();
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {}
  });

  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    endIndex = indexAt(e.clientX, e.clientY);
    showPreview();
  });

  const finish = () => {
    if (!dragging) return;
    dragging = false;
    clearPreview();

    // The start cell's current state decides the direction: starting on a
    // hidden square reveals the box/cell, starting on a revealed square hides it.
    const startCell = stage.querySelector(`.cell[data-i="${startIndex}"]`);
    const wasRevealed = startCell && startCell.dataset.revealed === "1";
    const action = wasRevealed ? "hide" : "reveal";
    const cells = endIndex === startIndex ? [startIndex] : rangeIndices(startIndex, endIndex);

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
