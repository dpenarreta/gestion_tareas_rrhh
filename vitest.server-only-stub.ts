// Stub for the "server-only" marker package under Vitest: the real package
// throws unconditionally unless resolved via the "react-server" export
// condition (which Vite/Vitest doesn't set), so it would break any test that
// imports a module using `import "server-only"` even indirectly.
export {};
