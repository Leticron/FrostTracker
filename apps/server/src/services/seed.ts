import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { seedData, seedFiles, type SeedData } from '@fht/shared';
import { desc } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.ts';
import { classDefs, gameDataSets, itemDefs, personalQuestDefs } from '../db/schema.ts';
import { writeAudit } from '../audit.ts';

export class SeedError extends Error {}

/** Reads and validates a seed directory. Throws SeedError with readable messages. */
export async function readSeedDir(dir: string): Promise<SeedData> {
  if (!existsSync(join(dir, seedFiles.manifest.file))) {
    throw new SeedError(`No seed found: ${join(dir, seedFiles.manifest.file)} is missing`);
  }
  const raw: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(seedFiles)) {
    const path = join(dir, spec.file);
    if (!existsSync(path)) {
      if (spec.required) throw new SeedError(`${spec.file} is missing`);
      continue;
    }
    try {
      raw[name] = JSON.parse(await readFile(path, 'utf8'));
    } catch (err) {
      throw new SeedError(`${spec.file}: invalid JSON (${(err as Error).message})`);
    }
  }
  const parsed = seedData.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 20)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new SeedError(`Seed is invalid: ${issues}`);
  }
  const data = parsed.data;
  assertUnique(
    data.ruleTables.resources.map((r) => r.key),
    'resource key',
  );
  assertUnique(
    data.classes.map((c) => c.key),
    'class key',
  );
  assertUnique(
    data.items.map((i) => i.number),
    'item number',
  );
  assertUnique(
    data.personalQuests.map((p) => p.number),
    'personal quest number',
  );
  return data;
}

function assertUnique(values: (string | number)[], what: string) {
  const seen = new Set<string | number>();
  for (const v of values) {
    if (seen.has(v)) throw new SeedError(`Duplicate ${what}: ${v}`);
    seen.add(v);
  }
}

/** Imports a seed as a new game data set. Existing campaigns keep their data set. */
export async function importSeed(tx: Tx, data: SeedData, actorUserId: string | null) {
  const [set] = await tx
    .insert(gameDataSets)
    .values({
      name: data.manifest.name,
      version: data.manifest.version,
      locale: data.manifest.locale,
      ruleTables: data.ruleTables,
      importedBy: actorUserId,
    })
    .returning();
  const id = set!.id;
  if (data.classes.length) {
    await tx.insert(classDefs).values(data.classes.map((c) => ({ ...c, dataSetId: id })));
  }
  if (data.items.length) {
    await tx.insert(itemDefs).values(data.items.map((i) => ({ ...i, dataSetId: id })));
  }
  if (data.personalQuests.length) {
    await tx
      .insert(personalQuestDefs)
      .values(data.personalQuests.map((p) => ({ ...p, dataSetId: id })));
  }
  await writeAudit(tx, actorUserId, [
    {
      entity: 'game_data_set',
      entityId: id,
      action: 'import',
      after: {
        name: data.manifest.name,
        version: data.manifest.version,
        classes: data.classes.length,
        items: data.items.length,
        personalQuests: data.personalQuests.length,
      },
    },
  ]);
  return set!;
}

export async function latestDataSetId(db: Db | Tx): Promise<string | null> {
  const rows = await db
    .select({ id: gameDataSets.id })
    .from(gameDataSets)
    .orderBy(desc(gameDataSets.importedAt))
    .limit(1);
  return rows[0]?.id ?? null;
}
