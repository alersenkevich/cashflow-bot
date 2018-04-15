import { ema } from 'moving-averages';
import { timingWrapper } from '../../lib/helpers';
import { findProductAverages, updateProductAverages } from '../../models/ema';


export interface IProduct {
  title: string;
  ask: string;
  bid: string;
  minQty: string;
  tickSize: string;
  candles: {
    fast: number[],
    slow: number[],
  };
  side?: string;
  qty?: number;
}

export interface IProductAverages {
  stock: string;
  coin: string;
  fast: number[];
  slow: number[];
}

export interface IStockHandler {
  title: string;
  priceLoses: {
    product: string,
    ask: number,
    bid: number,
  }[];
  productList: string[];
  handlerInit(): Promise<{
    amount: number,
    products: IProduct[],
  }>;
  makeOrder(
    quantity: string,
    side: string,
    symbol: string,
    type: string,
    coin: IProduct,
  ): Promise<boolean>;
  calculateProfit(duration: {
    start: string,
    end: string,
  }): Promise<number>;
  activatePriceListener(): boolean;
  fastUpdate(products: IProduct[]): Promise<IProduct[]>;
}


export class EMAIntersection {
  private loopTime: number = 3600; // in seconds
  private coinAmount: number = 100;
  private products: IProduct[] = [];
  private ticker: NodeJS.Timer | boolean;
  private emaLines: IProductAverages[] = [];
  private stopLosses: { product: string, price: number | boolean }[];
  private priceTicker: NodeJS.Timer | boolean = false;
  
  constructor(public stockHandler: IStockHandler) {
    this.stopLosses = this.stockHandler.productList.map(
      (v: string) => ({ product: v, price: false }),
    );
    this.ticker = setInterval(
      async () => {
        await this.dataFetching();
        await this.run();
      },
      this.loopTime * 1000,
    );

    this.stockHandler.activatePriceListener();    
  }

  public async doScalping(): Promise<boolean> {
    this.products = await this.stockHandler.fastUpdate(this.products);
    console.log(`${this.stockHandler.title} ->> `, this.stockHandler.priceLoses);
    await Promise.all(this.products.map(
      async (product: IProduct, key: number) => timingWrapper(
        async () => {
          const { ask, bid } = this.stockHandler.priceLoses.find(v => v.product === product.title);
          const stopLossKey = this.stopLosses.findIndex(v => v.product === product.title);
          
          if (product.side === 'sell') {
            if (ask > this.stopLosses[stopLossKey].price) {
              this.stopLosses[stopLossKey].price = ask;
              console.log(`${this.stockHandler.title} ->> Цена выросла и зaфиксированна на отметке ->>`, this.stopLosses[stopLossKey]);

              return true;
            }
            
            if (ask <= (this.stopLosses[stopLossKey].price - 100)) {
              console.log(`\r\nПродаю ${product.qty} ${product.title} по цене ${product.bid}`);
              return await this.stockHandler.makeOrder(
                product.qty.toString(),
                'sell',
                product.title,
                `${this.stockHandler.title !== 'binance' ? 'market' : 'MARKET'}`,
                product,
              );
            }
          }

          if (product.side === 'buy') {
            if (ask >= (this.stopLosses[stopLossKey].price - 100)) {

              console.log(`\r\nПокупаю ${product.qty} ${product.title} по цене ${product.ask}`);
              
              return await this.stockHandler.makeOrder(
                product.qty.toString(),
                'buy',
                product.title,
                `${this.stockHandler.title !== 'binance' ? 'market' : 'MARKET'}`,
                product,
              );
            }

            return true;
          }
        },
        1000,
      ), 
    ));

    return true;
  }

  public async installPriceTicker(product: IProduct, price: number|boolean = false): Promise<boolean> {

    const { ask, bid } = this.stockHandler.priceLoses.find(v => v.product === product.title);
    const stopLossKey = this.stopLosses.findIndex(v => v.product === product.title);
    this.stopLosses[stopLossKey].price = (price === false) ? ask : (bid + 100);
    console.log(`${this.stockHandler.title} ->> Активирую прайстикер, стоп-цена: ${this.stopLosses[stopLossKey].price}`);
    this.priceTicker = setInterval(
      async () => await this.doScalping(),
      420000,
    );

    return true;
  }

  public removePriceTicker(): boolean {
    clearInterval(this.priceTicker);
    this.priceTicker = false;
    this.stopLosses = this.stockHandler.productList.map(
      (v: string) => ({ product: v, price: false }),
    );

    console.log('Прайстикер удален');

    return true;
  }

  public async dataFetching(): Promise<boolean> {
    const { amount, products } = await this.stockHandler.handlerInit();
    this.coinAmount = amount;
    this.products = products;
    return true;
  }

  public async run(): Promise<boolean> {
    if (this.products instanceof Array && this.products.length !== 0) {
      await this.refreshEmaList();
      await Promise.all(this.products.map(
        async (coin: IProduct, key: number) => timingWrapper(
          () => this.doTrading(coin),
          key * 1000,
        ),
      ));

      return true;
    }
  }

