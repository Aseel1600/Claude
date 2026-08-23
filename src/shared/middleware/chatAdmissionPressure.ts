import v8 from "node:v8";

/** Heap pressure threshold for structural admission; defaults to 75%. */
export const CHAT_ADMISSION_HEAP_SHED_RATIO = (() => {
  const parsed = Number(process.env.OMNIROUTE_CHAT_ADMISSION_HEAP_SHED_RATIO);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.75;
})();

/** Live pressure probe. Read failures fail open so they cannot cause a false shed. */
export function defaultHeapPressureCheck(): boolean {
  try {
    const heapUsed = process.memoryUsage().heapUsed;
    const heapLimit = v8.getHeapStatistics().heap_size_limit;
    return Number.isFinite(heapLimit) && heapLimit > 0
      ? heapUsed / heapLimit >= CHAT_ADMISSION_HEAP_SHED_RATIO
      : false;
  } catch {
    return false;
  }
}
