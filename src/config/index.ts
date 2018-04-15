export const db = {
  url: 'MONGO-DB URL HERE',
};

export const exchanges = {
  binance: {
    url: 'https://api.binance.com/api',
    key: 'your key here',
    secret: 'your secret here',
    coins: [
      'BTCUSDT',
      // 'LTCUSDT',
      // 'ETHUSD',
    ],
  },
  gdax: {
    apiURI: 'https://api.gdax.com',
    key: 'your key here',
    secret: 'your secret here',
    passphrase: 'your passphrase here',
    coins: [
      'BTC-USD',
      // 'LTC-USD',
      // 'ETH-USD',
    ],
  },
  hitbtc: {
    url: 'https://api.hitbtc.com/api/2',
    key: 'your key here',
    secret: 'your secret here',
    coins: [
      'BTCUSD',
      // 'LTCUSD',
      // 'ETHUSD',
    ],
  },
};
