// Types for the licence-generator helpers, so the test suite can use them
// under strict TypeScript. The module itself stays plain JavaScript: it is run
// straight from node by `npm run licenses`, with no build step.

export const ROOT: string;

export interface CargoPackage {
  name: string;
  version: string;
  license?: string;
  authors: string[];
  repository: string | null;
  dir: string;
}

export interface NpmLockPackage {
  path: string;
  name: string;
  version: string;
  license?: string;
  dev: boolean;
}

export function cargoPackages(): CargoPackage[];
export function npmLockPackages(): NpmLockPackage[];
export function compareVersions(a: string, b: string): number;
export function byNameThenVersion(
  a: { name: string; version: string },
  b: { name: string; version: string },
): number;
export function noticeFilesIn(dir: string): string[];
export function readNotice(path: string): string;
export function fence(text: string): string;
