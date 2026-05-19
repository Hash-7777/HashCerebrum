// Tool definitions consumed by the agent tool-calling loop.

export interface Tool<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute(args: TArgs): Promise<TResult>;
}
