import type { Tool } from './types';

class ToolRegistry {
  private tools = new Map<string, Tool>();

  register<TArgs, TResult>(tool: Tool<TArgs, TResult>) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as Tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }
}

export const tools = new ToolRegistry();
