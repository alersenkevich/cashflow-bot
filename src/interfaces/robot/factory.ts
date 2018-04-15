import { IStockHandler, EMAIntersection } from '../../strategies/ema-intersection';
import { AbstractApiWrapper } from '../../lib/api/abstract-api-wrapper';
import { PublicClient, AuthenticatedClient } from 'gdax';


class RobotFactory {
  public async produceRobots(
    stocks: object[],
    stockApiWrappers: object[],
    stockHandlers: IStockHandler[],
  ) {
    return Promise.all(Object.entries(stocks)
      .map(async (stock) => {
        const api = stockApiWrappers[stock[0]](stock[1]);
        if (stock.title === 'hitbtc') console.log(api.socket);
        const stockHandler = stockHandlers[stock[0]](api, stock[1].coins);
        const robot = await new EMAIntersection(stockHandler);
        
        await robot.dataFetching();
        await robot.installAveragesList();
        robot.run();

        return { engine: robot, title: stock[0] };
      }),
    );
  }
}

export default new RobotFactory();
