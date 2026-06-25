// Reproducer for jco AsyncSubtask handle leak.
//
// When a component calls a WIT import through jco's --instantiation async
// transpilation, jco creates an AsyncSubtask object and inserts it into
// ComponentAsyncState.handles (a RepTable). On resolution, removeSubtask()
// is called on the parent task's array, but cstate.handles.remove() is never
// called. The AsyncSubtask (and its associated Waitable + Promise) stay alive
// in the RepTable forever.
//
// Streams and futures DO call cstate.handles.remove() on cleanup — subtasks
// are missing the equivalent call.
//
// Run with: node --expose-gc repro.mjs
//
// Expected (buggy): heap grows by ~100–300 bytes per import call, GC cannot
//   reclaim the leaked objects.
// Expected (fixed): heap is stable after GC.

import { readFile } from "node:fs/promises";
import { writeHeapSnapshot } from "node:v8";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { instantiate } from "./generated/component.js";

const CALLS = 50_000;
const GEN = path.join(path.dirname(fileURLToPath(import.meta.url)), "generated");

function heapMB() {
  return Math.round(process.memoryUsage().heapUsed / 1e6);
}

let ticks = 0;
const component = await instantiate(
  async (corePath) => WebAssembly.compile(await readFile(path.join(GEN, corePath))),
  { tick: { default: () => { ticks++; } } }
);

// Warm-up: let V8 JIT settle.
component.run(1000);
globalThis.gc?.();
await new Promise(r => setTimeout(r, 50));

const before = heapMB();
writeHeapSnapshot("./snapshot-before.heapsnapshot");
console.log(`heap before ${CALLS} import calls: ${before}MB`);

component.run(CALLS);

// Drain the microtask queue first (all queueMicrotask callbacks from
// _lowerImportBackwardsCompat fire before the setTimeout callback).
await new Promise(r => setTimeout(r, 50));
// Now GC: with the bug, AsyncSubtask objects are still rooted in
// cstate.handles and cannot be collected. With the fix, they're gone.
globalThis.gc?.();

const after = heapMB();
writeHeapSnapshot("./snapshot-after.heapsnapshot");
console.log(`heap after  ${CALLS} import calls: ${after}MB`);
console.log(`delta: +${after - before}MB for ${CALLS} calls (~${Math.round((after - before) * 1e6 / CALLS)}B/call)`);
console.log(`ticks counted: ${ticks}`);

if (after - before > 5) {
  console.log("\nLEAK CONFIRMED: heap grew by more than 5MB despite GC.");
  console.log("Open snapshot-before.heapsnapshot and snapshot-after.heapsnapshot");
  console.log("in Chrome DevTools → Memory → Comparison to see the leaked objects.");
  console.log("Look for AsyncSubtask, Waitable, Promise with counts ~= CALLS.");
} else {
  console.log("\nNo significant leak detected (or leak is already patched).");
}
