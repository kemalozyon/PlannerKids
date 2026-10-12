import { createContext, useContext } from 'react';
import type { Api } from './types';

export const ApiContext = createContext<Api | null>(null);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('ApiContext yok');
  return api;
}
