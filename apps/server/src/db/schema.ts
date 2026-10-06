import { sql } from 'drizzle-orm';
import type {
  BuildingDef,
  Effect,
  PerkDef,
  Requirement,
  ResourceBag,
  RuleTables,
} from '@fht/shared';
import {
  boolean,
  doublePrecision,
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

export const scenarioDefs = pgTable(
  'scenario_defs',
  {
    dataSetId: uuid()
      .notNull()
      .references(() => gameDataSets.id, { onDelete: 'cascade' }),
    number: integer().notNull(),
    name: text().notNull(),
    coord: text(),
    region: text(),
    complexity: integer(),
    requirements: jsonb().$type<Requirement[]>().notNull().default([]),
    conclusionSections: jsonb().$type<string[]>().notNull().default([]),
    initiallyUnlocked: boolean().notNull().default(false),
    /** Marker position relative to the map image (0..1), set in marker mode. */
    markerX: doublePrecision(),
    markerY: doublePrecision(),
    markerLayer: text(),
  },
  (t) => [primaryKey({ columns: [t.dataSetId, t.number] })],
);

export const sectionDefs = pgTable(
  'section_defs',
  {
    dataSetId: uuid()
      .notNull()
      .references(() => gameDataSets.id, { onDelete: 'cascade' }),
    ref: text().notNull(),
    title: text().notNull().default(''),
    scenarioNumber: integer(),
    effects: jsonb().$type<Effect[]>().notNull().default([]),
    rewardsText: text(),
  },
  (t) => [primaryKey({ columns: [t.dataSetId, t.ref] })],
);

export const buildingDefs = pgTable(
  'building_defs',
  {
    dataSetId: uuid()
      .notNull()
      .references(() => gameDataSets.id, { onDelete: 'cascade' }),
    number: integer().notNull(),
    name: text().notNull(),
    starting: boolean().notNull().default(false),
    levels: jsonb().$type<BuildingDef['levels']>().notNull().default([]),
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
  /** Number of marked calendar weeks (0 = none). */
  currentWeek: integer().notNull().default(0),
  /** null until the starting morale is set (end of the first scenario). */
  morale: integer(),
  defense: integer().notNull().default(0),
  soldiers: integer().notNull().default(0),
  inspiration: integer().notNull().default(0),
  /** Morale track sections can be replaced during play; null = use the rule tables. */
  moraleMinSection: text(),
  moraleMaxSection: text(),
  /** Starting scenarios and buildings of the data set were created. */
  setupDone: boolean().notNull().default(false),
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
    id: uuid().notNull().unique().defaultRandom(),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    classKey: text().notNull(),
    unlockedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.classKey] })],
);

export const scenarioStatus = pgEnum('scenario_status', ['unlocked', 'completed', 'locked_out']);

