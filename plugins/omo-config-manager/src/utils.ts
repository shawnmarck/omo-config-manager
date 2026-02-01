/**
 * Utility functions for cross-platform path handling and file operations
 */
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

/**
 * Get the home directory in a cross-platform way
 */
export function getHomeDir(): string {
  return os.homedir();
}

function isWindows(): boolean {
  return process.platform === 'win32';
}

function getConfigBaseDir(): string {
  if (isWindows()) {
    // Prefer APPDATA (%AppData%/Roaming). Fall back to standard location.
    const appData = process.env.APPDATA;
    if (appData && appData.trim()) return appData;
    return path.join(getHomeDir(), 'AppData', 'Roaming');
  }

  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.trim()) return xdg;
  return path.join(getHomeDir(), '.config');
}

/**
 * Get the OpenCode config directory path
 */
export function getOpenCodeConfigDir(): string {
  return path.join(getConfigBaseDir(), 'opencode');
}

/**
 * Get the OMO config file path
 */
export function getOmoConfigPath(): string {
  return path.join(getOpenCodeConfigDir(), 'oh-my-opencode.json');
}

export function getOmoConfigPathCandidates(): string[] {
  const base = getOpenCodeConfigDir();
  return [path.join(base, 'oh-my-opencode.json'), path.join(base, 'oh-my-opencode.jsonc')];
}

/**
 * Get the OpenCode config file path
 */
export function getOpenCodeConfigPath(): string {
  return path.join(getOpenCodeConfigDir(), 'opencode.json');
}

export function getOpenCodeConfigPathCandidates(): string[] {
  const base = getOpenCodeConfigDir();
  return [path.join(base, 'opencode.json'), path.join(base, 'opencode.jsonc')];
}

async function firstExistingPath(candidates: string[]): Promise<string | undefined> {
  for (const p of candidates) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // continue
    }
  }
  return undefined;
}

export async function resolveOpenCodeConfigPath(): Promise<string> {
  return (await firstExistingPath(getOpenCodeConfigPathCandidates())) ?? getOpenCodeConfigPath();
}

export async function resolveOmoConfigPath(): Promise<string> {
  return (await firstExistingPath(getOmoConfigPathCandidates())) ?? getOmoConfigPath();
}

/**
 * Get the archive directory path
 */
export function getArchiveDir(): string {
  return path.join(getOpenCodeConfigDir(), 'archive');
}

function stripJsonComments(input: string): string {
  let out = '';
  let inString = false;
  let stringQuote: '"' | "'" = '"';
  let escape = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = i + 1 < input.length ? input[i + 1] : '';

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++; // consume '/'
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch as '"' | "'";
      out += ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++; // consume next '/'
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++; // consume next '*'
      continue;
    }

    out += ch;
  }

  return out;
}

function stripTrailingCommas(input: string): string {
  let out = '';
  let inString = false;
  let stringQuote: '"' | "'" = '"';
  let escape = false;

  const isWhitespace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch as '"' | "'";
      out += ch;
      continue;
    }

    if (ch === ',') {
      // Look ahead for the next non-whitespace character.
      let j = i + 1;
      while (j < input.length && isWhitespace(input[j])) j++;
      const next = j < input.length ? input[j] : '';
      if (next === '}' || next === ']') {
        // Skip this comma.
        continue;
      }
    }

    out += ch;
  }

  return out;
}

function parseJsonLenient<T>(content: string, filePath: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    // Try JSONC-ish parsing.
    const noComments = stripJsonComments(content);
    const noTrailing = stripTrailingCommas(noComments);
    try {
      return JSON.parse(noTrailing) as T;
    } catch (error) {
      throw new Error(
        `Failed to parse ${filePath} as JSON/JSONC: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Read and parse a JSON file with proper error handling
 */
export async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return parseJsonLenient<T>(content, filePath);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - return default value
        return defaultValue;
      }
    }
    // Re-throw other errors (parse errors, permission errors, etc.)
    throw new Error(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Write JSON file with proper error handling
 */
export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    
    // Write file with pretty formatting
    await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  } catch (error: unknown) {
    throw new Error(`Failed to write ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * List backup files in archive directory
 */
export async function listBackups(limit: number = 5): Promise<string[]> {
  try {
    const archiveDir = getArchiveDir();
    const files = await fs.readdir(archiveDir);
    const backups = files.filter(f => 
      f.startsWith('omo-backup-') || f.startsWith('opencode-backup-')
    );
    backups.sort().reverse();
    return backups.slice(0, limit);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      // Archive directory doesn't exist yet
      return [];
    }
    throw error;
  }
}

/**
 * Create a timestamp string for backup files
 */
export function createTimestamp(): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0].replace(/-/g, '');
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '');
  return `${date}-${time}`;
}

/**
 * Ensure archive directory exists
 */
export async function ensureArchiveDir(): Promise<void> {
  const archiveDir = getArchiveDir();
  await fs.mkdir(archiveDir, { recursive: true });
}
