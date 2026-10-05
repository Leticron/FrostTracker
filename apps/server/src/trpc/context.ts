// Loads @fastify/cookie's FastifyRequest/FastifyReply type augmentation for every importer.
import type {} from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import type { AttemptLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../auth/session.ts';

export interface AppDeps {
  db: Db;
  config: Config;
  loginLimiter: AttemptLimiter;
}

export interface Context extends AppDeps {
  req: FastifyRequest;
  res: FastifyReply;
  user: SessionUser | null;
  sessionToken: string | null;
}
