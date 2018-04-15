import * as mongoose from 'mongoose';
import * as gdax from 'gdax';
import { handleProcessEvents } from './init';
import { exchanges, db } from './config';
import factory from './interfaces/robot/factory';
import stockHandlers from './interfaces/stock';
import stockWrappers from './lib/api';



const runApplication = async () => {
  const robots = await factory.produceRobots(exchanges, stockWrappers, stockHandlers);
};



mongoose.connection.on('connected', (): void => {
  handleProcessEvents(db.url, mongoose.connection);
  console.log(`Connected to DB ${db.url}`);

  runApplication();
});

try {
  mongoose.connect(db.url);
}catch (error) {
  console.warn(error);
}
