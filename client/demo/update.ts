/**
 * Stands in for server/update.ts in the browser-only demo, which has no copy of itself to update (the
 * ⚙️ menu's 🔄 Update is hidden there).
 */
import type { IncomingPack, UpdateInfo, UpdateResult } from '../../shared/types.ts';

export const UPDATE_EXIT = 75;
export const updateInfo = async (_check: boolean): Promise<UpdateInfo> => ({ can: false, why: "The demo can't update itself." });
export const incomingPacks = async (): Promise<IncomingPack[]> => [];
export const freshUpdate = async (): Promise<UpdateResult | undefined> => undefined;
