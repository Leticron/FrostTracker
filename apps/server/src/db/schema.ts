import { sql } from 'drizzle-orm';
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

// ---------------------------------------------------------------- campaigns

export const campaignRole = pgEnum('campaign_role', ['host', 'player']);

export const campaigns = pgTable('campaigns', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  partyName: text(),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
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
