import * as moment from 'moment';
import { IProduct } from '../../../strategies/ema-intersection';
import { createOrder } from '../../../models/order';
import {
  PublicClient,
  AuthenticatedClient,
  Account,
  ProductInfo,
  ProductTicker,
  OrderResult,
  BaseOrderInfo,
  BaseOrder,
  WebsocketClient,
} from 'gdax';
import { timingWrapper, filterQuantity } from '../../../lib/helpers';
import { ITrade } from '../../../lib/api/hitbtc';
import { parse } from 'querystring';


interface IOptions {
  candlePeriod: number; // granularity
  candlesCount: {
    fast: number;
    slow: number;
  };
}

export const stockInit = (api, products) => new GdaxEmaStockHandler(api, products);

export class GdaxEmaStockHandler {
  public socket: WebsocketClient;
  public title: string = 'gdax';
  private products: IProduct[] = [];
  public priceLoses: { product: string, ask: number|boolean, bid: number|boolean }[];

  constructor(
    private api: {
      public: PublicClient,
      private: AuthenticatedClient,
      socket: WebsocketClient,
    },
    private productList: string[],
    private options: IOptions = {
      candlePeriod: 3600,
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
    this.api.socket.on(
      'open', 
      () => console.log('Gdax socket for price watching is running'),
    );

    return true;
  }

  public activatePriceListener(): boolean {
    if (this.socketInit()) {
      this.api.socket.on('message', (message): void => {
        if (message.hasOwnProperty('type') && message.type === 'ticker') {
          const key: number = this.priceLoses.findIndex(v => v.product === message.product_id);
        
          this.priceLoses[key].bid = parseFloat(message.best_bid);
          this.priceLoses[key].ask = parseFloat(message.best_ask);
        }
      });

      return true;
    }

    return false;
  }

  private async calculateAmount(): Promise<{
    amount: number,
    balances: Account[],
  }> {
    const balances = await this.api.private.getAccounts();
    const usd = balances.find(v => v.currency === 'USD');

    const amount = (
      await Promise.all(balances
        .filter(v => parseFloat(v.available) > 0 && v.currency !== 'USD')
        .map(
          (coin, key): Promise<number> => timingWrapper(
            async () => {
              const { bid } = await this.api.public.getProductTicker(`${coin.currency}-USD`);
            
              return parseFloat(bid) * parseFloat(coin.available);
            },
            334 * key,
          ),
        ),
      )
    ).reduce(
      (acc, val) => acc + val, 0,
    ) + parseFloat(usd.available);

    return {
      amount: (amount - (amount * 0.1)) / this.productList.length,
      balances: balances.filter(
        v => parseFloat(v.available) > 0 && v.currency !== 'USD',
      ),
    };
  }

  private async fetchProducts(amount: number): Promise<IProduct[]> {
    const products: ProductInfo[] = await this.api.public.getProducts();

    return await Promise.all(
      this.productList.map(
        (coin, key): Promise<IProduct> => timingWrapper(
          async (): Promise<IProduct> => {
            const productData: ProductInfo = products.find(v => v.id === coin);
            const productTicker: ProductTicker = await this.api.public.getProductTicker(coin);
            const candles = await this.api.public.getProductHistoricRates(
              coin, { granularity: this.options.candlePeriod },
            );
            const qty = filterQuantity(
              amount / parseFloat(productTicker.ask),
              productData.base_min_size,
            );

            return {
              qty,
              title: coin,
              ask: productTicker.ask,
              bid: productTicker.bid,
              minQty: productData.base_min_size,
              tickSize: productData.quote_increment,
              candles: {
                fast: candles
                  .filter((v, k) => k < this.options.candlesCount.fast)
                  .map(v => v[4])
                  .reverse(),
                slow: candles
                  .filter((v, k) => k < this.options.candlesCount.slow)
                  .map(v => v[4])
                  .reverse(),
              },
            };
          },
          334 * key,
        ),
      ),
    );
  }

  private async whichSideBelongs(balances: Account[]): Promise<IProduct[]> {
    return Promise.all(this.products.map(
      (product: IProduct) => {
        const coinBalance = balances.find(
          v => v.currency === product.title.replace('-USD', ''),
        );
        const available = coinBalance !== undefined ? coinBalance.available : '0';
        
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
      },
    ));
  }

  public async calculateProfit(
    duration: { start: string, end: string },
  ): Promise<number> {
    const from = moment(duration.start).valueOf();
    const till = moment(duration.end).valueOf();
    const trades = (await this.api.private.getFills())
      .filter(
        v => moment(v.created_at).valueOf() >= from
          && moment(v.created_at).valueOf() <= till,
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
      .reduce((acc, val) => {
        console.log(val);
        const amount = acc[val.side] + parseFloat(val.usd_volume);
        const object = { [ val.side ]: amount };
        
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
    const orderRequest: BaseOrderInfo = await this.api.private.placeOrder({
      type,
      side,
      size: quantity,
      product_id: symbol,
    });

    console.log(orderRequest);
    
    const orderResult: BaseOrderInfo = await timingWrapper(
      async (): Promise<BaseOrderInfo> => {
        const activeOrder = await this.api.private.getOrder(orderRequest.id);

        if (activeOrder.status === 'pending') {
          const cancelRequest = await this.api.private.cancelOrder(orderRequest.id);
        }

        return activeOrder;
      },
      1000,
    );

    console.log(orderResult);

    const dbOrderInsertion = await createOrder({
      orderId: orderResult.id,
      quantity: orderResult.filled_size,
      price: coin.bid,
      type: orderResult.type,
      side: orderResult.side,
      status: 'executed',
      product_id: orderResult.product_id,
      symbol: orderResult.product_id,
      fee: orderResult.fill_fees,
    }, 'gdax');
    
    console.log(dbOrderInsertion);
    
    if (dbOrderInsertion === null) {
      return false;
    }

    return true;
  }

  public async fastUpdate(products: IProduct[]): Promise<IProduct[]> {
    const balances = await this.api.private.getAccounts();
    const usd = balances.find(v => v.currency === 'USD');

    let amount = ((
      await Promise.all(balances
        .filter(v => parseFloat(v.available) > 0 && v.currency !== 'USD' && v.currency !== 'LTC')
        .map((coin) => {
          const { bid } = this.priceLoses.find(
            v => v.product === `${coin.currency}-USD`,
          );

          return bid * parseFloat(coin.available);
        }),
      )
    ).reduce(
      (acc, val) => acc + val, 0,
    ) + parseFloat(usd.available)) / this.productList.length;

    amount = amount - (amount * 0.1);

    return await Promise.all(products.map(
      (product: IProduct) => {
        const coinBalance = balances.find(
          v => v.currency === product.title.replace('-USD', ''),
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
      },
    ));
  }

}
