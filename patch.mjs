// Patches the jco-generated component.js.
//
// Default (no flags): applies only the currentSubtask workaround, which is
// required for the code to run at all (unrelated to the handle leak).
//
// With --fix: also applies the AsyncSubtask handle leak fix, so you can
// verify the fix works before including it in an upstream report.
//   npm run repro:fixed

import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("./generated/component.js", import.meta.url).pathname;
const applyFix = process.argv.includes("--fix");

let src = readFileSync(file, "utf8");

// Patch 1 (workaround, always applied): trampoline catch-blocks reference
// `currentSubtask` which is only declared in some inner scopes. When an import
// throws/rejects the catch path hits ReferenceError instead of lifting the Err.
const MARKER1 = "let currentSubtask; // jco-patch-1";
const ANCHOR1 = "export function instantiate(getCoreModule, imports, instantiateCore = WebAssembly.instantiate) {";
if (!src.includes(MARKER1)) {
  src = src.replace(ANCHOR1, `${ANCHOR1}\n  ${MARKER1}`);
  console.log("patched: currentSubtask workaround (required for execution)");
}

// Patch 2 (bug fix, only with --fix): AsyncSubtask.resolve() calls
// removeSubtask() on the parent task's array but never calls
// cstate.handles.remove(this.waitableRep()), so every completed async import
// leaks one AsyncSubtask + Waitable + Promise into the component RepTable.
// Streams and futures already call cstate.handles.remove() at this point.
//
// Fix: add the missing cstate.handles.remove() call after removeSubtask().
const MARKER2 = "this.#getComponentState().handles.remove(this.waitableRep()); // jco-patch-2";
const ANCHOR2 = "this.#parentTask.removeSubtask(this);";
if (applyFix && !src.includes(MARKER2)) {
  if (!src.includes(ANCHOR2)) {
    console.error("patch: anchor 2 not found — jco output changed?");
    process.exit(1);
  }
  src = src.replace(ANCHOR2, `${ANCHOR2}\n      ${MARKER2}`);
  console.log("patched: AsyncSubtask handle leak fix applied");
} else if (applyFix) {
  console.log("patched: AsyncSubtask handle leak fix already applied");
}

writeFileSync(file, src);
