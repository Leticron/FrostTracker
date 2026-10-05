CREATE TYPE "public"."building_state" AS ENUM('unlocked', 'built', 'wrecked');--> statement-breakpoint
CREATE TYPE "public"."calendar_source" AS ENUM('preprinted', 'added');--> statement-breakpoint
CREATE TYPE "public"."event_kind" AS ENUM('road', 'outpost');--> statement-breakpoint
CREATE TYPE "public"."scenario_status" AS ENUM('unlocked', 'completed', 'locked_out');--> statement-breakpoint
CREATE TYPE "public"."session_outcome" AS ENUM('completed', 'lost');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('applied', 'reverted');--> statement-breakpoint
CREATE TABLE "building_defs" (
	"data_set_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"starting" boolean DEFAULT false NOT NULL,
	"levels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "building_defs_data_set_id_number_pk" PRIMARY KEY("data_set_id","number")
);
--> statement-breakpoint
CREATE TABLE "calendar_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"week" integer NOT NULL,
	"section_ref" text NOT NULL,
	"source" "calendar_source" NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"state" "building_state" DEFAULT 'unlocked' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"scenario_number" integer NOT NULL,
	"status" "scenario_status" NOT NULL,
	"times_completed" integer DEFAULT 0 NOT NULL,
	"requirement_override" boolean DEFAULT false NOT NULL,
	"unlocked_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_stickers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_deck_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"deck" text NOT NULL,
	"event_ref" text NOT NULL,
	"op" text NOT NULL,
	"section_ref" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"kind" "event_kind" NOT NULL,
	"event_ref" text NOT NULL,
	"option" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"week" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outpost_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"week" integer NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"builds" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "play_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"date" text NOT NULL,
	"scenario_number" integer,
	"scenario_level" integer NOT NULL,
	"outcome" "session_outcome" NOT NULL,
	"lost_choice" text,
	"casual" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" "session_status" DEFAULT 'applied' NOT NULL,
	"audit_group_id" uuid,
	"first_completion" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_defs" (
	"data_set_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"coord" text,
	"region" text,
	"complexity" integer,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conclusion_sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"initially_unlocked" boolean DEFAULT false NOT NULL,
	"marker_x" double precision,
	"marker_y" double precision,
	"marker_layer" text,
	CONSTRAINT "scenario_defs_data_set_id_number_pk" PRIMARY KEY("data_set_id","number")
);
--> statement-breakpoint
CREATE TABLE "section_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"section_ref" text NOT NULL,
	"effects" jsonb NOT NULL,
	"audit_group_id" uuid,
	"applied_by" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section_defs" (
	"data_set_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"scenario_number" integer,
	"effects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rewards_text" text,
	CONSTRAINT "section_defs_data_set_id_ref_pk" PRIMARY KEY("data_set_id","ref")
);
--> statement-breakpoint
CREATE TABLE "session_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"checkmarks" integer DEFAULT 0 NOT NULL,
	"masteries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasures_looted" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"looted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_class_unlocks" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "current_week" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "morale" integer;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "defense" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "soldiers" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "inspiration" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "morale_min_section" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "morale_max_section" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "setup_done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "building_defs" ADD CONSTRAINT "building_defs_data_set_id_game_data_sets_id_fk" FOREIGN KEY ("data_set_id") REFERENCES "public"."game_data_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_buildings" ADD CONSTRAINT "campaign_buildings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_scenarios" ADD CONSTRAINT "campaign_scenarios_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_stickers" ADD CONSTRAINT "campaign_stickers_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_deck_changes" ADD CONSTRAINT "event_deck_changes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outpost_phases" ADD CONSTRAINT "outpost_phases_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_sessions" ADD CONSTRAINT "play_sessions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_sessions" ADD CONSTRAINT "play_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_defs" ADD CONSTRAINT "scenario_defs_data_set_id_game_data_sets_id_fk" FOREIGN KEY ("data_set_id") REFERENCES "public"."game_data_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_applications" ADD CONSTRAINT "section_applications_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_applications" ADD CONSTRAINT "section_applications_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_defs" ADD CONSTRAINT "section_defs_data_set_id_game_data_sets_id_fk" FOREIGN KEY ("data_set_id") REFERENCES "public"."game_data_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_session_id_play_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."play_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasures_looted" ADD CONSTRAINT "treasures_looted_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_campaign_idx" ON "calendar_entries" USING btree ("campaign_id","week");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_buildings_unique_idx" ON "campaign_buildings" USING btree ("campaign_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_scenarios_unique_idx" ON "campaign_scenarios" USING btree ("campaign_id","scenario_number");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_stickers_unique_idx" ON "campaign_stickers" USING btree ("campaign_id","name");--> statement-breakpoint
CREATE INDEX "event_deck_campaign_idx" ON "event_deck_changes" USING btree ("campaign_id","at");--> statement-breakpoint
CREATE INDEX "event_log_campaign_idx" ON "event_log" USING btree ("campaign_id","at");--> statement-breakpoint
CREATE INDEX "outpost_campaign_idx" ON "outpost_phases" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outpost_one_open_idx" ON "outpost_phases" USING btree ("campaign_id") WHERE "outpost_phases"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "sessions_campaign_idx" ON "play_sessions" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "section_apps_campaign_idx" ON "section_applications" USING btree ("campaign_id","at");--> statement-breakpoint
CREATE INDEX "participants_session_idx" ON "session_participants" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "treasures_unique_idx" ON "treasures_looted" USING btree ("campaign_id","number");--> statement-breakpoint
ALTER TABLE "campaign_class_unlocks" ADD CONSTRAINT "campaign_class_unlocks_id_unique" UNIQUE("id");