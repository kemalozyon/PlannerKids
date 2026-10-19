// Grafik kalitesi sahnenin içinde (WorldView ve Explore sağlar): su, çim gibi pahalı ayrıntılar buna bakar.
import { createContext, useContext } from 'react';
import type { Quality } from '../../lib/gfx';

export const QualityContext = createContext<Quality>('orta');
export const useQuality = () => useContext(QualityContext);
