CREATE TYPE "public"."character_status" AS ENUM('active', 'set_aside', 'abandoned', 'retired', 'dead');--> statement-breakpoint
CREATE TABLE "campaign_class_unlocks" (
	"campaign_id" uuid NOT NULL,
	"class_key" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_class_unlocks_campaign_id_class_key_pk" PRIMARY KEY("campaign_id","class_key")
);
--> statement-breakpoint
CREATE TABLE "character_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"item_number" integer,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"class_key" text NOT NULL,
	"name" text NOT NULL,
	"status" character_status DEFAULT 'active' NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"gold" integer DEFAULT 0 NOT NULL,
	"resources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checkmarks" integer DEFAULT 0 NOT NULL,
	"perk_marks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"masteries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bonus_perk_marks" integer DEFAULT 0 NOT NULL,
	"personal_quest_number" integer,
	"personal_quest_text" text,
	"personal_quest_progress" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"retired_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_defs" (
	"data_set_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"starting" boolean DEFAULT false NOT NULL,
	"perks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"masteries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_hp_by_level" jsonb,
	"hand_size" integer,
	CONSTRAINT "class_defs_data_set_id_key_pk" PRIMARY KEY("data_set_id","key")
);
--> statement-breakpoint
CREATE TABLE "game_data_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"locale" text NOT NULL,
	"rule_tables" jsonb NOT NULL,
	"imported_by" uuid,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_defs" (
	"data_set_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"gold_cost" integer,
	"craft_cost_count" integer,
	"quantity" integer,
	CONSTRAINT "item_defs_data_set_id_number_pk" PRIMARY KEY("data_set_id","number")
);
--> statement-breakpoint
CREATE TABLE "personal_quest_defs" (
	"data_set_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"envelope" text,
	"alt_envelope" text,
	CONSTRAINT "personal_quest_defs_data_set_id_number_pk" PRIMARY KEY("data_set_id","number")
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "game_data_set_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "prosperity_checks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "supply" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_class_unlocks" ADD CONSTRAINT "campaign_class_unlocks_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_items" ADD CONSTRAINT "character_items_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_defs" ADD CONSTRAINT "class_defs_data_set_id_game_data_sets_id_fk" FOREIGN KEY ("data_set_id") REFERENCES "public"."game_data_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_data_sets" ADD CONSTRAINT "game_data_sets_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_defs" ADD CONSTRAINT "item_defs_data_set_id_game_data_sets_id_fk" FOREIGN KEY ("data_set_id") REFERENCES "public"."game_data_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_quest_defs" ADD CONSTRAINT "personal_quest_defs_data_set_id_game_data_sets_id_fk" FOREIGN KEY ("data_set_id") REFERENCES "public"."game_data_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_items_character_idx" ON "character_items" USING btree ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_items_unique_idx" ON "character_items" USING btree ("character_id","item_number") WHERE "character_items"."item_number" is not null;--> statement-breakpoint
CREATE INDEX "characters_campaign_idx" ON "characters" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_one_per_class_idx" ON "characters" USING btree ("campaign_id","class_key") WHERE "characters"."status" in ('active', 'set_aside');--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_game_data_set_id_game_data_sets_id_fk" FOREIGN KEY ("game_data_set_id") REFERENCES "public"."game_data_sets"("id") ON DELETE restrict ON UPDATE no action;