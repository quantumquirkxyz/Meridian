/**
 * Raw Bybit V5 API response types.
 *
 * These mirror the Bybit API JSON shapes before normalization. The connector
 * layer normalizes them into MarketDataSnapshot / OrderUpdate (contracts).
 */

// ── REST response envelope ──────────────────────────────────────────

export interface BybitApiResponse<T = unknown> {
  retCode: number;
  retMsg: string;
  result: T;
  retExtInfo?: Record<string, unknown>;
  time: number;
}

// ── Account ─────────────────────────────────────────────────────────

export interface BybitCoinBalance {
  coin: string;
  walletBalance: string;
  availableToWithdraw: string;
  totalOrderIM: string;
  totalPositionIM: string;
  totalPositionMM: string;
  unrealisedPnl: string;
  cumRealisedPnl: string;
  bonus: string;
  collateralSwitch: boolean;
  marginCollateral: boolean;
  locked: string;
  spotHedgingQty: string;
}

export interface BybitWalletBalanceResult {
  list: Array<{
    totalEquity: string;
    accountIMRate: string;
    accountMMRate: string;
    totalMarginBalance: string;
    totalInitialMargin: string;
    totalMaintenanceMargin: string;
    totalAvailableBalance: string;
    totalPerpUPL: string;
    totalWalletBalance: string;
    accountType: string;
    coin: BybitCoinBalance[];
  }>;
}

// ── Orders ──────────────────────────────────────────────────────────

export type BybitOrderSide = "Buy" | "Sell";
export type BybitTimeInForce = "GTC" | "IOC" | "FOK" | "PostOnly";
export type BybitOrderType = "Market" | "Limit";
export type BybitOrderStatus =
  | "New"
  | "PartiallyFilled"
  | "Untriggered"
  | "Rejected"
  | "Deactivated"
  | "Filled"
  | "Cancelled";

export interface BybitOrderResult {
  orderId: string;
  orderLinkId: string;
  blockTradeId: string;
  symbol: string;
  price: string;
  qty: string;
  side: BybitOrderSide;
  isLeverage: string;
  positionIdx: number;
  orderStatus: BybitOrderStatus;
  createType: string;
  cancelType: string;
  rejectReason: string;
  avgPrice: string;
  leavesQty: string;
  leavesValue: string;
  cumExecQty: string;
  cumExecValue: string;
  cumExecFee: string;
  timeInForce: string;
  orderType: BybitOrderType;
  stopOrderType: string;
  orderIv: string;
  triggerPrice: string;
  takeProfit: string;
  stopLoss: string;
  tpslMode: string;
  tpLimitPrice: string;
  slLimitPrice: string;
  triggerDirection: number;
  triggerBy: string;
  lastPriceOnCreated: string;
  reduceOnly: boolean;
  closeOnTrigger: boolean;
  placeType: string;
  createdTime: string;
  updatedTime: string;
}

export interface BybitPlaceOrderResult {
  orderId: string;
  orderLinkId: string;
}

export interface BybitCancelOrderResult {
  orderId: string;
  orderLinkId: string;
}

export interface BybitOpenOrdersResult {
  list: BybitOrderResult[];
  nextPageCursor: string;
}

// ── Market data ─────────────────────────────────────────────────────

export interface BybitTickersResult {
  list: Array<{
    symbol: string;
    bid1Price: string;
    bid1Size: string;
    ask1Price: string;
    ask1Size: string;
    lastPrice: string;
    prevPrice24h: string;
    price24hPcnt: string;
    highPrice24h: string;
    lowPrice24h: string;
    turnover24h: string;
    volume24h: string;
    fundingRate: string;
    nextFundingTime: string;
    markPrice: string;
    indexPrice: string;
    openInterest: string;
    openInterestValue: string;
    deliveryFeeRate: string;
    deliveryTime: string;
    basisRate: string;
    preOpenPrice: string;
    preQty: string;
    curPreListingPhase: string;
  }>;
}

// ── WebSocket types ─────────────────────────────────────────────────

export type BybitWSTopic =
  | `orderbook.${number}`
  | `orderbook.${number}.${string}`
  | "trade"
  | "order"
  | "position"
  | "execution"
  | "wallet";

export interface BybitWSOpMessage {
  op: "subscribe" | "unsubscribe" | "ping" | "auth";
  args?: BybitWSTopic[];
  req_id?: string;
}

export interface BybitWSResponse {
  topic?: string;
  type?: string;
  ts?: number;
  data: unknown;
  success?: boolean;
  ret_msg?: string;
  op?: string;
  conn_id?: string;
  auth?: {
    expire: number;
    api_key: string;
    twist: string;
  };
}

// ── Public stream data shapes ───────────────────────────────────────

export interface BybitOrderbookLevel {
  price: string;
  size: string;
}

export interface BybitOrderbookData {
  s: string; // symbol
  b: BybitOrderbookLevel[]; // bids
  a: BybitOrderbookLevel[]; // asks
  u: number; // update id
  seq: number; // cross sequence
 cts: number; // creation timestamp ms
}

export interface BybitTradeData {
  i: string; // trade id
  T: number; // timestamp ms
  p: string; // price
  v: string; // size
  S: BybitOrderSide; // side
  s: string; // symbol
  BT: boolean; // whether block trade
}

// ── Private stream data shapes ──────────────────────────────────────

export interface BybitWSOrderData {
  orderId: string;
  orderLinkId: string;
  symbol: string;
  price: string;
  qty: string;
  side: BybitOrderSide;
  isLeverage: string;
  positionIdx: number;
  orderStatus: BybitOrderStatus;
  createType: string;
  cancelType: string;
  rejectReason: string;
  avgPrice: string;
  leavesQty: string;
  leavesValue: string;
  cumExecQty: string;
  cumExecValue: string;
  cumExecFee: string;
  timeInForce: string;
  orderType: BybitOrderType;
  stopOrderType: string;
  orderIv: string;
  triggerPrice: string;
  takeProfit: string;
  stopLoss: string;
  tpslMode: string;
  tpLimitPrice: string;
  slLimitPrice: string;
  triggerDirection: number;
  triggerBy: string;
  lastPriceOnCreated: string;
  reduceOnly: boolean;
  closeOnTrigger: boolean;
  placeType: string;
  createdTime: string;
  updatedTime: string;
  feeCurrency: string;
  mP: string; // mark price
  iP: string; // index price
}

export interface BybitWSPositionData {
  positionIdx: number;
  riskId: number;
  riskLimitValue: string;
  symbol: string;
  side: BybitOrderSide;
  size: string;
  avgPrice: string;
  positionValue: string;
  tradeMode: number;
  positionStatus: string;
  autoAddMargin: number;
  leverage: string;
  positionBalance: string;
  markPrice: string;
  liquidationPrice: string;
  leverageImrFactor: string;
  positionIM: string;
  positionMM: string;
  unrealisedPnl: string;
  cumRealisedPnl: string;
  createdTime: string;
  updatedTime: string;
  seq: number;
}

export interface BybitWSExecutionData {
  category: string;
  symbol: string;
  execFee: string;
  execId: string;
  execPrice: string;
  execQty: string;
  execType: string;
  execValue: string;
  feeRate: string;
  tradeIv: string;
  blockTradeId: string;
  markPrice: string;
  indexPrice: string;
  underlyingPrice: string;
  createdAt: string;
  isLeverage: string;
  closedSize: string;
  seq: number;
  orderId: string;
  orderLinkId: string;
  orderPrice: string;
  orderQty: string;
  leavesQty: string;
  orderType: string;
  side: BybitOrderSide;
  stopOrderType: string;
}
