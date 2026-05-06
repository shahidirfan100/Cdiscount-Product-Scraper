import { readFile } from 'node:fs/promises';

const [packageJsonRaw, dockerfileRaw] = await Promise.all([
    readFile(new URL('./package.json', import.meta.url), 'utf8'),
    readFile(new URL('./Dockerfile', import.meta.url), 'utf8'),
]);
const packageJson = JSON.parse(packageJsonRaw);
const playwrightVersion = packageJson.dependencies?.playwright;
const dockerImageMatch = dockerfileRaw.match(/actor-node-playwright-firefox:\d+-([0-9.]+)/);
const expectedVersion = dockerImageMatch?.[1];

if (!expectedVersion) {
    throw new Error('Could not determine Playwright version from Dockerfile.');
}

if (playwrightVersion !== expectedVersion) {
    throw new Error(`Playwright version mismatch. Expected ${expectedVersion}, found ${playwrightVersion || 'missing'}.`);
}
