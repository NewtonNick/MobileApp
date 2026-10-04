export function leftoverOf(liquid: number, reserved: number): number {
  return Math.max(0, liquid - reserved);
}
