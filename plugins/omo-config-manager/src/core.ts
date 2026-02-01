/**
 * Core OMO configuration management logic
 * Shared between OpenCode and Claude Code implementations
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { OmoAgent, OmoCategory, OmoConfig, OpenCodeConfig } from './types.js';
import {
  getArchiveDir,
  resolveOmoConfigPath,
  resolveOpenCodeConfigPath,
  readJsonFile,
  writeJsonFile,
  listBackups,
  createTimestamp,
  ensureArchiveDir,
} from './utils.js';

/**
 * Action types that can be performed
 */
export type ActionType =
  | 'list-agents'
  | 'list-categories'
  | 'list-skills'
  | 'check-updates'
  | 'run-diagnostics'
  | 'backup-configs'
  | 'show-permissions'
  | 'compare-backup'
  | 'restore-backup'
  | 'add-agent'
  | 'modify-agent'
  | 'add-category'
  | 'modify-category'
  | 'disable-hook'
  | 'enable-hook'
  | 'list-oc-models'
  | 'unknown';

/**
 * Parse natural language request into action type
 * Uses word boundaries and priority matching for better accuracy
 */
export function parseAction(request: string): ActionType {
  const lowerRequest = request.toLowerCase();
  
  // Use word boundaries for more precise matching
  const words = lowerRequest.split(/\s+/);
  const hasWord = (word: string) => words.some(w => w === word || w.startsWith(word));
  
  // Priority-based matching (most specific first)
  
  // List actions (must have "list" or "show" or "what")
  if ((hasWord('list') || hasWord('show') || hasWord('what')) && hasWord('agent')) {
    return 'list-agents';
  }
  if ((hasWord('list') || hasWord('show') || hasWord('what')) && hasWord('categor')) {
    return 'list-categories';
  }
  if ((hasWord('list') || hasWord('show') || hasWord('what')) && hasWord('skill')) {
    return 'list-skills';
  }
  if ((hasWord('list') || hasWord('show')) && (hasWord('model') || hasWord('oc-model'))) {
    return 'list-oc-models';
  }
  
  // Update/validation actions
  if (hasWord('update') || (hasWord('check') && hasWord('update'))) {
    return 'check-updates';
  }
  if (hasWord('diagnostic') || (hasWord('run') && hasWord('diagnostic'))) {
    return 'run-diagnostics';
  }
  if (hasWord('valid') || (hasWord('check') && !hasWord('update'))) {
    return 'run-diagnostics';
  }
  
  // Backup actions
  if (hasWord('backup')) {
    return 'backup-configs';
  }
  if (hasWord('restore')) {
    return 'restore-backup';
  }
  if (hasWord('compare') || hasWord('diff')) {
    return 'compare-backup';
  }
  
  // Permission actions
  if (hasWord('permission') || hasWord('perm')) {
    return 'show-permissions';
  }
  
  // Agent modification actions
  if (hasWord('add') && hasWord('agent')) {
    return 'add-agent';
  }
  if ((hasWord('modify') || hasWord('change') || hasWord('edit') || hasWord('update')) && hasWord('agent')) {
    return 'modify-agent';
  }
  
  // Category modification actions
  if (hasWord('add') && hasWord('categor')) {
    return 'add-category';
  }
  if ((hasWord('modify') || hasWord('change') || hasWord('edit') || hasWord('update')) && hasWord('categor')) {
    return 'modify-category';
  }
  
  // Hook actions
  if (hasWord('disable') && hasWord('hook')) {
    return 'disable-hook';
  }
  if (hasWord('enable') && hasWord('hook')) {
    return 'enable-hook';
  }
  
  return 'unknown';
}

export type ActionOptions = {
  backupIndex?: number;
  agentName?: string;
  categoryName?: string;
  hookName?: string;
  agentData?: Partial<OmoAgent>;
  categoryData?: Partial<OmoCategory>;
};

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isSafeConfigKey(key: string): boolean {
  if (!key) return false;
  const lower = key.toLowerCase();
  if (FORBIDDEN_KEYS.has(lower)) return false;
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(key);
}

function extractFirstInt(request: string): number | undefined {
  const m = request.match(/\b(\d{1,3})\b/);
  if (!m) return undefined;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : undefined;
}

function extractKeyAfterWord(request: string, word: string): string | undefined {
  const re = new RegExp(`\\b${word}\\b\\s+(?:named|called)?\\s*([a-z0-9][a-z0-9_-]{0,63})\\b`, 'i');
  const m = request.match(re);
  return m?.[1];
}

function extractKeyBeforeWord(request: string, word: string): string | undefined {
  // e.g. "oracle agent", "data-science category"
  const re = new RegExp(`\\b([a-z0-9][a-z0-9_-]{0,63})\\s+${word}\\b`, 'i');
  const m = request.match(re);
  return m?.[1];
}

