import { HitBtcApiWrapper, ISymbol, ITicker, ICandle, ITradingBalance, IOrder, ITrade } from '../../../lib/api/hitbtc';
import { IProduct } from '../../../strategies/ema-intersection';
import { timingWrapper, filterQuantity } from '../../../lib/helpers';
import { createOrder } from '../../../models/order';
import * as moment from 'moment';
import * as WebSocket from 'ws';


interface IOptions {
  candlePeriod: string;
  candlesCount: {
    fast: number;
    slow: number;
  };
}

export interface IWSMessage {
  jsonrpc: string;
  method: string;
  params: {
    ask: string;
    bid: string;
    last: string;
    open: string;
    low: string;
    high: string;
    volume: string;
    volumeQuote: string;
    timestamp: string;
    symbol: string;
  }
}

export const stockInit = (api, products) => new HitBtcEmaStockHandler(api, products);

export class HitBtcEmaStockHandler {
  public socket: WebSocket;
  public title: string = 'hitbtc';
  private products: IProduct[] = [];
  public priceLoses: { product: string, ask: number|boolean, bid: number|boolean }[];

  constructor(
    private api: HitBtcApiWrapper,
    public productList: string[],
    private options: IOptions = {
      candlePeriod: 'H1',
      candlesCount: { fast: 9, slow: 34 },
    },
  ) {
    this.priceLoses = this.productList.map(v => ({ product: v, ask: false, bid: false }));
  }

  public async handlerInit(): Promise<{ amount: number, products: IProduct[] }> {
    const { amount, balances } = await this.calculateAmount();
    this.products = await this.fetchProducts(amount);
    this.products = await this.whichSideBelongs(balances);

    return { amount, products: this.products };
  }

  public socketInit(): boolean {
    this.socket = new WebSocket('wss://api.hitbtc.com/api/2/ws');
    
    this.socket.on('open', () => {
      this.productList.forEach(
        (product: string) => this.socket.send(JSON.stringify({
          method: 'subscribeTicker',
          params: {
            symbol: product,
          },
          id: (new Date).getTime(),
        })),
      );
      console.log('HitBtc socket for price watching is running');
    });

    return true;
  }

  public activatePriceListener(): boolean {
    if (this.socketInit()) {
      this.socket.on('message', (message: string): void => {
        const ticker: IWSMessage = JSON.parse(message);

        if (ticker.hasOwnProperty('method') && ticker.method === 'ticker') {
          const key: number = this.priceLoses.findIndex(v => v.product === ticker.params.symbol);

          this.priceLoses[key].bid = parseFloat(ticker.params.bid);
          this.priceLoses[key].ask = parseFloat(ticker.params.ask);
        }
      });

      return true;
    }
    return false;
  }

  public async makeOrder(
    quantity: string,
    side: string,
    symbol: string,
    type: string,
    coin: IProduct,
  ): Promise<boolean> {
    const orderRequest = await this.api.makeOrder({ type, side, quantity, symbol });
    // console.log(orderRequest);
    let orderResult: IOrder = orderRequest;

    if (orderRequest.status !== 'filled') {
      orderResult = await timingWrapper(
        async (): Promise<IOrder> => {
          const activeOrder: IOrder = await this.api.getActiveOrderByClientId(orderRequest.clientOrderId);
          // console.log('ACTIVE ORDER: ', activeOrder);
          if (activeOrder.status === 'partiallyFilled' || activeOrder.status !== 'filled') {
            const cancelRequest: IOrder = await this.api.cancelOrderByClientOrderId(activeOrder.clientOrderId);
            // console.log('CANCEL QUERY', cancelRequest);
            return cancelRequest;
          }

          return activeOrder;
        },
        1000,
      );
    }

    //console.log(orderResult);

    const {
      orderId,
      clientOrderId,
      cumQuantity,
      status,
    } = orderResult;
    const price = orderResult.tradesReport[0].price;
    const fee = orderResult.tradesReport.reduce(
      (acc, val) => acc + parseFloat(val.fee), 0,
    );
    const dbOrderInsertion = await createOrder({
      orderId,
      price,
      clientOrderId,
      status,
      symbol,
      side,
      type,
      fee,
      quantity: cumQuantity,
    }, 'hitbtc');

    console.log(dbOrderInsertion);
    if (dbOrderInsertion === null) {
      return false;
    }
    return true;
  }

