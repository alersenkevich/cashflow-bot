import { IProductAverages } from '../strategies/ema-intersection';
import { Schema, model, Model, Document } from 'mongoose';

export const averageSchema: Schema = new Schema({
  stock: String,
  coin: String,
  fast: Array,
  slow: Array,
}, { timestamps: true });

const modelAverage = model('Average', averageSchema);

export const findProductAverages = async <T>(stock: string, coin: string): Promise<T> => {
  try {
    return await modelAverage.findOne({ stock, coin });
  } catch (error) {
    console.warn(error);
    return null;
  }
};

export const updateProductAverages = async (params: {
  stock: string,
  coin: string,
  points: {
    fast: number,
    slow: number,
  },
}) => {
  try {
    const { stock, coin } = params;
    const averages = await findProductAverages<IProductAverages>(params.stock, params.coin);

    if (averages === null) {
      const done = await new modelAverage({
        stock, coin, 
        fast: [params.points.fast],
        slow: [params.points.slow],
      }).save();

      return done;
    }

    if (averages.fast.length >= 100) {
      averages.fast.shift();
      averages.slow.shift();
    }

    averages.fast.push(params.points.fast);
    averages.slow.push(params.points.slow);

    return await averages.save();
  } catch ({ message }) {
    console.warn(message);
    return null;
  }
};

