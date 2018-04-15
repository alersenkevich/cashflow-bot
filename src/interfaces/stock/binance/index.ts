import * as moment from 'moment';
import * as WebSocket from 'ws';
import { createOrder } from '../../../models/order';
import { IProduct } from '../../../strategies/ema-intersection';
import { timingWrapper, filterQuantity } from '../../../lib/helpers';
import { BinanceApiWrapper, IBalance, IAccount, ITicker, ISymbol, IExchangeInfo, IOrderResult, ICanceledOrder, ITrade } from '../../../lib/api/binance';


interface IOptions {
  candlesPeriod: string;
  candlesCount: {
    fast: number;
    slow: number;
  };
}

export const stockInit = (api, products) => new BinanceEmaStockHandler(api, products);

export class BinanceEmaStockHandler {
  public socket: WebSocket;
  public title: string = 'binance';
  private products: IProduct[] = [];
  public priceLoses: { product: string, ask: number|boolean, bid: number|boolean }[];

  constructor(
    private api: BinanceApiWrapper,
    private productList: string[],
    private options: IOptions = {
      candlesPeriod: '1h',
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
    this.socket = new WebSocket('wss://stream.binance.com:9443/stream?streams=btcusdt@ticker');
  
    this.socket.on('open', () => {
      console.log('Binance socket for price watching is running');
    });

    return true;
  }

  public activatePriceListener(): boolean {
    if (this.socketInit()) {
      this.socket.on('message', (message: string): void => {
        const ticker = JSON.parse(message);

        if (ticker.data.hasOwnProperty('e') && ticker.data.e === '24hrTicker') {
          const key: number = this.priceLoses.findIndex(v => v.product === ticker.data.s);
        
          this.priceLoses[key].bid = parseFloat(ticker.data.b);
          this.priceLoses[key].ask = parseFloat(ticker.data.a);
        }
      });

      return true;
    }

    return false;
  }

  private async calculateAmount(): Promise<{
    amount: number,
    balances: IBalance[],
  }> {
    const { balances } = await this.api.getAccountInfo();
    const usd = balances.find(v => v.asset === 'USDT');

    const ticker = await timingWrapper<ITicker[]>(
      () => this.api.getTicker(),
      1000,
    );

    const amount = (
      await Promise.all(balances
        .filter(v =>
          v.asset !== 'USDT' && v.asset !== 'BNB'
          && ticker.find(s => s.symbol === `${v.asset}USDT`) !== undefined
          && parseFloat(v.free) > 0,
        )
        .map((coin) => {
          const { bidPrice: bid } = ticker.find(v => v.symbol === `${coin.asset}USDT`);

          return parseFloat(coin.free) * parseFloat(bid);
        }),
      )
    ).reduce(
      (acc, val) => acc + val, 0,
    ) + parseFloat(usd.free);

    return {
      amount: (amount - (amount * 0.1)) / this.productList.length,
      balances: balances.filter(v =>
        v.asset !== 'USDT' && v.asset !== 'BNB'
        && ticker.find(s => s.symbol === `${v.asset}USDT`) !== undefined
        && parseFloat(v.free) > 0,
      ),
    };
  }

  private async fetchProducts(amount: number): Promise<IProduct[]> {
    const { symbols: products } = await timingWrapper<IExchangeInfo>(
      () => this.api.getProducts(),
      1000,
    );
    const ticker: ITicker[] = await timingWrapper<ITicker[]>(
      () => this.api.getTicker(),
      1000,
    );

    return await Promise.all(
      this.productList.map(
        (coin, key): Promise<IProduct> => timingWrapper(
          async (): Promise<IProduct> => {
            const productData: ISymbol = products.find(v => v.symbol === coin);
            const productTicker: ITicker = ticker.find(v => v.symbol === coin);
            const candles = await this.api.getCandles(coin, this.options.candlesPeriod);
            const qty = filterQuantity(
              amount / parseFloat(productTicker.askPrice),
              productData.filters[1].minQty,
            );


            return {
              qty,
              title: coin,
              ask: productTicker.askPrice,
              bid: productTicker.bidPrice,
              minQty: productData.filters[1].minQty,
              tickSize: productData.filters[0].tickSize,
              candles: {
                fast: candles
                  .filter((v, k) => k >= candles.length - this.options.candlesCount.fast)
                  .map(v => parseFloat(v[4])),
                slow: candles
                  .filter((v, k) => k >= candles.length - this.options.candlesCount.slow)
                  .map(v => parseFloat(v[4])),
              },
            };
          },
          1000 * key,
        ),
      ),
    );
  }

  private async whichSideBelongs(balances: IBalance[]): Promise<IProduct[]> {
    return Promise.all(this.products.map((product: IProduct) => {
      const coinBalance: IBalance = balances.find(
        v => v.asset === product.title.replace('USDT', ''),
      );
      const available = coinBalance !== undefined ? coinBalance.free : '0';

      if (parseFloat(available) <= parseFloat(product.minQty)) {
        return { ...product, side: 'buy' };
      }

      return {
        ...product,
        side: 'sell',
        qty: filterQuantity(
          parseFloat(available),
          product.minQty,
        ),
      };
    }));
  }

  public async calculateProfit(
    duration: { start: string, end: string },
  ): Promise<number> {
    const from = moment(duration.start).valueOf();
    const till = moment(duration.end).valueOf();
    let flag: boolean = false;
    const { buy, sell } = (await Promise.all(this.productList
      .map((coin: string, key: number) => timingWrapper<ITrade[]>(
        async () => await this.api.getMyTrades({ symbol: coin }),
        key * 1000,
      )),
    )).reduce((acc, val) => acc.concat(val), [])
      .filter(v => v.time >= from && v.time <= till)
      .reverse()
      .filter((v) => {
        if (flag) {
          return v;
        }
        if (v.isBuyer === false) {
          flag = true;
          return v;
        }
      })
      .reduce((acc, val) => {
        const side = val.isBuyer === true ? 'buy' : 'sell';
        const amount = acc[side] + (parseFloat(val.price) * parseFloat(val.qty)) - parseFloat(val.commission);
        const object = { [ side ]: amount };
        
        return { ...acc, ...object };
      }, { buy: 0, sell: 0 });


    return sell - buy;
  }

  public async makeOrder(
    quantity: string,
    side: string,
    symbol: string,
    type: string,
    coin: IProduct,
  ): Promise<boolean> {

    const { ask, bid } = this.priceLoses.find(v => v.product === coin.title);

    const orderRequest: IOrderResult = await this.api.makeOrder({
      quantity, side, symbol, type,
    });
    // console.log(orderRequest);

    let orderResult: IOrderResult = orderRequest;

    if (orderRequest.status !== 'FILLED') {
      orderResult = await timingWrapper<IOrderResult>(
        async () => {
          const activeOrder: IOrderResult = await this.api.getOrder(orderRequest.orderId, symbol);
    
          if (activeOrder.status === 'PARTIALLY_FILLED') {
            const cancelRequest: ICanceledOrder = await this.api.cancelOrder(orderRequest.orderId, symbol);
          }

          return activeOrder;

        },
        1000,
      );
    }

    console.log(orderResult);

    const dbOrderInsertion = await createOrder({
      type,
      side,
      status: 'executed',
      orderId: orderResult.orderId,
      quantity: orderResult.executedQty,
      price: side === 'sell' ? bid : ask,
      clientOrderId: orderResult.clientOrderId,
    }, 'binance');

    console.log(dbOrderInsertion);
    if (dbOrderInsertion === null) {
      return false;
    }
    
    return true;

  }

  public async fastUpdate(products: IProduct[]): Promise<IProduct[]> {
    const { balances } = await this.api.getAccountInfo();
    const usd = balances.find(v => v.asset === 'USDT');

    const ticker = await timingWrapper<ITicker[]>(
      () => this.api.getTicker(),
      1000,
    );

    let amount = ((
      await Promise.all(balances
        .filter(v =>
          v.asset !== 'USDT' && v.asset !== 'BNB' && v.asset !== 'LTC'
          && ticker.find(s => s.symbol === `${v.asset}USDT`) !== undefined
          && parseFloat(v.free) > 0,
        )
        .map((coin) => {

          const { bidPrice: bid } = ticker.find(v => v.symbol === `${coin.asset}USDT`);

          return parseFloat(coin.free) * parseFloat(bid);
        }),
      )
    ).reduce(
      (acc, val) => acc + val, 0,
    ) + parseFloat(usd.free)) / this.productList.length;

    amount = amount - (amount * 0.1);

    return Promise.all(products.map((product: IProduct) => {
      const coinBalance: IBalance = balances.find(
        v => v.asset === product.title.replace('USDT', ''),
      );
      const available = coinBalance !== undefined ? coinBalance.free : '0';
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
