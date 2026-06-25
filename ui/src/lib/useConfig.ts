import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

/**
 * Shared client-config query. React Query dedupes by queryKey, so every call
 * site shares one in-flight request and one cache entry — call it freely
 * instead of repeating the useQuery boilerplate.
 */
export function useConfig() {
  return useQuery({ queryKey: ["config"], queryFn: api.config });
}
