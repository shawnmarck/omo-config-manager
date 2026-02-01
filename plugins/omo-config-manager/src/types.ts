/**
 * TypeScript interfaces for OMO and OpenCode configuration structures
 */

export interface OmoAgent {
  model?: string;
  temperature?: number;
  disable?: boolean;
  prompt_append?: string;
  permission?: Record<string, string>;
  description?: string;
  tools?: Record<string, unknown>;
  top_p?: number;
  maxTokens?: number;
}

export interface OmoCategory {
  model?: string;
  temperature?: number;
  top_p?: number;
  maxTokens?: number;
  prompt_append?: string;
}

export interface OmoConfig {
  agents?: Record<string, OmoAgent>;
  categories?: Record<string, OmoCategory>;
  disabled_hooks?: string[];
  sisyphus_agent?: string;
  background_task_concurrency?: number;
  mcp?: Record<string, unknown>;
  lsp?: Record<string, unknown>;
  skills?: Record<string, unknown>;
}

export interface OpenCodeModel {
  name?: string;
  tools?: boolean;
  reasoning?: boolean;
  options?: {
    num_ctx?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface OpenCodeProvider {
  models?: Record<string, OpenCodeModel>;
  [key: string]: unknown;
}

export interface OpenCodeConfig {
  provider?: Record<string, OpenCodeProvider>;
  permission?: Record<string, string>;
  plugin?: string[];
  agent?: Record<string, unknown>;
  instruction?: string[];
  [key: string]: unknown;
}
