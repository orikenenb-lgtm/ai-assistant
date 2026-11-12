import { useQuery } from '@tanstack/react-query';
import { fetchSearchHistory, searchKeys } from './api';

export function useSearchHistory(page = 1, pageSize = 5) {
  return useQuery({
    queryKey: searchKeys.history({ page, pageSize }),
    queryFn: () => fetchSearchHistory({ page, pageSize }),
  });
}
