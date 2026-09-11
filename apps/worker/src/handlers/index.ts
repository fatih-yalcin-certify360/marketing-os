import type { JobType } from '@c360/contracts';
import type { GenerationDeps } from '@c360/api/generation-deps';
import { DemoEchoHandler } from './demo-echo.js';
import { createGenerationHandlers } from './generation.js';
import { defineHandler, type RegisteredHandler } from './types.js';

export * from './types.js';
export { DemoEchoHandler } from './demo-echo.js';
export { createGenerationHandlers } from './generation.js';

/**
 * Handler registry.
 *
 * A job type with no registered handler is a configuration error, not
 * something to guess at: the runner fails such a job as `validation_failed`
 * with a clear message rather than silently leaving it queued forever.
 */
export type HandlerRegistry = ReadonlyMap<JobType, RegisteredHandler>;

export interface RegistryOptions {
  demoStepDelayMs?: number | undefined;
  /**
   * Services the generation handlers need. Omitted in tests that only exercise
   * the queue machinery, which is why the registry works without them.
   */
  generation?: GenerationDeps | undefined;
}

export function createHandlerRegistry(options: RegistryOptions = {}): HandlerRegistry {
  const handlers: RegisteredHandler[] = [
    defineHandler(new DemoEchoHandler(options.demoStepDelayMs)),
    ...(options.generation === undefined ? [] : createGenerationHandlers(options.generation)),
  ];
  return new Map(handlers.map((handler) => [handler.type, handler]));
}
