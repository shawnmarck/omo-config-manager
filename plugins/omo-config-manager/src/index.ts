/**
 * OpenCode plugin wrapper for OMO configuration management
 * Registers the /omo-config tool that works with natural language requests
 */
import { type Plugin, tool } from '@opencode-ai/plugin';
import { parseAction, executeAction } from './core.js';

export const OmoConfigPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      'omo-config': tool({
        description: "OMO configuration management tool. Use natural language to list agents, categories, skills, check updates, run diagnostics, backup/restore configs, manage permissions, and modify agents/categories/hooks. Examples: 'list my agents', 'backup my configs', 'add agent debugger'.",
        args: {
          request: tool.schema.string().describe("The OMO configuration request or action to perform in natural language")
        },
        async execute(args, context) {
          try {
            const action = parseAction(args.request);
            const result = await executeAction(action, args.request);
            return result;
          } catch (error) {
            return `## Error\n\n❌ An error occurred: ${error instanceof Error ? error.message : String(error)}\n\nPlease try again or check your configuration files.`;
          }
        }
      })
    }
  };
};

// Default export for convenience
export default OmoConfigPlugin;
