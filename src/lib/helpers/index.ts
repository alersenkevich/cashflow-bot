import { AbstractApiWrapper } from '../api/abstract-api-wrapper';

export const timingWrapper = <T>(fn: Function, ms: number): Promise<T> => {
  return new Promise(
    resolve => setTimeout(
      async () => resolve(await fn()),
      ms,
    ),
  );
};

export const filterQuantity = (qty: number, minQty: string): number => {
  let countAfterComa = 0;

  if (parseFloat(minQty) < 1) {
    countAfterComa = minQty.split('.')[1].length;
  }

  const rest = qty % parseFloat(minQty);
  const withoutRest = qty - rest;

  return parseFloat(withoutRest.toFixed(countAfterComa));
};