  /* WITH PRICE TICKER -> NOT RECOMENDED
  
  public async doTrading(product: IProduct): Promise<boolean> {
    try {
      const { fast, slow } = this.emaLines.find(v => v.coin === product.title);

      console.log(`\r\n\r\n${this.stockHandler.title} ->> `,
        product.title, 'qty - side - ask ->',
        `${product.qty} - ${product.side} - ${product.ask}`,
        `\r\nfast`, fast,
        `\r\nslow`, slow,
      );

      
      if (fast[fast.length - 1] > slow[slow.length - 1]) {
        if (fast[fast.length - 2] < slow[slow.length - 2]) {
          
          if (product.side === 'buy') {
            console.log(`\r\nПокупаю ${product.qty} ${product.title} по цене ${product.ask}`);

            await this.stockHandler.makeOrder(
              product.qty.toString(),
              'buy',
              product.title,
              `${this.stockHandler.title !== 'binance' ? 'market' : 'MARKET'}`,
              product,
            );
            
            return await this.installPriceTicker(product, true);
          }

          if (product.side === 'sell') {
            if (this.priceTicker === false) {
              return await this.installPriceTicker(product, true);
            }
          }
        }

        if (fast[fast.length - 2] > slow[slow.length - 2]) {
          if (this.priceTicker === false) {
            return await this.installPriceTicker(product, true);
          }

          return true;
        }
      }

      if (fast[fast.length - 1] < slow[slow.length - 1]) {
        if (this.priceTicker !== false) {
          this.removePriceTicker();
        }

        if (product.side === 'sell') {
          console.log(`\r\nПродаю ${product.qty} ${product.title} по цене ${product.ask}`);
          
          return await this.stockHandler.makeOrder(
            product.qty.toString(),
            'sell',
            product.title,
            `${this.stockHandler.title !== 'binance' ? 'market' : 'MARKET'}`,
            product,
          );
        }

        return true;
      }
    } catch (error) {
      console.log(error);
    }
  }*/

  public async doTrading(coin: IProduct): Promise<boolean> {
    try {
      const { fast, slow } = this.emaLines.find(v => v.coin === coin.title);
      console.log(`\r\n\r\n${this.stockHandler.title} ->> `,
        coin.title, 'qty - side - ask ->',
        `${coin.qty} - ${coin.side} - ${coin.ask}`,
        `\r\nfast`, fast,
        `\r\nslow`, slow,
      );
      if (coin.side === 'buy') {
        if (
          fast[fast.length - 1] >= slow[slow.length - 1]
          && fast[fast.length - 2] < slow[slow.length - 2]
        ) {
          console.log(`\r\nПокупаю ${coin.qty} ${coin.title} по цене ${coin.ask}`);
          return await this.stockHandler.makeOrder(
            coin.qty.toString(),
            'buy',
            coin.title,
            `${this.stockHandler.title !== 'binance' ? 'market' : 'MARKET'}`,
            coin,
          );
        }
      }
      if (coin.side === 'sell') {
        if (
          fast[fast.length - 1] <= slow[slow.length - 1]
          && fast[fast.length - 2] > slow[slow.length - 2]
        ) {
          console.log(`\r\nПродаю ${coin.qty} ${coin.title} по цене ${coin.ask}`);
          return await this.stockHandler.makeOrder(
            coin.qty.toString(),
            'sell',
            coin.title,
            `${this.stockHandler.title !== 'binance' ? 'market' : 'MARKET'}`,
            coin,
          );
        }
      }
    } catch (error) {
      console.log(error);
    }
  }

  public async installAveragesList(): Promise<boolean> {
    await Promise.all(this.products.map(
      async (product: IProduct) => {
        const productAverages = await findProductAverages<IProductAverages>(
          this.stockHandler.title, product.title,
        );
      
        if (productAverages === null) {
          return true;
        }

        const { stock, coin, fast, slow } = productAverages;
        
        this.emaLines.push({
          fast: fast.filter((v, k) => k > fast.length - 5),
          slow: slow.filter((v, k) => k > slow.length - 5),
          stock: this.stockHandler.title,
          coin: product.title,
        });

        return true;
      },
    ));

    return true;
  }

  public async refreshEmaList(): Promise<boolean> {
    await Promise.all(this.products.map(
      async (coin: IProduct) => {
        const { fast: fastArrayPrices, slow: slowArrayPrices } = coin.candles;
        const fast = ema(fastArrayPrices, fastArrayPrices.length);
        const slow = ema(slowArrayPrices, slowArrayPrices.length);
        const keyExists = this.emaLines.findIndex(v => v.coin === coin.title);
        const updated = await updateProductAverages({
          stock: this.stockHandler.title,
          coin: coin.title,
          points: {
            fast: fast[fast.length - 1],
            slow: slow[slow.length - 1],
          },
        });

        if (keyExists !== -1) {
          if (this.emaLines[keyExists].fast.length >= 10) {
            this.emaLines[keyExists].fast.shift();
            this.emaLines[keyExists].slow.shift();
          }
          this.emaLines[keyExists].fast.push(fast[fast.length - 1]);
          this.emaLines[keyExists].slow.push(slow[slow.length - 1]);

          return true;
        }

        this.emaLines.push({
          stock: this.stockHandler.title,
          coin: coin.title,
          fast: [fast[fast.length - 1]],
          slow: [slow[slow.length - 1]],
        });

        if (updated !== null) {
          return true;
        }
      },
    ));
    return true;
  }

  public switch(toto: boolean): boolean {
    if (toto === true) {
      if (this.ticker === false) {
        this.ticker = setInterval(
          async () => await this.run(),
          this.loopTime * 1000,
        );
      }

      return true;
    }
    if (this.ticker !== false) {
      clearInterval(this.ticker);
      this.ticker = false;
    }

    return true;
  }
}
