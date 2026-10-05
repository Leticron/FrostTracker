import { useQuery } from '@tanstack/react-query';
import { trpc } from './trpc.ts';

export function useMe() {
  return useQuery(trpc.auth.me.queryOptions()).data?.user ?? null;
}
