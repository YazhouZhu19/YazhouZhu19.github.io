/** Invalidate pending UI actions when navigation or the input scope changes. */
export function createLatestAsyncAction() {
  let revision = 0;
  return {
    invalidate() { revision++; },
    async run<T>(read: () => Promise<T>, apply: (value: T) => void): Promise<boolean> {
      const current = ++revision;
      const value = await read();
      if (current !== revision) return false;
      apply(value);
      return true;
    },
  };
}