function extractHookName(request: string): string | undefined {
  // Prefer "hook X"
  const direct = extractKeyAfterWord(request, 'hook');
  if (direct) return direct;

  // Fall back to scanning for a known hook token in the request.
  const lower = request.toLowerCase();
  for (const hook of KNOWN_HOOKS) {
    if (lower.includes(hook)) return hook;
  }
  return undefined;
}

function extractModel(request: string): string | undefined {
  // model opencode/gpt-5.2  OR model "opencode/gpt-5.2"
  const mQuoted = request.match(/\bmodel\b\s*(?:to\s*)?(?:"([^"]+)"|'([^']+)')/i);
  const mBare = request.match(/\bmodel\b\s*(?:to\s*)?([A-Za-z0-9._/-]+)\b/i);
  const raw = mQuoted?.[1] ?? mQuoted?.[2] ?? mBare?.[1];
  if (!raw) return undefined;
  return raw.trim();
}

function extractTemperature(request: string): number | undefined {
  const m = request.match(/\btemperature\b\s*(?:to\s*)?([0-9]+(?:\.[0-9]+)?)\b/i);
  if (!m) return undefined;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function extractQuotedField(request: string, field: string): string | undefined {
  const re = new RegExp(`\\b${field}\\b\\s*[:=]?\\s*(?:"([^"]+)"|'([^']+)')`, 'i');
  const m = request.match(re);
  return (m?.[1] ?? m?.[2])?.trim();
}

function inferOptionsFromRequest(action: ActionType, request: string): ActionOptions {
  const agentName =
    extractKeyAfterWord(request, 'agent') ??
    extractKeyAfterWord(request, 'agents') ??
    extractKeyBeforeWord(request, 'agent') ??
    extractKeyBeforeWord(request, 'agents');
  const categoryName =
    extractKeyAfterWord(request, 'category') ??
    extractKeyAfterWord(request, 'categories') ??
    extractKeyBeforeWord(request, 'category') ??
    extractKeyBeforeWord(request, 'categories');
  const hookName = extractHookName(request);
  const backupIndex = extractFirstInt(request);

  const model = extractModel(request);
  const temperature = extractTemperature(request);

  const description = extractQuotedField(request, 'description');
  const prompt_append =
    extractQuotedField(request, 'prompt_append') ??
    extractQuotedField(request, 'prompt') ??
    extractQuotedField(request, 'instructions');

  const lower = request.toLowerCase();
  const wantsDisableAgent = action === 'modify-agent' && /\bdisable\b/.test(lower) && !/\bhook\b/.test(lower);
  const wantsEnableAgent = action === 'modify-agent' && /\benable\b/.test(lower) && !/\bhook\b/.test(lower);

  const agentData: Partial<OmoAgent> = {};
  if (model !== undefined) agentData.model = model;
  if (temperature !== undefined) agentData.temperature = temperature;
  if (description !== undefined) agentData.description = description;
  if (prompt_append !== undefined) agentData.prompt_append = prompt_append;
  if (wantsDisableAgent) agentData.disable = true;
  if (wantsEnableAgent) agentData.disable = false;

  const categoryData: Partial<OmoCategory> = {};
  if (model !== undefined) categoryData.model = model;
  if (temperature !== undefined) categoryData.temperature = temperature;
  if (prompt_append !== undefined) categoryData.prompt_append = prompt_append;

  const opts: ActionOptions = {};
  if (backupIndex !== undefined) opts.backupIndex = backupIndex;
  if (agentName) opts.agentName = agentName;
  if (categoryName) opts.categoryName = categoryName;
  if (hookName) opts.hookName = hookName;

  if (Object.keys(agentData).length) opts.agentData = agentData;
  if (Object.keys(categoryData).length) opts.categoryData = categoryData;

  return opts;
}

function mergeOptions(a?: ActionOptions, b?: ActionOptions): ActionOptions | undefined {
  if (!a && !b) return undefined;
  return {
    ...(a ?? {}),
    ...(b ?? {}),
    agentData: { ...(a?.agentData ?? {}), ...(b?.agentData ?? {}) },
    categoryData: { ...(a?.categoryData ?? {}), ...(b?.categoryData ?? {}) },
  };
}

function redactForDisplay<T extends Record<string, unknown>>(obj: T): T {
  const copy = { ...obj } as T;
  if (typeof copy.prompt_append === 'string') {
    const len = copy.prompt_append.length;
    // Keep a tiny preview for UX, but avoid leaking entire prompts.
    (copy as Record<string, unknown>).prompt_append = len > 0 ? `<redacted: ${len} chars>` : '';
  }
  return copy;
}

const KNOWN_HOOKS = [
  'todo-continuation-enforcer',
  'context-window-monitor',
  'session-recovery',
  'session-notification',
  'comment-checker',
  'grep-output-truncator',
  'tool-output-truncator',
  'directory-agents-injector',
  'directory-readme-injector',
  'empty-task-response-detector',
  'think-mode',
  'anthropic-context-window-limit-recovery',
  'rules-injector',
  'background-notification',
  'auto-update-checker',
  'startup-toast',
  'keyword-detector',
  'agent-usage-reminder',
  'non-interactive-env',
  'interactive-bash-session',
  'compaction-context-injector',
  'thinking-block-validator',
  'claude-code-hooks',
  'ralph-loop',
  'preemptive-compaction',
] as const;

async function backupConfigsInternal(params: {
  omoConfigPath: string;
  ocConfigPath: string;
}): Promise<
  | { ok: true; archiveDir: string; omoBackup: string; ocBackup: string }
  | { ok: false; error: string }
> {
  try {
    await ensureArchiveDir();
    const timestamp = createTimestamp();
    const archiveDir = getArchiveDir();

    const omoExt = path.extname(params.omoConfigPath) || '.json';
    const ocExt = path.extname(params.ocConfigPath) || '.json';

    const omoBackupPath = path.join(archiveDir, `omo-backup-${timestamp}${omoExt}`);
    const ocBackupPath = path.join(archiveDir, `opencode-backup-${timestamp}${ocExt}`);

    await fs.copyFile(params.omoConfigPath, omoBackupPath).catch(() => writeJsonFile(omoBackupPath, {}));
    await fs.copyFile(params.ocConfigPath, ocBackupPath).catch(() => writeJsonFile(ocBackupPath, {}));

    // Clean up old backups (keep only 5 most recent)
    const allBackups = await listBackups(100);
    if (allBackups.length > 5) {
      const toDelete = allBackups.slice(5);
      for (const backup of toDelete) {
        await fs.unlink(path.join(archiveDir, backup)).catch(() => {
          // ignore
        });
      }
    }

    return {
      ok: true,
      archiveDir,
      omoBackup: path.basename(omoBackupPath),
      ocBackup: path.basename(ocBackupPath),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Core execution function that handles all actions
 */
export async function executeAction(
  action: ActionType,
  request: string,
  options?: ActionOptions
): Promise<string> {
  // Resolve config paths (JSON or JSONC) and load configs
  const omoConfigPath = await resolveOmoConfigPath();
  const ocConfigPath = await resolveOpenCodeConfigPath();
  const omoConfig = await readJsonFile<OmoConfig>(omoConfigPath, {});
  const ocConfig = await readJsonFile<OpenCodeConfig>(ocConfigPath, {});
  const existingBackups = await listBackups(5);
  const inferred = inferOptionsFromRequest(action, request);
  const effectiveOptions = mergeOptions(inferred, options);
  
  const currentDate = new Date().toISOString().split('T')[0];
  const currentTime = new Date().toTimeString().split(' ')[0];
  
  switch (action) {
    case 'list-agents': {
      const agents = omoConfig.agents || {};
      let result = '## OMO Agents\n\n| Name | Model | Temperature | Status |\n|------|-------|-------------|--------|\n';
      
      if (Object.keys(agents).length === 0) {
        result += '| *No agents configured* | | | |\n';
      } else {
        for (const [name, config] of Object.entries(agents)) {
          const model = config.model || 'N/A';
          const temp = config.temperature !== undefined ? String(config.temperature) : 'N/A';
          const disabled = config.disable ? 'Disabled' : 'Enabled';
          result += `| ${name.padEnd(20)} | ${model.padEnd(30)} | ${temp.padEnd(11)} | ${disabled.padEnd(10)} |\n`;
        }
      }
      
      return result;
    }
    
    case 'list-categories': {
      const categories = omoConfig.categories || {};
      let result = '## OMO Categories\n\n| Name | Model | Temperature | Purpose |\n|------|-------|-------------|----------|\n';
      
      if (Object.keys(categories).length === 0) {
        result += '| *No categories configured* | | | |\n';
      } else {
        for (const [name, config] of Object.entries(categories)) {
          const model = config.model || 'N/A';
          const temp = config.temperature !== undefined ? String(config.temperature) : 'N/A';
          const purpose = config.prompt_append || '';
          result += `| ${name.padEnd(20)} | ${model.padEnd(30)} | ${temp.padEnd(11)} | ${purpose.substring(0, 40)} |\n`;
        }
      }
      
      return result;
    }
    
    case 'list-skills': {
      const skills: Array<{ name: string; description: string; source: string }> = [];
      const skillDirs = [
        { dir: path.join(path.dirname(omoConfigPath), 'skills'), source: 'global' },
        { dir: path.join(process.cwd(), '.opencode', 'skills'), source: 'project' },
      ];

      const parseFrontmatter = (content: string) => {
        const lines = content.split(/\r?\n/);
        if (lines[0] !== '---') return undefined;
        const fm: Record<string, string> = {};
        for (let i = 1; i < lines.length; i++) {
          if (lines[i] === '---') break;
          const m = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)\s*$/);
          if (m) fm[m[1]] = m[2];
        }
        return fm;
      };

      for (const entry of skillDirs) {
        try {
          const dirs = await fs.readdir(entry.dir, { withFileTypes: true });
          for (const d of dirs) {
            if (!d.isDirectory()) continue;
            const skillPath = path.join(entry.dir, d.name, 'SKILL.md');
            try {
              const content = await fs.readFile(skillPath, 'utf-8');
              const fm = parseFrontmatter(content);
              const name = fm?.name ?? d.name;
              const description = fm?.description ?? '';
              skills.push({ name, description, source: entry.source });
            } catch {
              // ignore missing/invalid SKILL.md
            }
          }
        } catch {
          // ignore missing directory
        }
      }

      skills.sort((a, b) => a.name.localeCompare(b.name));
      let result = '## Available Skills\n\n| Skill | Description | Source |\n|-------|-------------|--------|\n';
      if (!skills.length) {
        result += '| *No skills found* | | |\n';
      } else {
        for (const s of skills) {
          result += `| ${s.name} | ${s.description} | ${s.source} |\n`;
        }
      }
      return result;
    }
    
    case 'check-updates': {
      // TODO: Implement actual update checking via web fetch
      return `## Checking for Updates\n\nFetching latest OMO version...\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}\n\nThis would check https://api.github.com/repos/code-yeongyu/oh-my-opencode/releases/latest\nand compare with your installed version.`;
    }
    
    case 'run-diagnostics': {
      // TODO: Implement actual diagnostics
      return `## Running Diagnostics\n\n1. Checking model resolution...\n2. Validating provider configuration...\n3. Checking for deprecated options...\n\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}\n\nThis would run full diagnostics including:\n- Model resolution for all agents/categories\n- Provider configuration validation\n- Deprecated options check\n- Schema validation`;
    }
    
    case 'backup-configs': {
      const res = await backupConfigsInternal({ omoConfigPath, ocConfigPath });
      if (!res.ok) {
        return `## Backup Configuration\n\n❌ Error creating backup: ${res.error}`;
      }
      return `## Backup Configuration\n\n✅ Successfully backed up configs!\n\nFiles backed up:\n- ${res.omoBackup}\n- ${res.ocBackup}\n\nLocation: ${res.archiveDir}\n\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}`;
    }
    
    case 'show-permissions': {
      let result = `## Permission Settings\n\n### Global Permissions (opencode.json)\n`;
      const globalPerms = ocConfig.permission || {};
      
      if (Object.keys(globalPerms).length === 0) {
        result += '*No global permissions configured*\n';
      } else {
        for (const [toolName, perm] of Object.entries(globalPerms)) {
          result += `- ${toolName}: ${perm}\n`;
        }
      }
      
      result += `\n### Agent Permissions (oh-my-opencode.json)\n`;
      const agents = omoConfig.agents || {};
      let hasAgentPerms = false;
      
      for (const [name, config] of Object.entries(agents)) {
        if (config.permission && Object.keys(config.permission).length > 0) {
          hasAgentPerms = true;
          result += `\n**${name}**:\n`;
          for (const [t, p] of Object.entries(config.permission)) {
            result += `  ${t}: ${p}\n`;
          }
        }
      }
      
      if (!hasAgentPerms) {
        result += '*No agent-specific permissions configured*\n';
      }
      
      result += `\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}`;
      return result;
    }
    
    case 'compare-backup': {
      if (effectiveOptions?.backupIndex === undefined) {
        let result = `## Compare with Backup\n\nAvailable backups:\n`;
        if (existingBackups.length === 0) {
          result += 'No backups found in archive/\n';
        } else {
          existingBackups.forEach((backup, index) => {
            result += `${index + 1}. ${backup}\n`;
          });
          result += `\nTo compare, specify which backup number to use (e.g. "compare backup 1").\n\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}`;
        }
        return result;
      }

      const idx = effectiveOptions.backupIndex;
      if (idx < 1 || idx > existingBackups.length) {
        return `## Compare with Backup\n\n❌ Invalid backup number. Please choose between 1 and ${existingBackups.length}.`;
      }

      const backupName = existingBackups[idx - 1];
      const archiveDir = getArchiveDir();
      const backupPath = path.join(archiveDir, backupName);

      if (backupName.startsWith('omo-backup-')) {
        const backupData = await readJsonFile<OmoConfig>(backupPath, {});

        const curAgents = omoConfig.agents ?? {};
        const bakAgents = backupData.agents ?? {};
        const curCats = omoConfig.categories ?? {};
        const bakCats = backupData.categories ?? {};

        const addedAgents = Object.keys(curAgents).filter((k) => !(k in bakAgents));
        const removedAgents = Object.keys(bakAgents).filter((k) => !(k in curAgents));
        const changedAgents = Object.keys(curAgents).filter(
          (k) => k in bakAgents && JSON.stringify(curAgents[k]) !== JSON.stringify(bakAgents[k])
        );

        const addedCats = Object.keys(curCats).filter((k) => !(k in bakCats));
        const removedCats = Object.keys(bakCats).filter((k) => !(k in curCats));
        const changedCats = Object.keys(curCats).filter(
          (k) => k in bakCats && JSON.stringify(curCats[k]) !== JSON.stringify(bakCats[k])
        );

        const curDisabled = omoConfig.disabled_hooks ?? [];
        const bakDisabled = backupData.disabled_hooks ?? [];

        let result = `## Compare with Backup\n\nComparing current OMO config with **${backupName}**\n\n`;
        result += `### Agents\n`;
        result += `- Added: ${addedAgents.length ? addedAgents.join(', ') : '*none*'}\n`;
        result += `- Removed: ${removedAgents.length ? removedAgents.join(', ') : '*none*'}\n`;
        result += `- Changed: ${changedAgents.length ? changedAgents.join(', ') : '*none*'}\n\n`;

        result += `### Categories\n`;
        result += `- Added: ${addedCats.length ? addedCats.join(', ') : '*none*'}\n`;
        result += `- Removed: ${removedCats.length ? removedCats.join(', ') : '*none*'}\n`;
        result += `- Changed: ${changedCats.length ? changedCats.join(', ') : '*none*'}\n\n`;

        if (JSON.stringify(curDisabled) !== JSON.stringify(bakDisabled)) {
          result += `### Disabled hooks\n`;
          result += `- Current disabled: ${curDisabled.length ? curDisabled.join(', ') : '*none*'}\n`;
          result += `- Backup disabled: ${bakDisabled.length ? bakDisabled.join(', ') : '*none*'}\n\n`;
        }

        result += `Current date: ${currentDate}\nCurrent time: ${currentTime}`;
        return result;
      }

      if (backupName.startsWith('opencode-backup-')) {
        const backupData = await readJsonFile<OpenCodeConfig>(backupPath, {});

        const curPlugins = ocConfig.plugin ?? [];
        const bakPlugins = backupData.plugin ?? [];

        const curProviders = Object.keys(ocConfig.provider ?? {});
        const bakProviders = Object.keys(backupData.provider ?? {});

        const addedProviders = curProviders.filter((k) => !bakProviders.includes(k));
        const removedProviders = bakProviders.filter((k) => !curProviders.includes(k));

        let result = `## Compare with Backup\n\nComparing current OpenCode config with **${backupName}**\n\n`;
        if (JSON.stringify(curPlugins) !== JSON.stringify(bakPlugins)) {
          result += `### Plugins\n`;
          result += `- Current: ${curPlugins.length ? curPlugins.join(', ') : '*none*'}\n`;
          result += `- Backup: ${bakPlugins.length ? bakPlugins.join(', ') : '*none*'}\n\n`;
        }

        result += `### Providers\n`;
        result += `- Added: ${addedProviders.length ? addedProviders.join(', ') : '*none*'}\n`;
        result += `- Removed: ${removedProviders.length ? removedProviders.join(', ') : '*none*'}\n\n`;
        result += `Current date: ${currentDate}\nCurrent time: ${currentTime}`;
        return result;
      }

      return `## Compare with Backup\n\n❌ Unknown backup type: ${backupName}`;
    }
    
    case 'restore-backup': {
      if (effectiveOptions?.backupIndex === undefined) {
        let result = `## Restore from Backup\n\nAvailable backups:\n`;
        if (existingBackups.length === 0) {
          result += 'No backups found in archive/\n';
        } else {
          existingBackups.forEach((backup, index) => {
            result += `${index + 1}. ${backup}\n`;
          });
          result += `\nTo restore, specify which backup number to use (e.g. "restore backup 2").\n\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}`;
        }
        return result;
      }
      
      // Actually restore the backup
      try {
        const backupIndex = effectiveOptions.backupIndex;
        if (backupIndex < 1 || backupIndex > existingBackups.length) {
          return `## Restore from Backup\n\n❌ Invalid backup number. Please choose between 1 and ${existingBackups.length}.`;
        }
        
        const backupName = existingBackups[backupIndex - 1];
        const archiveDir = getArchiveDir();
        const backupPath = path.join(archiveDir, backupName);
        // Safety: backup current configs before overwriting.
        await backupConfigsInternal({ omoConfigPath, ocConfigPath });
        
        if (backupName.startsWith('omo-backup-')) {
          const backupData = await readJsonFile<OmoConfig>(backupPath, {});
          await writeJsonFile(omoConfigPath, backupData);
          return `## Restore from Backup\n\n✅ Successfully restored OMO config from ${backupName}\n\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}`;
        } else if (backupName.startsWith('opencode-backup-')) {
          const backupData = await readJsonFile<OpenCodeConfig>(backupPath, {});
          await writeJsonFile(ocConfigPath, backupData);
          return `## Restore from Backup\n\n✅ Successfully restored OpenCode config from ${backupName}\n\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}`;
        } else {
          return `## Restore from Backup\n\n❌ Unknown backup type: ${backupName}`;
        }
      } catch (error) {
        return `## Restore from Backup\n\n❌ Error restoring backup: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    
    case 'add-agent': {
      if (!effectiveOptions?.agentName) {
        const currentAgents = Object.keys(omoConfig.agents || {});
        let result = `## Add New Agent\n\nCurrent agents:\n`;
        if (currentAgents.length === 0) {
          result += '*No agents configured*\n';
        } else {
          currentAgents.forEach((name) => {
            result += `- ${name}\n`;
          });
        }
        result += `\nTo add an agent, provide:\n- Agent name\n- Model (e.g., opencode/gpt-5.2, anthropic/claude-opus-4.5)\n- Temperature (0.0-1.0, optional)\n- Prompt append instructions (optional)\n\nExample: "add agent debugger with model opencode/gpt-5.2 and temperature 0.2"`;
        return result;
      }
      
      // Actually add the agent
      try {
        const agentName = effectiveOptions.agentName;
        if (!isSafeConfigKey(agentName)) {
          return `## Add New Agent\n\n❌ Invalid agent name: "${agentName}".\n\nUse only letters, numbers, hyphen, underscore (max 64 chars) and avoid reserved keys like "__proto__".`;
        }

        const agentData = effectiveOptions.agentData ?? {};
        if (!agentData.model) {
          return `## Add New Agent\n\n❌ Missing required field: model.\n\nExample: "add agent debugger with model opencode/gpt-5.2 and temperature 0.2"`;
        }

        if (agentData.temperature !== undefined && (agentData.temperature < 0 || agentData.temperature > 1)) {
          return `## Add New Agent\n\n❌ Temperature must be between 0.0 and 1.0.`;
        }

        // Safety: backup current configs before mutating.
        await backupConfigsInternal({ omoConfigPath, ocConfigPath });

        if (!omoConfig.agents) {
          omoConfig.agents = {};
        }
        
        omoConfig.agents[agentName] = {
          model: agentData.model,
          temperature: agentData.temperature,
          prompt_append: agentData.prompt_append,
          permission: agentData.permission,
          description: agentData.description,
          disable: agentData.disable,
        };
        
        await writeJsonFile(omoConfigPath, omoConfig);
        return `## Add New Agent\n\n✅ Successfully added agent "${agentName}"\n\nConfiguration:\n${JSON.stringify(redactForDisplay(omoConfig.agents[agentName] as unknown as Record<string, unknown>), null, 2)}\n\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}`;
      } catch (error) {
        return `## Add New Agent\n\n❌ Error adding agent: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    
    case 'modify-agent': {
      if (!effectiveOptions?.agentName) {
        const currentAgents = Object.keys(omoConfig.agents || {});
        let result = `## Modify Agent\n\nCurrent agents:\n`;
        if (currentAgents.length === 0) {
          result += '*No agents configured*\n';
        } else {
          currentAgents.forEach((name, index) => {
            result += `${index + 1}. ${name}\n`;
          });
        }
        result += `\nTo modify an agent, specify the agent name and what to change.\nExample: "modify agent oracle set temperature to 0.3"`;
        return result;
      }
      
      // Actually modify the agent
      try {
        const agentName = effectiveOptions.agentName;
        if (!isSafeConfigKey(agentName)) {
          return `## Modify Agent\n\n❌ Invalid agent name: "${agentName}".`;
        }

        const agentData = effectiveOptions.agentData ?? {};
        if (agentData.temperature !== undefined && (agentData.temperature < 0 || agentData.temperature > 1)) {
          return `## Modify Agent\n\n❌ Temperature must be between 0.0 and 1.0.`;
        }

        if (!omoConfig.agents || !omoConfig.agents[agentName]) {
          return `## Modify Agent\n\n❌ Agent "${agentName}" not found.`;
        }
        
        // Safety: backup current configs before mutating.
        await backupConfigsInternal({ omoConfigPath, ocConfigPath });

        const agent = omoConfig.agents[agentName];
        if (agentData.model !== undefined) agent.model = agentData.model;
        if (agentData.temperature !== undefined) agent.temperature = agentData.temperature;
        if (agentData.prompt_append !== undefined) agent.prompt_append = agentData.prompt_append;
        if (agentData.permission !== undefined) agent.permission = agentData.permission;
        if (agentData.description !== undefined) agent.description = agentData.description;
        if (agentData.disable !== undefined) agent.disable = agentData.disable;
        
        await writeJsonFile(omoConfigPath, omoConfig);
        return `## Modify Agent\n\n✅ Successfully modified agent "${agentName}"\n\nUpdated configuration:\n${JSON.stringify(redactForDisplay(agent as unknown as Record<string, unknown>), null, 2)}\n\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}`;
      } catch (error) {
        return `## Modify Agent\n\n❌ Error modifying agent: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    
    case 'add-category': {
      if (!effectiveOptions?.categoryName) {
        const currentCategories = Object.keys(omoConfig.categories || {});
        let result = `## Add New Category\n\nCurrent categories:\n`;
        if (currentCategories.length === 0) {
          result += '*No categories configured*\n';
        } else {
          currentCategories.forEach((name) => {
            result += `- ${name}\n`;
          });
        }
        result += `\nTo add a category, provide:\n- Category name\n- Model (e.g., opencode/gpt-5.2, anthropic/claude-opus-4.5)\n- Temperature (0.0-1.0, optional)\n- Prompt append instructions (optional)\n\nExample: "add category data-science with model anthropic/claude-sonnet-4.5"`;
        return result;
      }
      
      // Actually add the category
      try {
        const categoryName = effectiveOptions.categoryName;
        if (!isSafeConfigKey(categoryName)) {
          return `## Add New Category\n\n❌ Invalid category name: "${categoryName}".\n\nUse only letters, numbers, hyphen, underscore (max 64 chars) and avoid reserved keys like "__proto__".`;
        }

        const categoryData = effectiveOptions.categoryData ?? {};
        if (!categoryData.model) {
          return `## Add New Category\n\n❌ Missing required field: model.\n\nExample: "add category data-science with model anthropic/claude-sonnet-4.5"`;
        }

        if (categoryData.temperature !== undefined && (categoryData.temperature < 0 || categoryData.temperature > 1)) {
          return `## Add New Category\n\n❌ Temperature must be between 0.0 and 1.0.`;
        }

        // Safety: backup current configs before mutating.
        await backupConfigsInternal({ omoConfigPath, ocConfigPath });

        if (!omoConfig.categories) {
          omoConfig.categories = {};
        }
        
        omoConfig.categories[categoryName] = {
          model: categoryData.model,
          temperature: categoryData.temperature,
          top_p: categoryData.top_p,
          maxTokens: categoryData.maxTokens,
          prompt_append: categoryData.prompt_append,
        };
        
        await writeJsonFile(omoConfigPath, omoConfig);
        return `## Add New Category\n\n✅ Successfully added category "${categoryName}"\n\nConfiguration:\n${JSON.stringify(redactForDisplay(omoConfig.categories[categoryName] as unknown as Record<string, unknown>), null, 2)}\n\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}`;
      } catch (error) {
        return `## Add New Category\n\n❌ Error adding category: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    
    case 'modify-category': {
      if (!effectiveOptions?.categoryName) {
        const currentCategories = Object.keys(omoConfig.categories || {});
        let result = `## Modify Category\n\nCurrent categories:\n`;
        if (currentCategories.length === 0) {
          result += '*No categories configured*\n';
        } else {
          currentCategories.forEach((name, index) => {
            result += `${index + 1}. ${name}\n`;
          });
        }
        result += `\nTo modify a category, specify the category name and what to change.\nExample: "modify category quick set temperature to 0.5"`;
        return result;
      }
      
      // Actually modify the category
      try {
        const categoryName = effectiveOptions.categoryName;
        if (!isSafeConfigKey(categoryName)) {
          return `## Modify Category\n\n❌ Invalid category name: "${categoryName}".`;
        }

        const categoryData = effectiveOptions.categoryData ?? {};
        if (categoryData.temperature !== undefined && (categoryData.temperature < 0 || categoryData.temperature > 1)) {
          return `## Modify Category\n\n❌ Temperature must be between 0.0 and 1.0.`;
        }

        if (!omoConfig.categories || !omoConfig.categories[categoryName]) {
          return `## Modify Category\n\n❌ Category "${categoryName}" not found.`;
        }
        
        // Safety: backup current configs before mutating.
        await backupConfigsInternal({ omoConfigPath, ocConfigPath });

        const category = omoConfig.categories[categoryName];
        if (categoryData.model !== undefined) category.model = categoryData.model;
        if (categoryData.temperature !== undefined) category.temperature = categoryData.temperature;
        if (categoryData.top_p !== undefined) category.top_p = categoryData.top_p;
        if (categoryData.maxTokens !== undefined) category.maxTokens = categoryData.maxTokens;
        if (categoryData.prompt_append !== undefined) category.prompt_append = categoryData.prompt_append;
        
        await writeJsonFile(omoConfigPath, omoConfig);
        return `## Modify Category\n\n✅ Successfully modified category "${categoryName}"\n\nUpdated configuration:\n${JSON.stringify(redactForDisplay(category as unknown as Record<string, unknown>), null, 2)}\n\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}`;
      } catch (error) {
        return `## Modify Category\n\n❌ Error modifying category: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    
    case 'disable-hook': {
      if (!effectiveOptions?.hookName) {
        let result = `## Disable Hook\n\nAvailable hooks:\n`;
        KNOWN_HOOKS.forEach((hook) => {
          result += `- ${hook}\n`;
        });
        result += `\nTo disable a hook, specify the hook name.\nExample: "disable hook comment-checker"`;
        return result;
      }
      
      // Actually disable the hook
      try {
        const hookName = effectiveOptions.hookName;
        if (!KNOWN_HOOKS.includes(hookName as (typeof KNOWN_HOOKS)[number])) {
          return `## Disable Hook\n\n❌ Unknown hook: "${hookName}"\n\nAvailable hooks: ${KNOWN_HOOKS.join(', ')}`;
        }
        
        if (!omoConfig.disabled_hooks) {
          omoConfig.disabled_hooks = [];
        }
        
        if (!omoConfig.disabled_hooks.includes(hookName)) {
          // Safety: backup current configs before mutating.
          await backupConfigsInternal({ omoConfigPath, ocConfigPath });
          omoConfig.disabled_hooks.push(hookName);
          await writeJsonFile(omoConfigPath, omoConfig);
          return `## Disable Hook\n\n✅ Successfully disabled hook "${hookName}"\n\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}`;
        } else {
          return `## Disable Hook\n\nℹ️ Hook "${hookName}" is already disabled.\n\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}`;
        }
      } catch (error) {
        return `## Disable Hook\n\n❌ Error disabling hook: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    
    case 'enable-hook': {
      const disabledHooks = omoConfig.disabled_hooks || [];
      
      if (!effectiveOptions?.hookName) {
        let result = `## Enable Hook\n\nCurrently disabled hooks:\n`;
        if (disabledHooks.length === 0) {
          result += 'No hooks are currently disabled.\n';
        } else {
          disabledHooks.forEach((hook: string, index: number) => {
            result += `${index + 1}. ${hook}\n`;
          });
        }
        result += `\nTo enable a hook, specify the hook name.\nExample: "enable hook comment-checker"`;
        return result;
      }
      
      // Actually enable the hook
      try {
        const hookName = effectiveOptions.hookName;
        if (!omoConfig.disabled_hooks || !omoConfig.disabled_hooks.includes(hookName)) {
          return `## Enable Hook\n\nℹ️ Hook "${hookName}" is not currently disabled.`;
        }
        
        // Safety: backup current configs before mutating.
        await backupConfigsInternal({ omoConfigPath, ocConfigPath });
        omoConfig.disabled_hooks = omoConfig.disabled_hooks.filter(h => h !== hookName);
        await writeJsonFile(omoConfigPath, omoConfig);
        return `## Enable Hook\n\n✅ Successfully enabled hook "${hookName}"\n\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}`;
      } catch (error) {
        return `## Enable Hook\n\n❌ Error enabling hook: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    
    case 'list-oc-models': {
      const providers = ocConfig.provider || {};
      let result = '## OpenCode Configured Models\n\n';
      
      if (Object.keys(providers).length === 0) {
        result += '*No providers configured*\n';
      } else {
        for (const [providerName, providerConfig] of Object.entries(providers)) {
          const pc = providerConfig as { models?: Record<string, { name?: string; tools?: boolean; reasoning?: boolean; options?: { num_ctx?: number } }> };
          result += `\n### ${providerName}\n`;
          const models = pc.models || {};
          
          if (Object.keys(models).length === 0) {
            result += '*No models configured*\n';
          } else {
            for (const [modelId, modelConfig] of Object.entries(models)) {
              const name = modelConfig.name || modelId;
              const tools = modelConfig.tools ? 'Yes' : 'No';
              const reasoning = modelConfig.reasoning ? 'Yes' : 'No';
              const ctxWindow = modelConfig.options?.num_ctx ? String(modelConfig.options.num_ctx) : 'N/A';
              result += `- ${name} (ID: ${modelId})\n  - Tools: ${tools}\n  - Reasoning: ${reasoning}\n  - Context: ${ctxWindow}\n`;
            }
          }
        }
      }
      
      result += `\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}`;
      return result;
    }
    
    default: {
      return `## OMO Configuration Manager\n\nI didn't understand your request. Here are some examples:\n\n- \`list my agents\` or \`show agents config\`\n- \`list categories\` or \`what categories do I have?\`\n- \`check for updates\` or \`validate my config\`\n- \`backup my configs\` or \`run diagnostics\`\n- \`show permissions\` or \`restore from backup\`\n- \`add a new agent called debugger\`\n- \`modify oracle agent\`\n- \`add a category called data-science\`\n- \`disable comment-checker hook\`\n- \`list my opencode models\`\n\nContext:\n- Current date: ${currentDate}\n- Current time: ${currentTime}\n\nOr be more specific about what you want to do with your OMO/OpenCode configuration.`;
    }
  }
}
