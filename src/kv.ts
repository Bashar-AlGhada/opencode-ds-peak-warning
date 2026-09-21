// Minimal key/value surface shared by the v1 TUI api (`api.kv`) and the v2
// storage adapter. Loaders/save helpers take this instead of the full host
// api so one implementation serves both plugin generations.
export interface KvLike {
  get(key: string): unknown
  set(key: string, value: unknown): void
}
