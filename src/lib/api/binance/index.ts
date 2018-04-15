import * as crypto from 'crypto';
import nodeFetch from 'node-fetch';
import { AbstractApiWrapper, APIConnectionConfig, APIRequest } from '../abstract-api-wrapper';
import { IOrder } from '../hitbtc';


export interface IOrderResult {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  transactTime: number;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  timeInForce: string;
  type: string;
  side: string;
}

interface ICreateOrder {
  symbol: string;
  side: string;
  type: string;
  quantity: string;
  price?: number;
}

export interface ICanceledOrder {
  symbol: string;
  origClientOrderId: string;
  orderId: number;
  clientOrderId: string;
}

interface IPriceFilter {
  filterType: string;
  minPrice: string;
  maxPrice: string;
  tickSize: string;
}

interface ILotSizeFilter {
  filterType: string;
  minQty: string;
  maxQty: string;
  stepSize: string;
}

interface IMinNotionalFilter {
  filterType: string;
  minNotional: string;
}

export interface IBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface IAccount {
  makerCommission: number;
  takerCommission: number;
  buyerCommission: number;
  sellerCommission: number;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  updateTime: number;
  balances: IBalance[];
}

export interface IExchangeInfo {
  timezone: string;
  serverTime: number;
  rateLimits: object[];
  exchangeFilters: IPriceFilter & ILotSizeFilter & IMinNotionalFilter [];
  symbols: ISymbol[];
}

export interface ISymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  baseAssetPrecision: number;
  quoteAsset: string;
  quotePrecision: number;
  orderTypes: string[];
  icebergAllowed: boolean;
  filters: [
    IPriceFilter,
    ILotSizeFilter,
    IMinNotionalFilter
  ];
}

export interface ITicker {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice: string;
  lastPrice: string;
  lastQty: string;
  bidPrice: string;
  askPrice: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  fristId: number;  // First tradeId
  lastId: number;   // Last tradeId
  count: number;    // Trade count
}

export interface ITrade {
  id: number;
  orderId: number;
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
  isBestMatch: boolean;
}

export const apiInit = (config: APIConnectionConfig) => {
  const { url, secret, key } = config;

  return new BinanceApiWrapper({ url, secret, key });
};

export class BinanceApiWrapper extends AbstractApiWrapper {
  constructor(protected config: APIConnectionConfig) {
    super();
  }

  public async getProducts(): Promise<ISymbol[]> {
    return await this.get({ action: 'v1/exchangeInfo', payload: {} });
  }

  public async getTicker(): Promise<ITicker[]> {
    return await this.get({ action: 'v1/ticker/24hr', payload: {} });
  }

  public async getAccountInfo(): Promise<IAccount> {
    return await this.get({ action: 'v3/account', payload: {} }, true);
  }

  public async getCandles(symbol: string, interval: string): Promise<[
    number, string, string, string, string, string,
    number, string, number, string, string, string
  ][]> {
    return await this.get({
      action: 'v1/klines',
      payload: { symbol, interval },
    });
  }

  public async getMyTrades(options: object): Promise<ITrade[]> {
    return await this.get({ action: 'v3/myTrades', payload: { ...options } }, true)
  }

  public async makeOrder(order: ICreateOrder): Promise<IOrderResult> {
    return await this.post({
      action: 'v3/order',
      payload: {
        ...order,
        // timeInForce: 'GTC',
      },
    }, true);
  }

  public async getOrder(orderId: number, symbol: string): Promise<IOrderResult> {
    return await this.get({ action: 'v3/order', payload: { orderId, symbol } }, true);
  }

  public async cancelOrder(orderId: number, symbol: string): Promise<ICanceledOrder> {
    return await this.delete({ action: 'v3/order', payload: { orderId, symbol } }, true);
  }

  private makeSign(payloadString: string): string {
    return crypto
      .createHmac('sha256', this.config.secret)
      .update(payloadString)
      .digest('hex');
  }

  protected async request <T>(data: APIRequest): Promise<T> {
    try {
      const { method, access, payload, action } = data;
      const body: string = this.transformPayloadToString(
        access
          ? {
            ...payload,
            timestamp: (new Date).getTime(),
            recvWindow: 10000000,
          }
          : payload,
      );
      const url: string = `${this.config.url}/${action}${data.method === 'GET' ? `?${body}` : ''}`;
      const sign: string = this.makeSign(body);
      const headers = {
        'X-MBX-APIKEY': access ? this.config.key : undefined,
      };
      let requestObject: object = { method, headers, timeout: 10000000 };

      if (method !== 'GET') {
        requestObject = {
          ...requestObject, body: `${body}&signature=${sign}`,
        };
      }

      const response = await nodeFetch(
        `${url}${ (access && method === 'GET') ? `&signature=${sign}` : ''}`,
        requestObject,       
      );
      const responseObject = await response.json();

      return responseObject;

    } catch (error) {
      console.log(error);
    }
  }

}
