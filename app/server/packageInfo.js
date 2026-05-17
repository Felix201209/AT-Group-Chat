import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const packageInfo = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8'));
export const AT_PACKAGE_VERSION = packageInfo.version;
