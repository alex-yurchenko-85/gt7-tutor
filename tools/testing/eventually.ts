export async function eventually<T>(probe: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 5000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Condition not met within ${timeoutMs} ms`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
