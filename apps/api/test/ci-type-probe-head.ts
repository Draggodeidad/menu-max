export type CiProbeHeadResult = number;

declare global {
  interface CiTypeProbe {
    result: CiProbeHeadResult;
  }
}
