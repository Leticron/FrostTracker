import { sql } from 'drizzle-orm';
import type { PerkDef, ResourceBag, RuleTables } from '@fht/shared';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------- accounts

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    username: text().notNull(),
    email: text(),
    displayName: text().notNull(),
    /** PHC-formatted Argon2id hash; null for OIDC-only accounts. */
    passwordHash: text(),
    isSiteAdmin: boolean().notNull().default(false),
    locale: text().notNull().default('en'),
    disabledAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_username_lower_idx').on(sql`lower(${t.username})`),
    uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 hex of the random session token; the token itself is never stored. */
    tokenHash: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    userAgent: text(),
    ip: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const oidcIdentities = pgTable(
  'oidc_identities',
  {
    issuer: text().notNull(),
    subject: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.issuer, t.subject] })],
);

// ---------------------------------------------------------------- game data (from seeds)

export const gameDataSets = pgTable('game_data_sets', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  version: text().notNull(),
  locale: text().notNull(),
  ruleTables: jsonb().$type<RuleTables>().notNull(),
  importedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  importedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const classDefs = pgTable(
  'class_defs',
  {
    dataSetId: uuid()
      .notNull()
      .references(() => gameDataSets.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    name: text().notNull(),
    starting: boolean().notNull().default(false),
    perks: jsonb().$type<PerkDef[]>().notNull().default([]),
    masteries: jsonb().$type<string[]>().notNull().default([]),
    maxHpByLevel: jsonb().$type<number[] | null>(),
    handSize: integer(),
  },
  (t) => [primaryKey({ columns: [t.dataSetId, t.key] })],
);

export const itemDefs = pgTable(
  'item_defs',
  {
    dataSetId: uuid()
      .notNull()
      .references(() => gameDataSets.id, { onDelete: 'cascade' }),
    number: integer().notNull(),
    name: text().notNull(),
    type: text(),
    goldCost: integer(),
    craftCostCount: integer(),
    quantity: integer(),
  },
  (t) => [primaryKey({ columns: [t.dataSetId, t.number] })],
);

export const personalQuestDefs = pgTable(
  'personal_quest_defs',
  {
    dataSetId: uuid()
      .notNull()
      .references(() => gameDataSets.id, { onDelete: 'cascade' }),
    number: integer().notNull(),
    name: text().notNull(),
    envelope: text(),
    altEnvelope: text(),
  },
  (t) => [primaryKey({ columns: [t.dataSetId, t.number] })],
);

// ---------------------------------------------------------------- campaigns

export const campaignRole = pgEnum('campaign_role', ['host', 'player']);

export const campaigns = pgTable('campaigns', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  partyName: text(),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  gameDataSetId: uuid().references(() => gameDataSets.id, { onDelete: 'restrict' }),
  /** Marked prosperity boxes (level is derived from the rule tables). */
  prosperityChecks: integer().notNull().default(0),
  /** Frosthaven supply: resource key -> amount. */
  supply: jsonb().$type<ResourceBag>().notNull().default({}),
  version: integer().notNull().default(1),
  ...timestamps,
});

export const campaignMembers = pgTable(
  'campaign_members',
  {
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: campaignRole().notNull(),
    joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.userId] }),
    index('members_user_idx').on(t.userId),
  ],
);

export const invites = pgTable(
  'invites',
  {
    id: uuid().primaryKey().defaultRandom(),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** SHA-256 hex of the invite code; the code is shown once on creation. */
    codeHash: text().notNull().unique(),
    role: campaignRole().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    maxUses: integer().notNull(),
    uses: integer().notNull().default(0),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('invites_campaign_idx').on(t.campaignId)],
);

export const campaignClassUnlocks = pgTable(
  'campaign_class_unlocks',
  {
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    classKey: text().notNull(),
    unlockedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.classKey] })],
);

// ---------------------------------------------------------------- characters

export const characterStatus = pgEnum('character_status', [
  'active',
  'set_aside',
  'abandoned',
  'retired',
  'dead',
]);

export const characters = pgTable(
  'characters',
  {
    id: uuid().primaryKey().defaultRandom(),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    ownerUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    classKey: text().notNull(),
    name: text().notNull(),
    status: characterStatus().notNull().default('active'),
    level: integer().notNull().default(1),
    xp: integer().notNull().default(0),
    gold: integer().notNull().default(0),
    resources: jsonb().$type<ResourceBag>().notNull().default({}),
    checkmarks: integer().notNull().default(0),
    /** Marked boxes per perk, in class perk order. */
    perkMarks: jsonb().$type<number[]>().notNull().default([]),
    masteries: jsonb().$type<boolean[]>().notNull().default([]),
    /** Perk marks granted at creation for the player's earlier retirements. */
    bonusPerkMarks: integer().notNull().default(0),
    personalQuestNumber: integer(),
    personalQuestText: text(),
    personalQuestProgress: text().notNull().default(''),
    notes: text().notNull().default(''),
    retiredAt: timestamp({ withTimezone: true }),
    version: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index('characters_campaign_idx').on(t.campaignId),
    // RULE: R-CHAR-02 - one character per class at a time (set-aside characters still count).
    uniqueIndex('characters_one_per_class_idx')
      .on(t.campaignId, t.classKey)
      .where(sql`${t.status} in ('active', 'set_aside')`),
  ],
);

export const characterItems = pgTable(
  'character_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    characterId: uuid()
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    itemNumber: integer(),
    name: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('character_items_character_idx').on(t.characterId),
    // RULE: R-CHAR-15 - at most one copy of an item per character.
    uniqueIndex('character_items_unique_idx')
      .on(t.characterId, t.itemNumber)
      .where(sql`${t.itemNumber} is not null`),
  ],
);

// ---------------------------------------------------------------- audit log

export const auditEntries = pgTable(
  'audit_entries',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Entries written by one user action share a group id (revert works on groups). */
    groupId: uuid().notNull(),
    campaignId: uuid().references(() => campaigns.id, { onDelete: 'cascade' }),
    characterId: uuid(),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    entity: text().notNull(),
    entityId: text().notNull(),
    action: text().notNull(),
    before: jsonb(),
    after: jsonb(),
    revertedBy: uuid(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_campaign_idx').on(t.campaignId, t.at),
    index('audit_character_idx').on(t.characterId, t.at),
    index('audit_group_idx').on(t.groupId),
  ],
);
