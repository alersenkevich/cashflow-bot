import { Schema, model, Model, Document } from 'mongoose';
import { IOrder } from '../lib/api/hitbtc';


export const hitbtcOrderSchema: Schema = new Schema({
  orderId: { type: Number },
  fee: { type: Number },
  clientOrderId: { type: String },
  type: { type: String },
  side: { type: String },
  symbol: { type: String },
  price: { type: Number },
  quantity: { type: Number },
  status: { type: String },
}, { timestamps: true });

export const gdaxOrderSchema: Schema = new Schema({
  orderId: { type: String },
  quantity: { type: Number },
  price: { type: Number },
  type: { type: String },
  side: { type: String },
  status: { type: String },
  symbol: { type: String },
  product_id: { type: String },
  fee: { type: Number },
}, { timestamps: true });

export const binanceOrderSchema: Schema = new Schema({
  orderId: { type: Number },
  quantity: { type: Number },
  price: { type: Number },
  type: { type: String },
  side: { type: String },
  status: { type: String },
  clientOrderId: { type: String },
});

export const gdax = model('GdaxOrder', gdaxOrderSchema);
export const hitbtc = model('HitbtcOrder', hitbtcOrderSchema);
export const binance = model('BinanceOrder', binanceOrderSchema);

const exchanges = { gdax, hitbtc, binance };

export const findOrder = async (clientOrderId: string, title: string): Promise<Document> => {
  try {
    return await exchanges[title].findOne({ clientOrderId });
  } catch (error) {
    console.warn(error);
    return null;
  }
};

export const findOrderByParams = async (params: object, title: string): Promise<Document> => {
  try {
    return await exchanges[title].findOne(params).sort({ createdAt: 'desc' });
  } catch (error) {
    console.warn(error);
    return null;
  }
};

export const createOrder = async (order, title: string): Promise<Document> => {
  try {
    return await new exchanges[title](order).save();
  } catch (error) {
    console.error(error);
    return null;
  }
};

export const updateOrder = async (order, title: string): Promise<Document> => {
  let orderRecord = await findOrder(order.clientOrderId, title);
  
  if (!orderRecord) return console.log('Невозможно обновить данные запроса в модели Order');
  orderRecord = Object.assign(orderRecord, order);
  
  return await orderRecord.save();
};

export const deleteOrder = async (clientOrderId: string, title: string): Promise<any> => {
  try {
    const orderRecord = await findOrder(clientOrderId, title);
    if (orderRecord !== null) {
      return await orderRecord.remove();
    }
    return true;
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
};

export const getActiveOrders = async (title: string): Promise<Document[]> => {
  try {
    return await exchanges[title].find({ status: 'opened' });  
  } catch (error) {
    console.warn(error);
    return null;
  }
};

export const findLastOrder = async (orderParams: object, title: string): Promise<Document> => {
  try {
    return await exchanges[title].findOne(orderParams).sort({ createdAt: 'desc' });
  } catch (error) {
    console.warn(error);
    return null;
  }
};
