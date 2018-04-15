import { PublicClient, AuthenticatedClient, WebsocketClient } from 'gdax';

export const apiInit = (config) => {
  const { apiURI, secret, key, passphrase, coins } = config;


  return {
    public: new PublicClient(),
    private: new  AuthenticatedClient(
      key,
      secret,
      passphrase,
      apiURI,
    ),
    socket: new WebsocketClient(
      coins,
      'wss://ws-feed.gdax.com',
      { key, secret, passphrase },
      { channels: ['ticker'] },
    ),
  };
};
