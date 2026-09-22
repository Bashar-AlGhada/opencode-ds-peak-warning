// Minimal key/value surface used by the v2 storage adapter and state loaders.
export interface KvLike {
  get(key: string): unknown
  set(key: string, value: unknown): void
}
