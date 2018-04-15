/**
 * 
 * @author Aler Senkevich
 * Abstract API wrapper for rest requests
 * 
 */
import { Request } from 'node-fetch';

export interface APIConnectionConfig {
  url: string;
  key: string;
  secret: string;
}

export interface APIRequest {
  action: string;
  method: string;
  access: boolean; // private - true; public - false;
  payload: object;
}

export abstract class AbstractApiWrapper {
  protected config: APIConnectionConfig;
  protected abstract async request <T>(data: APIRequest): Promise<T>;

  protected transformPayloadToString(payload: object): string {
    return Object.entries(payload)
      .map(v => `${v[0]}=${v[1]}`)
      .join('&');
  }

  public get (data: { action: string, payload: object }, access: boolean = false): Promise<any> {
    return this.request({ ...data, access, method: 'GET' });
  }

  public post(data: { action: string, payload: object }, access: boolean = false): Promise<any> {
    return this.request({ ...data, access, method: 'POST' });
  }

  public patch(data: { action: string, payload: object }, access: boolean = false): Promise<any> {
    return this.request({ ...data, access, method: 'PATCH' });
  }

  public put(data: { action: string, payload: object }, access: boolean = false): Promise<any> {
    return this.request({ ...data, access, method: 'PUT' });
  }

  public delete(data: { action: string, payload: object }, access: boolean = false): Promise<any> {
    return this.request({ ...data, access, method: 'DELETE' });
  }
}
