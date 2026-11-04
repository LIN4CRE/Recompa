import type { EngineAdapter } from '@/core/types';
import { JsnesAdapter } from './nes/adapter';
import { MgbaAdapter } from './mgba/adapter';

/**
 * Engine registry.
 *
 * Adding a platform means adding an adapter here — nothing in the planner, UI
 * or storage layer knows platform specifics. See docs/ADDING-ENGINES.md.
 */
export const ENGINE_ADAPTERS: EngineAdapter[] = [JsnesAdapter, MgbaAdapter];

export const ADAPTER_BY_ID = new Map(ENGINE_ADAPTERS.map((a) => [a.descriptor.id, a]));

export function getAdapter(id: string): EngineAdapter | undefined {
  return ADAPTER_BY_ID.get(id);
}

/** Engines that are declared but not executable in this deployment. */
export const PLANNED_ENGINES = ['emulatorjs-nes', 'n64recomp'] as const;
