import { Connection } from 'mongoose';


export const gracefulExit = mongooseConnection => 
  () => mongooseConnection.close(
    (): Error => new Error('Mongoose connection closed'),
  );

export const handleProcessEvents = (
  mongoURL: string,
  mongooseConnection: Connection,
): void => {
  process
    .on('SIGINT', gracefulExit(mongooseConnection))
    .on('SIGTERM', gracefulExit(mongooseConnection));

  process.on('uncaughtException', (err) => {
    console.info('uncaughtException', err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, p) => {
    console.info('Unhandled Rejection at:', p, 'reason:', reason);
    process.exit(1);
  });

  mongooseConnection.on('error', (err) => {
    console.info(`Failed to connect to DB ${mongoURL} on startup`, err);
  });

  mongooseConnection.on('disconnected', () => {
    console.info(`Mongoose default connection to DB : ${mongoURL} disconnected`);
  });
};
