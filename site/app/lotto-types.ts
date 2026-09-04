export type RankFilter = 'all' | '1' | '2';

export interface LottoDraw {
  draw: number;
  date: string;
  numbers: number[];
  bonus: number;
  firstPrize: number;
  secondPrize: number;
  firstWinners: number;
  secondWinners: number;
}

export interface StoreWin {
  draw: number;
  rank: 1 | 2;
  method: string;
  tickets: number;
}

export interface LottoStore {
  id: string;
  name: string;
  address: string;
  region: string;
  phone?: string;
  lat: number;
  lng: number;
  wins: StoreWin[];
}

export interface LottoMapData {
  generatedAt: string;
  coverageStart: number;
  latestDraw: number;
  source: string;
  draws: LottoDraw[];
  stores: LottoStore[];
}

export interface VisibleStore extends LottoStore {
  visibleWins: StoreWin[];
}
