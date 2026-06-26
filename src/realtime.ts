// In-process pub/sub: one set of live SSE writers per session. Both the DM and
// any connected players subscribe; reveal/share mutations broadcast Datastar
// "patch elements" events to everyone watching that session.

type Subscriber = (chunk: string) => void;

const sessions = new Map<number, Set<Subscriber>>();

export function subscribe(sessionId: number, fn: Subscriber): () => void {
  let set = sessions.get(sessionId);
  if (!set) {
    set = new Set();
    sessions.set(sessionId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) sessions.delete(sessionId);
  };
}

/** Format a Datastar `datastar-merge-fragments` SSE event. The default merge
 *  mode is "morph", which matches the fragment to the existing element by id. */
export function patchElements(html: string): string {
  const lines = html
    .split("\n")
    .map((l) => `data: fragments ${l}`)
    .join("\n");
  return `event: datastar-merge-fragments\n${lines}\n\n`;
}

export function broadcast(sessionId: number, sseEvent: string): void {
  const set = sessions.get(sessionId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(sseEvent);
    } catch {
      // writer gone; cleanup happens on its own close handler
    }
  }
}