export const campaignScenarios = pgTable(
  'campaign_scenarios',
  {
    id: uuid().primaryKey().defaultRandom(),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    scenarioNumber: integer().notNull(),
    status: scenarioStatus().notNull(),
    timesCompleted: integer().notNull().default(0),
    /** Host decided the (free-text) requirements are met. */
    requirementOverride: boolean().notNull().default(false),
    unlockedBy: text(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('campaign_scenarios_unique_idx').on(t.campaignId, t.scenarioNumber)],
);

export const campaignStickers = pgTable(
  'campaign_stickers',
  {
    id: uuid().primaryKey().defaultRandom(),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    count: integer().notNull().default(1),
  },
  (t) => [uniqueIndex('campaign_stickers_unique_idx').on(t.campaignId, t.name)],
);

export const calendarSource = pgEnum('calendar_source', ['preprinted', 'added']);

export const calendarEntries = pgTable(
  'calendar_entries',
  {
    id: uuid().primaryKey().defaultRandom(),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** Absolute week number (1 = first box). */
    week: integer().notNull(),
    sectionRef: text().notNull(),
    source: calendarSource().notNull(),
    resolvedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('calendar_campaign_idx').on(t.campaignId, t.week)],
);

export const treasuresLooted = pgTable(
  'treasures_looted',
  {
    id: uuid().primaryKey().defaultRandom(),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    number: integer().notNull(),
    lootedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('treasures_unique_idx').on(t.campaignId, t.number)],
);

export const buildingState = pgEnum('building_state', ['unlocked', 'built', 'wrecked']);

export const campaignBuildings = pgTable(
  'campaign_buildings',
  {
    id: uuid().primaryKey().defaultRandom(),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    number: integer().notNull(),
    name: text().notNull(),
    level: integer().notNull().default(0),
    state: buildingState().notNull().default('unlocked'),
  },
  (t) => [uniqueIndex('campaign_buildings_unique_idx').on(t.campaignId, t.number)],
);

export const eventKind = pgEnum('event_kind', ['road', 'outpost']);

export const eventLog = pgTable(
  'event_log',
  {
    id: uuid().primaryKey().defaultRandom(),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    kind: eventKind().notNull(),
    eventRef: text().notNull(),
    option: text().notNull().default(''),
    note: text().notNull().default(''),
    week: integer().notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('event_log_campaign_idx').on(t.campaignId, t.at)],
);

export const eventDeckChanges = pgTable(
  'event_deck_changes',
  {
    id: uuid().primaryKey().defaultRandom(),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    deck: text().notNull(),
    eventRef: text().notNull(),
    op: text().notNull(),
    sectionRef: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('event_deck_campaign_idx').on(t.campaignId, t.at)],
);

export const sessionOutcome = pgEnum('session_outcome', ['completed', 'lost']);
export const sessionStatus = pgEnum('session_status', ['applied', 'reverted']);

export const playSessions = pgTable(
  'play_sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    date: text().notNull(),
    scenarioNumber: integer(),
    scenarioLevel: integer().notNull(),
    outcome: sessionOutcome().notNull(),
    lostChoice: text(),
    casual: boolean().notNull().default(false),
    notes: text().notNull().default(''),
    status: sessionStatus().notNull().default('applied'),
    /** Audit group of the applied changes (used to revert the session). */
    auditGroupId: uuid(),
    firstCompletion: boolean().notNull().default(false),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_campaign_idx').on(t.campaignId, t.createdAt)],
);

export const sessionParticipants = pgTable(
  'session_participants',
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionId: uuid()
      .notNull()
      .references(() => playSessions.id, { onDelete: 'cascade' }),
    characterId: uuid()
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    coins: integer().notNull().default(0),
    xp: integer().notNull().default(0),
    checkmarks: integer().notNull().default(0),
    masteries: jsonb().$type<number[]>().notNull().default([]),
    resources: jsonb().$type<ResourceBag>().notNull().default({}),
    /** What was actually applied to the character. */
    applied: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index('participants_session_idx').on(t.sessionId)],
);

export const outpostPhases = pgTable(
  'outpost_phases',
  {
    id: uuid().primaryKey().defaultRandom(),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    week: integer().notNull(),
    /** 1 passage of time, 2 event, 3 building operations, 4 downtime, 5 construction. */
    step: integer().notNull().default(1),
    builds: integer().notNull().default(0),
    notes: text().notNull().default(''),
    openedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('outpost_campaign_idx').on(t.campaignId),
    uniqueIndex('outpost_one_open_idx')
      .on(t.campaignId)
      .where(sql`${t.closedAt} is null`),
  ],
);

export const sectionApplications = pgTable(
  'section_applications',
  {
    id: uuid().primaryKey().defaultRandom(),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    sectionRef: text().notNull(),
    effects: jsonb().$type<Effect[]>().notNull(),
    auditGroupId: uuid(),
    appliedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('section_apps_campaign_idx').on(t.campaignId, t.at)],
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