  private async calculateAmount(): Promise<{
    amount: number,
    balances: ITradingBalance[],
  }> {
    const balances = await this.api.getTradingBalance();
    const usd = balances.find(v => v.currency === 'USD');

    const amount = (
      await Promise.all(balances
        .filter(v => parseFloat(v.available) > 0 && v.currency !== 'USD')
        .map(
          (coin, key): Promise<number> => timingWrapper(
            async () => {
              const { bid } = await this.api.getTicker(`${coin.currency}USD`);

              return parseFloat(bid) * parseFloat(coin.available);
            },
            201 * key,
          ),
        ),
      )
    ).reduce(
      (acc, val) => acc + val, 0,
    ) + parseFloat(usd.available);


    return {
      amount: (amount - (amount * 0.12)) / this.productList.length,
      balances: balances.filter(
        v => parseFloat(v.available) > 0 && v.currency !== 'USD',
      ),
    };
  }

  private async fetchProducts(amount: number): Promise<IProduct[]> {
    return await Promise.all(
      this.productList.map(
        (coin, key): Promise<IProduct> => timingWrapper(
          async (): Promise<IProduct> => {
            const productData: ISymbol | ISymbol[] = await this.api.getSymbol(coin);
            const productTicker: ITicker | ITicker[] = await this.api.getTicker(coin);
            const candles: ICandle[] = await this.api.getCandles(coin, this.options.candlePeriod);
            const qty = filterQuantity(
              amount / parseFloat(productTicker.ask),
              productData.quantityIncrement,
            );

            return {
              qty,
              title: coin,
              ask: productTicker.ask,
              bid: productTicker.bid,
              minQty: productData.quantityIncrement,
              tickSize: productData.tickSize,
              candles: {
                fast: candles
                  .filter((v, k) => k >= candles.length - this.options.candlesCount.fast)
                  .map(v => parseFloat(v.close)),
                slow: candles
                  .filter((v, k) => k >= candles.length - this.options.candlesCount.slow)
                  .map(v => parseFloat(v.close)),
              },
            };
          },
          603 * key,
        ),
      ),
    );
  }

  private async whichSideBelongs(balances: ITradingBalance[]): Promise<IProduct[]> {
    return Promise.all(this.products.map((product: IProduct) => {
      const coinBalance = balances.find(
        v => v.currency === product.title.replace('USD', ''),
      );
      const available = coinBalance !== undefined ? coinBalance.available : '0';
      
      if (parseFloat(available) <= parseFloat(product.minQty)) {
        return { ...product, side: 'buy' };
      }

      return { ...product, side: 'sell', qty: filterQuantity(parseFloat(available), product.minQty) };
    }));
  }

  public async calculateProfit(
    duration: { start: string, end: string },
  ): Promise<number> {
    const from = moment(duration.start).valueOf();
    const till = moment(duration.end).valueOf(); 
    const trades: ITrade[] = (await this.api.getTradesHistory({ limit: 1000 }))
      .filter(
        v => moment(v.timestamp).valueOf() >= from && moment(v.timestamp).valueOf() <= till,
      );

    let flag: boolean = false;
    const { buy, sell } = trades
      .filter((v) => {
        if (flag) {
          return v;
        }
        if (v.side === 'sell') {
          flag = true;
          return v;
        }
      })
      .map(val => ({
        side: val.side,
        amount: parseFloat(val.price) * parseFloat(val.quantity) - parseFloat(val.fee),
      }))
      .reduce((acc, val) => {
        const amount = acc[val.side] + val.amount;
        const object = { [ val.side ]: amount };
        
        return { ...acc, ...object };
      }, { buy: 0, sell: 0 });
    
    console.log(buy, sell);

    return sell - buy;
  }

  public async fastUpdate(products: IProduct[]): Promise<IProduct[]> {
    const balances = await this.api.getTradingBalance();
    // console.log(balances);
    const usd = balances.find(v => v.currency === 'USD');

    let amount = ((
      await Promise.all(balances
        .filter(
          v => parseFloat(v.available) > 0 && v.currency !== 'USD' && v.currency !== 'LTC',
        )
        .map((coin) => {
          const { bid } = this.priceLoses.find(
            v => v.product === `${coin.currency}USD`,
          );

          return bid * parseFloat(coin.available);
        }),
      )
    ).reduce(
      (acc, val) => acc + val, 0,
    ) + parseFloat(usd.available)) / this.productList.length;

    amount = (amount - (amount * 0.12));

    return await Promise.all(products.map((product: IProduct) => {
      const coinBalance = balances.find(
        v => v.currency === product.title.replace('USD', ''),
      );
      const available = coinBalance !== undefined ? coinBalance.available : '0';
      const { ask, bid } = this.priceLoses.find(v => v.product === product.title);
      
      if (parseFloat(available) <= parseFloat(product.minQty)) {

        return {
          ...product,
          ask: ask.toString(),
          bid: bid.toString(),
          side: 'buy',
          qty: filterQuantity(
            amount / ask,
            product.minQty,
          ),
        };
      }

      return {
        ...product,
        ask: ask.toString(),
        bid: bid.toString(),
        side: 'sell',
        qty: filterQuantity(
          parseFloat(available),
          product.minQty,
        ),
      };
    }));
  }
}
